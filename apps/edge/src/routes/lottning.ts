// Authored for fartola. Not ported from upstream.
//
// REST routes for start list draw (lottning).
//
// Routes registered here:
//   POST /api/competitions/:id/lottning/:classId — draw and write start times
//   PUT  /api/competitions/:id/lottning/:classId/seeding — store seeding groups
//   GET  /api/competitions/:id/lottning/:classId — fetch current start list,
//        plus the stored seeding groups of every runner in the class, how
//        many runners have a previous-stage result (pursuit, TR 7.4.1), the
//        suggested interval (TA till TR 7.4.4) and whether free start time
//        is banned, with the named runners still without a start (TR 7.4.2)
//
// POST semantics:
//   1. Validate the body with Zod. intervalSec must be > 0 except for
//      Simultaneous (T-02.1-04b).
//   2. Cross-competition pre-flight: the class belongs to the competition, else 404.
//   3. SOFT rules that depend on the class kind (classes.class_kind) → 422
//      { error, rule }; a class without a confirmed kind → 409
//      class_kind_unknown / class_kind_unconfirmed.
//   4. Load the class's named competitors (SOFT TR 7.5.1: no draw without a name).
//   5. drawType 'All' (default): draw the whole class (SOFT,
//      Simultaneous, Seeded, Pursuit, ReversePursuit); every runner gets the drawn time or none (D-07), the
//      class gets its start grid. drawType 'Remaining*': place only runners
//      without a start time (late entrants, SOFT TR 7.5.7/7.5.8); nobody
//      else moves.
//   6. Write through writeStartTimes: one start_times_set event plus the
//      start_time_ms cache (ADR-0003 update 2026-10). Undo: POST
//      …/start-times/undo. A DrawError → 409 { error, message }; nothing written.
//   7. markDirty; 201 { drawn: N, …, previous_closing_time_ms,
//      closing_time_ms } (SOFT TR 4.16.3: the UI warns when it moved).
//
// T-02.1-04: mode and drawType are Zod enums.

import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';

import type { ClassKind, ClassKindSource, CompetitionLevel } from '@fartola/shared-types';
import { classes, competitions, competitors } from '../db/schema.ts';
import { kindProblem, pursuitBanned } from '../draw/classKind.ts';
import { drawPursuit } from '../draw/pursuit.ts';
import { fillVacancies, placeBeforeOrAfter, seamClubs, smallestGapMs } from '../draw/remaining.ts';
import { drawSeeded } from '../draw/seeded.ts';
import { drawSimultaneous } from '../draw/simultaneous.ts';
import { drawSOFT } from '../draw/soft.ts';
import { normalIntervalSec } from '../draw/startRules.ts';
import { freeStartForbidden } from '../projection/preRaceCheck.ts';
import { DrawError } from '../draw/types.ts';
import type { DrawResult, DrawRunner } from '../draw/types.ts';
import { closingTime } from './_closingTime.ts';
import { issuesToErrors } from './_zod-errors.ts';
import { writeStartTimes } from '../db/startTimes.ts';
import { StartTimeMs } from './competitors.ts';

// ---------------------------------------------------------------------------
// Input validation schema
// ---------------------------------------------------------------------------

const PURSUIT = ['Pursuit', 'ReversePursuit'] as const;
const isPursuit = (mode: string) => (PURSUIT as readonly string[]).includes(mode);

