// Authored for fartola. Not ported from upstream.
//
// REST CRUD for competitions — the mutable-config-tables (CONTEXT D-09)
// surface that the SvelteKit wizard (plan 12) consumes. D-15 three-click
// wizard locks the four mutable fields (name, date, receipt_template,
// auto_print); UI-SPEC §"Auto-print toggle" persists the boolean on the
// competitions row.
//
// Routes registered here:
//   - GET    /api/competitions                — list ordered by created_at_ms DESC
//   - POST   /api/competitions                — create + 201 echo of stored row
//   - GET    /api/competitions/:id            — 200 with embedded classes + courses, 404 if missing
//   - PATCH  /api/competitions/:id            — partial update; 200 with the post-update row, 404 if missing
//
// Body validation pattern (used everywhere in plan 04):
//   const parsed = Schema.safeParse(req.body);
//   if (!parsed.success) return reply.code(400).send({ errors: parsed.error.issues.map(...) });
//
// Empty-body PATCH is intentionally a no-op 200 — Zod's `.optional()` chain
// accepts {} as valid input. The Drizzle update is short-circuited when
// `Object.keys(parsed.data).length === 0` so we don't issue an UPDATE with
// no SET clause.
//
// Out of scope: DELETE competition (UI-SPEC §"Destructive actions" — not in
// Phase 1).
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-04-PLAN.md task 1
// - .planning/phases/01-single-laptop-training-mvp/01-CONTEXT.md D-09 D-15
// - .planning/phases/01-single-laptop-training-mvp/01-UI-SPEC.md §Wizard
// - .planning/phases/01-single-laptop-training-mvp/01-UI-SPEC.md §"Auto-print
//   toggle" (event-level boolean, persisted on competitions row)

import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { and, desc, eq, asc, isNotNull } from 'drizzle-orm';

import {
  CompetitionCreateInput,
  CompetitionPatchInput,
  type CompetitionDTO,
  type ClassDTO,
} from '@fartola/shared-types';
import { competitions, classes, competitors } from '../db/schema.ts';
import { writeStartTimes } from '../db/startTimes.ts';
import { loadCourseDTOs } from './_courses.ts';
import type { Competition } from '../db/types.ts';
import { issuesToErrors } from './_zod-errors.ts';
import { insertEvent } from '../si/eventInserter.ts';
import { readoutChannel } from '@fartola/shared-types';
import { z } from 'zod';
import { maxTimeLocked } from './_maxTime.ts';
import { competitionClockOffsetMin } from '../time/competitionClock.ts';

const MaxTimeInput = z.object({ max_time_sec: z.number().int().positive().nullable() }).strict();

// ---------------------------------------------------------------------------
// Row → DTO mappers. apps/edge owns the boundary translation; shared-types
// stays Drizzle-free (C-H5).
// ---------------------------------------------------------------------------

const VALID_RECEIPT_TEMPLATES = new Set([
  'classic',
  'standing',
  'detailed',
  'top4',
  'minimal',
  'kids',
] as const);
type ReceiptTemplate = CompetitionDTO['receipt_template'];

function normaliseReceiptTemplate(value: string): ReceiptTemplate {
  // Schema column is plain TEXT (plan 02 left enum narrowing to the Zod
  // boundary). The route boundary only writes the six locked values, but a
  // hand-edited row could be anything — fall back to 'classic' so the wire
  // DTO always satisfies the Zod enum.
  return VALID_RECEIPT_TEMPLATES.has(value as ReceiptTemplate)
    ? (value as ReceiptTemplate)
    : 'classic';
}

function competitionRowToDTO(row: Competition): CompetitionDTO {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    receipt_template: normaliseReceiptTemplate(row.receiptTemplate),
    auto_print: row.autoPrint,
    created_at_ms: row.createdAtMs,
    race_started_at_ms: row.raceStartedAtMs,
    timing_format: (row.timingFormat === 'tenths' ? 'tenths' : 'seconds') as 'seconds' | 'tenths',
    // Plan 11 — expose Eventor linkage; null when not linked.
    eventor_event_id: row.eventorEventId ?? null,
    max_time_sec: row.maxTimeSec ?? null,
    clock_offset_min: competitionClockOffsetMin(row.date, row.clockOffsetMin),
    level: row.level,
  };
}