const LottningInput = z
  .object({
    mode: z.enum(['SOFT', 'Simultaneous', 'Seeded', 'Pursuit', 'ReversePursuit']),
    // Epoch ms, like every other start-time write (not ms since midnight).
    firstStartMs: StartTimeMs.unwrap().optional(),
    intervalSec: z.number().int().min(0).optional(),
    vacantSlots: z.number().int().nonnegative().optional(),
    /** Where vacancies go (MeOS VacantPosition). Default 'Mixed'. */
    vacantPosition: z.enum(['Mixed', 'First', 'Last']).optional(),
    /** 'All' draws the whole class; the others place only the runners
     * without a start time (late entrants, SOFT TR 7.5.8). Default 'All'. */
    drawType: z.enum(['All', 'RemainingBefore', 'RemainingAfter', 'RemainingVacant']).optional(),
    /** Seeded: strongest group starts first (default last, as MeOS). */
    bestFirst: z.boolean().optional(),
    /** Pursuit: start of the restart block (omstart). */
    restartMs: StartTimeMs.unwrap().optional(),
    /** Pursuit: runners this far behind the leader start in the restart block. */
    maxBehindSec: z.number().int().positive().optional(),
    /** Pursuit: time factor (MeOS "scale"). Default 1. */
    scale: z.number().positive().max(10).optional(),
  })
  .superRefine((d, ctx) => {
    const need = (ok: boolean, path: string, message: string) => {
      if (!ok) ctx.addIssue({ code: 'custom', path: [path], message });
    };
    if ((d.drawType ?? 'All') !== 'All') {
      need(d.mode === 'SOFT', 'drawType', 'late entrants are drawn with SOFT');
      need(!d.vacantSlots, 'vacantSlots', 'vacancies are drawn with the whole class');
      return;
    }
    need(d.firstStartMs !== undefined, 'firstStartMs', 'firstStartMs is required');
    need(d.intervalSec !== undefined, 'intervalSec', 'intervalSec is required');
    // T-02.1-04b: for individual-start modes, intervalSec must be > 0.
    if (d.mode !== 'Simultaneous')
      need((d.intervalSec ?? 0) > 0, 'intervalSec', `intervalSec must be > 0 for ${d.mode}`);
    if (isPursuit(d.mode)) {
      need(d.restartMs !== undefined, 'restartMs', 'restartMs is required');
      need(d.maxBehindSec !== undefined, 'maxBehindSec', 'maxBehindSec is required');
      need(!d.vacantSlots, 'vacantSlots', 'a pursuit has no vacancies');
    }
  });
type LottningBody = z.infer<typeof LottningInput>;

const SeedingInput = z.object({ groups: z.array(z.array(z.string().min(1)).min(1)) }).strict();

interface Row {
  id: string;
  name: string;
  club: string | null;
  startTimeMs: number | null;
  seedGroup: number | null;
  inputTimeMs: number | null;
  inputStatus: string | null;
}

/** What a draw writes: start times, whether runners not drawn lose their
 * time (a whole-class draw), and the class's start grid. */
interface DrawPlan {
  assignments: Array<{ id: string; startTimeMs: number }>;
  wholeClass: boolean;
  classGrid?: { firstStartMs: number | null; intervalSec: number | null };
  /** Counts the response adds (pursuit: restarted, without_result). */
  extra?: Record<string, number>;
}

/** A SOFT rule that refuses this draw in this class, or null. The rules
 * read the stored class kind and competition level, never the names; a
 * rule that needs a kind that is not set, or only guessed from the name,
 * refuses (409). */
function refusal(
  body: LottningBody,
  cls: {
    name: string;
    classKind: ClassKind | null;
    classKindSource: ClassKindSource | null;
    ageClass: number | null;
  },
  level: CompetitionLevel | null
): { status: 409 | 422; error: string; message?: string; rule?: string } | null {
  // SOFT TR 7.4.5: seeding groups in elite classes at nivå 1; a training and
  // a nivå 4 event (närtävling, freely designed, TR 3.3.1) may seed any
  // class. Nivå 2–3 may not seed.
  if (body.mode === 'Seeded') {
    if (level === null) return { status: 409, error: 'competition_level_unknown' };
    if (level === 'niva2' || level === 'niva3')
      return { status: 422, error: 'seeding_not_allowed', rule: 'SOFT TR 7.4.5' };
    if (level === 'niva1') {
      // A refusing rule needs a confirmed kind, not a name suggestion.
      const problem = kindProblem(cls);
      if (problem !== null) return { status: 409, ...problem };
      if (cls.classKind !== 'elit')
        return { status: 422, error: 'seeding_not_allowed', rule: 'SOFT TR 7.4.5' };
    }
  }
  // SOFT TR 7.4.1 (both pursuit kinds, see classKind.ts). A refusing rule
  // needs a confirmed kind, not a name suggestion.
  if (isPursuit(body.mode)) {
    const problem = kindProblem(cls);
    if (problem !== null) return { status: 409, ...problem };
    if (pursuitBanned(cls.classKind!, cls.ageClass))
      return { status: 422, error: 'pursuit_not_allowed', rule: 'SOFT TR 7.4.1' };
  }
  if (body.drawType === 'RemainingVacant') {
    const problem = kindProblem(cls);
    if (problem !== null) return { status: 409, ...problem };
  }
  // SOFT TR 7.5.8: vacant places may be offered on the day, not in an elite class.
  if (body.drawType === 'RemainingVacant' && cls.classKind === 'elit')
    return { status: 422, error: 'vacancies_not_offered_in_elite', rule: 'SOFT TR 7.5.8' };
  return null;
}

export default async function registerLottningRoutes(app: FastifyInstance): Promise<void> {
  const classOf = (competitionId: string, classId: string) =>
    app.fartolaDb.db
      .select({
        id: classes.id,
        name: classes.name,
        firstStartMs: classes.firstStartMs,
        startIntervalSec: classes.startIntervalSec,
        maxTimeSec: classes.maxTimeSec,
        classKind: classes.classKind,
        classKindSource: classes.classKindSource,
        ageClass: classes.ageClass,
        level: competitions.level,
        distance: competitions.distance,
      })
      .from(classes)
      .innerJoin(competitions, eq(competitions.id, classes.competitionId))
      .where(and(eq(classes.id, classId), eq(classes.competitionId, competitionId)))
      .get();

  // ---------------------------------------------------------------------------
  // POST /api/competitions/:id/lottning/:classId — draw and write start times
  // ---------------------------------------------------------------------------
  app.post<{ Params: { id: string; classId: string } }>(
    '/api/competitions/:id/lottning/:classId',
    async (req, reply) => {
      const { id: competitionId, classId } = req.params;

      const parsed = LottningInput.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send(issuesToErrors(parsed.error.issues));
      }
      const body = parsed.data;

      const classRow = classOf(competitionId, classId);
      if (!classRow) {
        return reply.code(404).send({ error: 'class_not_found' });
      }
      const refused = refusal(body, classRow, classRow.level);
      if (refused !== null) {
        const { status, ...rest } = refused;
        return reply.code(status).send(rest);
      }

      // All competitors of the class; SOFT TR 7.5.1: one without a name is
      // not drawn (a whole-class draw leaves it without a start time).
      const all: Row[] = app.fartolaDb.db
        .select({
          id: competitors.id,
          name: competitors.name,
          club: competitors.club,
          startTimeMs: competitors.startTimeMs,
          seedGroup: competitors.seedGroup,
          inputTimeMs: competitors.inputTimeMs,
          inputStatus: competitors.inputStatus,
        })
        .from(competitors)
        .where(eq(competitors.classId, classId))
        .all();
      const named = all.filter((r) => r.name.trim().length > 0);

      let plan: DrawPlan;
      try {
        if ((body.drawType ?? 'All') !== 'All') plan = drawLateEntrants(body, classRow, all);
        else if (isPursuit(body.mode)) plan = drawPursuitClass(body, named);
        else plan = drawWholeClass(body, named);
      } catch (e) {
        if (e instanceof DrawError)
          return reply.code(409).send({ error: e.code, message: e.message });
        throw e;
      }

      // SOFT TR 4.16.3: the closing time is in the PM; the response carries
      // it before and after so the UI can warn when a draw moves it.
      const before = closingTime(app.fartolaDb, competitionId).closing_time_ms;
      const at = new Map(plan.assignments.map((a) => [a.id, a.startTimeMs]));
      writeStartTimes(app.fartolaDb, app.fartolaNodeId, competitionId, {
        cause: plan.wholeClass ? 'draw' : 'late_entrants',
        classId,
        changes: plan.wholeClass
          ? all.map((r) => ({ competitorId: r.id, startTimeMs: at.get(r.id) ?? null }))
          : plan.assignments.map((a) => ({ competitorId: a.id, startTimeMs: a.startTimeMs })),
        ...(plan.classGrid !== undefined ? { classGrid: plan.classGrid } : {}),
      });

      app.projectionStore.markDirty(competitionId);

      return reply.code(201).send({
        drawn: plan.assignments.length,
        ...plan.extra,
        previous_closing_time_ms: before,
        closing_time_ms: closingTime(app.fartolaDb, competitionId).closing_time_ms,
      });
    }
  );

  // ---------------------------------------------------------------------------
  // PUT /api/competitions/:id/lottning/:classId/seeding — seeding groups
  // (SOFT TR 7.4.5): competitor ids per group, strongest first. Replaces the
  // class's groups; runners not listed are unseeded. A redraw reuses them.
  // ---------------------------------------------------------------------------
  app.put<{ Params: { id: string; classId: string } }>(
    '/api/competitions/:id/lottning/:classId/seeding',
    async (req, reply) => {
      const { id: competitionId, classId } = req.params;
      const parsed = SeedingInput.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send(issuesToErrors(parsed.error.issues));
      if (!classOf(competitionId, classId))
        return reply.code(404).send({ error: 'class_not_found' });
      const inClass = new Set(
        app.fartolaDb.db
          .select({ id: competitors.id })
          .from(competitors)
          .where(eq(competitors.classId, classId))
          .all()
          .map((r) => r.id)
      );
      const groupOf = new Map<string, number>();
      for (const [g, ids] of parsed.data.groups.entries())
        for (const id of ids) {
          if (!inClass.has(id))
            return reply.code(400).send({ error: 'not_in_class', competitor_id: id });
          if (groupOf.has(id))
            return reply.code(400).send({ error: 'in_two_groups', competitor_id: id });
          groupOf.set(id, g + 1);
        }
      app.fartolaDb.sqlite.transaction(() => {
        for (const id of inClass)
          app.fartolaDb.db
            .update(competitors)
            .set({ seedGroup: groupOf.get(id) ?? null })
            .where(eq(competitors.id, id))
            .run();
      })();
      return { seeded: groupOf.size };
    }
  );

  // ---------------------------------------------------------------------------
  // GET /api/competitions/:id/lottning/:classId — fetch current start list
  // ---------------------------------------------------------------------------
  app.get<{ Params: { id: string; classId: string } }>(
    '/api/competitions/:id/lottning/:classId',
    async (req, reply) => {
      const { id: competitionId, classId } = req.params;

      const classRow = classOf(competitionId, classId);
      if (!classRow) {
        return reply.code(404).send({ error: 'class_not_found' });
      }

      // Fetch all competitors for this class that have a start_time_ms, sorted.
      const startList = app.fartolaDb.db
        .select({
          id: competitors.id,
          name: competitors.name,
          club: competitors.club,
          cardNumber: competitors.cardNumber,
          startTimeMs: competitors.startTimeMs,
          seedGroup: competitors.seedGroup,
        })
        .from(competitors)
        .where(and(eq(competitors.classId, classId), isNotNull(competitors.startTimeMs)))
        .orderBy(asc(competitors.startTimeMs))
        .all();

      // Seeding groups of every runner in the class, drawn or not: the
      // groups are stored before the first seeded draw (PUT …/seeding).
      const seeding = app.fartolaDb.db
        .select({ id: competitors.id, seedGroup: competitors.seedGroup })
        .from(competitors)
        .where(and(eq(competitors.classId, classId), isNotNull(competitors.seedGroup)))
        .all();

      // The previous stage's results stored on the runners by POST
      // …/import/previous-results: how many, and how many of them OK.
      const inputs = app.fartolaDb.db
        .select({ status: competitors.inputStatus })
        .from(competitors)
        .where(and(eq(competitors.classId, classId), isNotNull(competitors.inputStatus)))
        .all();

      // SOFT TR 7.4.2: named runners without a start time would start
      // freely (timed from the start punch, dnfMp.startMs).
      const withoutStart = app.fartolaDb.db
        .select({ name: competitors.name })
        .from(competitors)
        .where(and(eq(competitors.classId, classId), isNull(competitors.startTimeMs)))
        .all()
        .filter((r) => r.name.trim().length > 0).length;

      return {
        class: {
          id: classRow.id,
          name: classRow.name,
          first_start_ms: classRow.firstStartMs,
          start_interval_sec: classRow.startIntervalSec,
          max_time_sec: classRow.maxTimeSec,
          class_kind: classRow.classKind,
          // SOFT TA till TR 7.4.4: the class's interval, else the distance's
          // norm. 0 is a mass start's grid, no interval to suggest.
          suggested_interval_sec:
            (classRow.startIntervalSec ?? 0) > 0
              ? classRow.startIntervalSec
              : normalIntervalSec(classRow.distance),
          // SOFT TR 7.4.2: start times required (no free start order); false
          // while the kind is unconfirmed or the level unset.
          free_start_banned: freeStartForbidden(classRow, classRow.level),
          without_start_time: withoutStart,
        },
        start_list: startList.map((r) => ({
          id: r.id,
          name: r.name,
          club: r.club,
          card_number: r.cardNumber,
          start_time_ms: r.startTimeMs,
          seed_group: r.seedGroup,
        })),
        seeding: seeding.map((r) => ({ id: r.id, seed_group: r.seedGroup! })),
        previous_results: {
          results: inputs.length,
          ok: inputs.filter((r) => r.status === 'OK').length,
        },
      };
    }
  );
}