export default async function registerCompetitions(app: FastifyInstance): Promise<void> {
  // GET /api/competitions — list ordered by created_at_ms DESC.
  app.get('/api/competitions', async () => {
    const rows = app.fartolaDb.db
      .select()
      .from(competitions)
      .orderBy(desc(competitions.createdAtMs))
      .all();
    return { competitions: rows.map(competitionRowToDTO) };
  });

  // POST /api/competitions — create + 201 echo.
  app.post('/api/competitions', async (req, reply) => {
    const parsed = CompetitionCreateInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(issuesToErrors(parsed.error.issues));
    }
    const now = Date.now();
    const id = crypto.randomUUID();
    // UI-SPEC §"Receipt template DEFAULT" — 'classic' server-side; §"Auto-print
    // toggle" — defaults to false (OFF). The Drizzle `competitions` row stores
    // receipt_template as TEXT (no enum at the column layer, by design — plan
    // 02 left enum narrowing to the Zod boundary so post-Phase-1 templates
    // don't require a schema migration).
    const row: Competition = {
      id,
      name: parsed.data.name,
      date: parsed.data.date,
      receiptTemplate: parsed.data.receipt_template ?? 'classic',
      autoPrint: parsed.data.auto_print ?? false,
      createdAtMs: now,
      // Phase 2.1 — new competitions start in pre-race phase. Operator
      // flips this via POST /api/competitions/:id/start-race when the
      // race actually begins.
      raceStartedAtMs: null,
      // Phase 2.1 columns — null on creation; set later via PATCH or wizard.
      liveresultatId: null,
      liveresultatPwd: null,
      // Plan 11 — caller may supply eventor_event_id to link on creation
      // (wizard Eventor quickstart path).
      eventorEventId: parsed.data.eventor_event_id ?? null,
      timingFormat: 'seconds',
      maxTimeSec: null,
      clockOffsetMin: null,
      level: null,
      rocCompetitionId: null,
      rocEnabled: false,
      rocStartId: null,
      rocLastId: null,
      rocControls: null,
      rocStartCodes: null,
      rocCheckCodes: null,
      rocFinishCodes: null,
    };
    app.fartolaDb.db.insert(competitions).values(row).run();
    return reply.code(201).send(competitionRowToDTO(row));
  });

  // GET /api/competitions/:id — 200 with embedded classes + courses, 404 if missing.
  app.get<{ Params: { id: string } }>('/api/competitions/:id', async (req, reply) => {
    const { id } = req.params;
    const compRow = app.fartolaDb.db
      .select()
      .from(competitions)
      .where(eq(competitions.id, id))
      .get();
    if (!compRow) return reply.code(404).send({ error: 'competition not found' });

    const classRows = app.fartolaDb.db
      .select()
      .from(classes)
      .where(eq(classes.competitionId, id))
      .orderBy(asc(classes.name))
      .all();
    const classDTOs: ClassDTO[] = classRows.map((c) => ({
      id: c.id,
      competition_id: c.competitionId,
      name: c.name,
      short_name: c.shortName,
      no_timing: c.noTiming,
      start_method: c.startMethod,
      course_id: c.courseId,
    }));

    const courseDTOs = loadCourseDTOs(app.fartolaDb, id);

    return {
      competition: competitionRowToDTO(compRow),
      classes: classDTOs,
      courses: courseDTOs,
    };
  });

  // PATCH /api/competitions/:id — partial update; 200 with the post-update row.
  app.patch<{ Params: { id: string } }>('/api/competitions/:id', async (req, reply) => {
    const { id } = req.params;
    const parsed = CompetitionPatchInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send(issuesToErrors(parsed.error.issues));
    }
    const existing = app.fartolaDb.db
      .select()
      .from(competitions)
      .where(eq(competitions.id, id))
      .get();
    if (!existing) return reply.code(404).send({ error: 'competition not found' });

    // Map snake_case wire fields → camelCase Drizzle column accessors. Use
    // the Competition row type so the receiptTemplate enum stays narrow.
    const patch: Partial<Competition> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.date !== undefined) patch.date = parsed.data.date;
    if (parsed.data.receipt_template !== undefined)
      patch.receiptTemplate = parsed.data.receipt_template;
    if (parsed.data.auto_print !== undefined) patch.autoPrint = parsed.data.auto_print;
    if (parsed.data.timing_format !== undefined) patch.timingFormat = parsed.data.timing_format;
    // Plan 11 — null explicitly unlinks; positive integer links a new event.
    if ('eventor_event_id' in parsed.data)
      patch.eventorEventId = parsed.data.eventor_event_id ?? null;
    // ADR-0017 — null clears the override (back to the date's default).
    if (parsed.data.clock_offset_min !== undefined)
      patch.clockOffsetMin = parsed.data.clock_offset_min;
    // SOFT TR 3.3.1 — competition level; null clears it.
    if (parsed.data.level !== undefined) patch.level = parsed.data.level;

    // Empty-body PATCH is a no-op 200 (idempotent). Skip the UPDATE so we
    // don't issue a SET-less SQL statement.
    if (Object.keys(patch).length > 0) {
      const { db } = app.fartolaDb;
      // ADR-0017: start times are defined on the competition clock. When
      // the offset in force changes (override, or a date with another
      // default), shift every stored start by the difference so it keeps
      // its clock time: correcting the offset must not change a result.
      const before = competitionClockOffsetMin(existing.date, existing.clockOffsetMin);
      const after = competitionClockOffsetMin(
        patch.date ?? existing.date,
        patch.clockOffsetMin !== undefined ? patch.clockOffsetMin : existing.clockOffsetMin
      );
      const shiftMs = (after - before) * 60_000;
      app.fartolaDb.sqlite.transaction(() => {
        db.update(competitions).set(patch).where(eq(competitions.id, id)).run();
        if (shiftMs !== 0) {
          // Start times are events (ADR-0003 update 2026-10): the shift is
          // one start_times_set event for the runners and every class grid,
          // so the projection moves with the cache.
          const starts = db
            .select({ id: competitors.id, startTimeMs: competitors.startTimeMs })
            .from(competitors)
            .where(and(eq(competitors.competitionId, id), isNotNull(competitors.startTimeMs)))
            .all();
          const grids = db
            .select({
              id: classes.id,
              firstStartMs: classes.firstStartMs,
              intervalSec: classes.startIntervalSec,
            })
            .from(classes)
            .where(and(eq(classes.competitionId, id), isNotNull(classes.firstStartMs)))
            .all();
          writeStartTimes(app.fartolaDb, app.fartolaNodeId, id, {
            cause: 'clock_shift',
            classId: null,
            changes: starts.map((r) => ({
              competitorId: r.id,
              startTimeMs: r.startTimeMs! - shiftMs,
            })),
            classGrids: grids.map((g) => ({
              classId: g.id,
              firstStartMs: g.firstStartMs! - shiftMs,
              intervalSec: g.intervalSec,
            })),
          });
        }
      })();
      // The date and the override set the competition clock card times are
      // placed on: re-score now, not debounced. Routes read the offset fresh
      // next to the cached projection, so a stale cache (old starts) must
      // not outlive this response.
      if (patch.date !== undefined || patch.clockOffsetMin !== undefined) {
        app.projectionStore.recomputeNow(id);
      }
    }

    const updated = app.fartolaDb.db
      .select()
      .from(competitions)
      .where(eq(competitions.id, id))
      .get();
    // updated cannot be null — we just confirmed existence above and there is
    // no DELETE in plan 04 — but TS doesn't know that.
    if (!updated) return reply.code(404).send({ error: 'competition not found' });
    return reply.code(200).send(competitionRowToDTO(updated));
  });

  // PATCH /api/competitions/:id/max-time — the competition's max time.
  //
  // SOFT TR 4.21.1: "Maxtiden är densamma för alla klasser", 2 × the longest
  // expected winning time (long / ultralong) or 4 × (middle / sprint). Body
  // { max_time_sec: positive int | null }. The reducer uses it for every class
  // without its own override. TR 4.21.2: locked after the first start → 409
  // max_time_locked. A suffixed write route, so the event-code gate applies.
  app.patch<{ Params: { id: string } }>('/api/competitions/:id/max-time', async (req, reply) => {
    const { id } = req.params;
    const parsed = MaxTimeInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send(issuesToErrors(parsed.error.issues));
    }
    const existing = app.fartolaDb.db
      .select()
      .from(competitions)
      .where(eq(competitions.id, id))
      .get();
    if (!existing) return reply.code(404).send({ error: 'competition not found' });
    if (existing.maxTimeSec === parsed.data.max_time_sec) {
      return reply.code(200).send(competitionRowToDTO(existing));
    }
    if (maxTimeLocked(app.fartolaDb, id, Date.now())) {
      return reply.code(409).send({ error: 'max_time_locked' });
    }
    app.fartolaDb.db
      .update(competitions)
      .set({ maxTimeSec: parsed.data.max_time_sec })
      .where(eq(competitions.id, id))
      .run();
    app.projectionStore.markDirty(id);
    return reply
      .code(200)
      .send(competitionRowToDTO({ ...existing, maxTimeSec: parsed.data.max_time_sec }));
  });

  // POST /api/competitions/:id/start-race — flip the race-phase gate.
  //
  // Phase 2.1 (2026-05-18). Pre-race, every card_read is an identity scan
  // (the reducer skips detectStatus). Calling this endpoint atomically:
  //   1. inserts a `race_started` event into the log (audit trail)
  //   2. UPDATEs competitions.race_started_at_ms to the same timestamp
  //   3. broadcasts a `race_started` envelope on readout:<id> so live UIs
  //      flip their phase pill without an extra fetch
  //   4. marks the projection dirty so the reducer re-runs and the WS
  //      results channel reflects the new gate
  //
  // Idempotent: calling twice returns 200 with the EXISTING timestamp
  // (no second event written) so an operator double-tap can't reset the
  // race start. 404 if the competition doesn't exist.
  app.post<{ Params: { id: string } }>('/api/competitions/:id/start-race', async (req, reply) => {
    const { id: competitionId } = req.params;
    const existing = app.fartolaDb.db
      .select()
      .from(competitions)
      .where(eq(competitions.id, competitionId))
      .get();
    if (!existing) return reply.code(404).send({ error: 'competition not found' });

    if (existing.raceStartedAtMs !== null) {
      // Idempotent: already started, return current state. No new event,
      // no broadcast — the column is the source of truth.
      return reply.code(200).send(competitionRowToDTO(existing));
    }

    const startedAtMs = Date.now();
    // Wrap event INSERT + competition UPDATE in a single transaction so a
    // crash between the two writes can't leave the audit log and the
    // denormalised column out of sync (mirrors the hired-cards PATCH fix
    // for G-001). The broadcast lands AFTER commit per PATTERNS S-4.
    const r = app.fartolaDb.sqlite.transaction(() => {
      const inserted = insertEvent(
        app.fartolaDb,
        app.fartolaNodeId,
        'race_started',
        startedAtMs,
        { event_type: 'race_started', started_at_ms: startedAtMs },
        competitionId
      );
      app.fartolaDb.db
        .update(competitions)
        .set({ raceStartedAtMs: startedAtMs })
        .where(eq(competitions.id, competitionId))
        .run();
      return inserted;
    })();
    app.wsBroadcast(readoutChannel(competitionId), {
      type: 'race_started',
      payload: { started_at_ms: startedAtMs },
      seq: r.local_seq,
    });
    app.projectionStore.markDirty(competitionId);

    const updated = app.fartolaDb.db
      .select()
      .from(competitions)
      .where(eq(competitions.id, competitionId))
      .get();
    if (!updated) return reply.code(404).send({ error: 'competition not found' });
    return reply.code(201).send(competitionRowToDTO(updated));
  });

  // POST /api/competitions/:id/reset-race — rollback the race-phase gate.
  //
  // Phase 2.1 (2026-05-18). Counterpart to start-race for the case where
  // an operator hits "Starta tävling" by mistake (testing, demo) and needs
  // the projection back to pre-race phase. Atomically:
  //   1. inserts a `race_reset` event into the log (audit trail) carrying
  //      the previous start timestamp so the rollback is reversible-by-
  //      replay if needed
  //   2. NULLs competitions.race_started_at_ms
  //   3. broadcasts a `race_reset` envelope on readout:<id>
  //   4. marks the projection dirty so the next read returns to identity-
  //      scan semantics for every card_read
  //
  // Idempotent: when already in pre-race phase (race_started_at_ms IS NULL),
  // returns 200 with the current state and writes no new event.
  app.post<{ Params: { id: string } }>('/api/competitions/:id/reset-race', async (req, reply) => {
    const { id: competitionId } = req.params;
    const existing = app.fartolaDb.db
      .select()
      .from(competitions)
      .where(eq(competitions.id, competitionId))
      .get();
    if (!existing) return reply.code(404).send({ error: 'competition not found' });

    if (existing.raceStartedAtMs === null) {
      return reply.code(200).send(competitionRowToDTO(existing));
    }

    const previousStartedAtMs = existing.raceStartedAtMs;
    const now = Date.now();
    const r = app.fartolaDb.sqlite.transaction(() => {
      const inserted = insertEvent(
        app.fartolaDb,
        app.fartolaNodeId,
        'race_reset',
        now,
        { event_type: 'race_reset', previous_started_at_ms: previousStartedAtMs },
        competitionId
      );
      app.fartolaDb.db
        .update(competitions)
        .set({ raceStartedAtMs: null })
        .where(eq(competitions.id, competitionId))
        .run();
      return inserted;
    })();
    app.wsBroadcast(readoutChannel(competitionId), {
      type: 'race_reset',
      payload: { previous_started_at_ms: previousStartedAtMs },
      seq: r.local_seq,
    });
    app.projectionStore.markDirty(competitionId);

    const updated = app.fartolaDb.db
      .select()
      .from(competitions)
      .where(eq(competitions.id, competitionId))
      .get();
    if (!updated) return reply.code(404).send({ error: 'competition not found' });
    return reply.code(201).send(competitionRowToDTO(updated));
  });
}