/** SOFT, Simultaneous, Seeded: the whole class, slot k at first + k·interval. */
function drawWholeClass(body: LottningBody, named: Row[]): DrawPlan {
  const runners: DrawRunner[] = named.map((r) => ({ id: r.id, club: r.club }));
  const firstStartMs = body.firstStartMs!;
  const intervalSec = body.intervalSec!;
  const vacancies = {
    vacantSlots: body.vacantSlots ?? 0,
    vacantPosition: body.vacantPosition ?? 'Mixed',
  } as const;
  let result: DrawResult;
  if (body.mode === 'SOFT') result = drawSOFT(runners, vacancies);
  else if (body.mode === 'Seeded')
    result = drawSeeded(
      named.map((r) => ({ id: r.id, club: r.club, seedGroup: r.seedGroup })),
      { ...vacancies, bestFirst: body.bestFirst ?? false }
    );
  else result = drawSimultaneous(runners);
  const assignments: DrawPlan['assignments'] = [];
  result.order.forEach((slot, k) => {
    if (slot !== null)
      assignments.push({
        id: slot.id,
        startTimeMs:
          body.mode === 'Simultaneous' ? firstStartMs : firstStartMs + k * intervalSec * 1000,
      });
  });
  return { assignments, wholeClass: true, classGrid: { firstStartMs, intervalSec } };
}

/** SOFT TR 7.5.7/7.5.8: the runners without a start time, without
 * redrawing the others (MeOS drawList Remaining*, remaining.ts). */
function drawLateEntrants(
  body: LottningBody,
  classRow: { firstStartMs: number | null; startIntervalSec: number | null },
  all: Row[]
): DrawPlan {
  if (all.every((r) => r.startTimeMs === null))
    throw new DrawError('no_start_list', 'The class has no start times yet; draw the whole class.');
  // Every runner with a start occupies a place, named or not.
  const existing = all.flatMap((r) =>
    r.startTimeMs === null ? [] : [{ id: r.id, club: r.club, startTimeMs: r.startTimeMs }]
  );
  const late: DrawRunner[] = all
    .filter((r) => r.name.trim().length > 0 && r.startTimeMs === null)
    .map((r) => ({ id: r.id, club: r.club }));
  // The class interval (TR 7.5.3: one interval through the class), else the
  // smallest gap (MeOS), else the body's intervalSec.
  const intervalMs =
    (classRow.startIntervalSec ?? 0) > 0
      ? classRow.startIntervalSec! * 1000
      : (smallestGapMs(existing.map((r) => r.startTimeMs)) ??
        ((body.intervalSec ?? 0) > 0 ? body.intervalSec! * 1000 : null));
  if (intervalMs === null)
    throw new DrawError('interval_unknown', 'The class has no start interval; give intervalSec.');
  // Before/After: the SOFT block counts the seam to the existing list
  // (TR 7.5.1); Vacant: fillVacancies handles the seam of its overflow.
  const placement = body.drawType === 'RemainingBefore' ? 'Before' : 'After';
  const boundary = body.drawType === 'RemainingVacant' ? {} : seamClubs(existing, placement);
  const order = drawSOFT(late, { boundary }).order.filter((s): s is DrawRunner => s !== null);
  if (body.drawType === 'RemainingVacant') {
    const firstStartMs = classRow.firstStartMs ?? Math.min(...existing.map((r) => r.startTimeMs));
    const assignments = fillVacancies(
      existing,
      order,
      { firstStartMs, intervalMs },
      (min, max) => crypto.randomInt(min, max),
      true
    );
    return { assignments, wholeClass: false };
  }
  const assignments = placeBeforeOrAfter(existing, order, placement, intervalMs);
  return {
    assignments,
    wholeClass: false,
    ...(placement === 'Before' && assignments.length > 0
      ? {
          classGrid: {
            firstStartMs: assignments[0]!.startTimeMs,
            intervalSec: classRow.startIntervalSec,
          },
        }
      : {}),
  };
}

/** SOFT TR 7.4.1: pursuit from the earlier stage's results imported with
 * POST …/import/previous-results (competitors.input_time_ms/input_status). */
function drawPursuitClass(body: LottningBody, named: Row[]): DrawPlan {
  // MeOS sorts equal times by name (oEventDraw.cpp:3123-3124).
  const sorted = [...named].sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  const { assignments, restarted } = drawPursuit(
    sorted.map((r) => ({
      id: r.id,
      previousTimeMs: r.inputTimeMs,
      previousOk: r.inputStatus === 'OK',
    })),
    {
      firstStartMs: body.firstStartMs!,
      restartMs: body.restartMs!,
      maxBehindMs: body.maxBehindSec! * 1000,
      intervalMs: body.intervalSec! * 1000,
      reverse: body.mode === 'ReversePursuit',
      ...(body.scale !== undefined ? { scale: body.scale } : {}),
    }
  );
  return {
    assignments,
    wholeClass: true,
    classGrid: { firstStartMs: body.firstStartMs!, intervalSec: null },
    extra: { restarted, without_result: named.filter((r) => r.inputStatus === null).length },
  };
}
