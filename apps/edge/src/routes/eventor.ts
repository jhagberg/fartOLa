// Authored for fartola. Not ported from upstream.
//
// GET /api/eventor/lookup + GET /api/eventor/status (Plan 02-02 task 1).
//
// The lookup route is the walk-up autocomplete back-end:
//
//   - ?si_card=N → single hit lookup ({ hit: true | false }).
//   - ?prefix=S&limit=K → up to K name-prefix suggestions.
//   - Neither → 400 missing_query (operator must supply one).
//   - Both → 400 conflicting_query (the two paths are mutually exclusive;
//     the UI uses si_card after a bricka scan and prefix while the operator
//     types in the name field).
//
// The status route surfaces enough metadata for TweaksPanel to render its
// indicator and (when FARTOLA_DEV=1) a manual "Uppdatera" button targeting
// /api/__admin/eventor/refresh:
//
//   - `state`: ready (cache present + <7d old) | stale (>7d old) |
//     offline (cache empty but a key is configured — boot fetch failed) |
//     no_key (no API key in process.env).
//   - `ageDays`: floor((now - marker) / 86400000), null when no marker.
//   - `competitorCount`: row count of eventor_competitors.
//   - `fartola_dev`: process.env.FARTOLA_DEV === '1' evaluated at REQUEST
//     time so the web TweaksPanel can correctly gate the admin button in
//     production builds (import.meta.env.DEV would be bundler-time and
//     always false in production).
//
// Locked by:
// - .planning/phases/02-4-klubbs-mvp/02-02-PLAN.md task 1
// - .planning/phases/02-4-klubbs-mvp/02-RESEARCH.md §"UI signaling"
// - .planning/phases/02-4-klubbs-mvp/02-PATTERNS.md §3 (Fastify route shape
//   from routes/clubs.ts + Querystring Zod parsing template)

import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  lookupBySiCard,
  lookupByNamePrefix,
  searchCompetitorsByName,
  searchClubsByName,
} from '../eventor/lookup.ts';
import { listEventorEvents } from '../eventor/events.ts';
import { fetchEventorEvent } from '../eventor/fetchEvent.ts';
import { eventorCompetitors, config as configTable } from '../db/schema.ts';
import { issuesToErrors } from './_zod-errors.ts';
import { resolveSecret, resolveSecretSource } from '../config/secrets.ts';

const LookupQuery = z.object({
  // z.coerce because query strings arrive as strings.
  si_card: z.coerce.number().int().positive().optional(),
  prefix: z.string().min(1).max(120).optional(),
  // `q` is the FTS5-backed fuzzy alternative to `prefix`. Diacritic-folded,
  // word-order-free, matches across family + given + club_name. Use this
  // for new code; `prefix` stays for back-compat with WalkupModal.
  q: z.string().min(1).max(120).optional(),
  // Optional club narrowing — only honored when `q` is supplied. The
  // Lägg-till sheet sends this once the operator has picked a club so
  // the name search returns matches scoped to that club (Per Karlsson
  // Stora Tuna OK isn't drowned by ranked homonyms from other clubs).
  club_id: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
  // Optional competition ID for context-aware SI card disambiguation
  // (Plan 02.1-10, reserved for future use when competitors.eventor_person_id
  // FK is available). Accepts any non-empty string (not UUID-only) because
  // competition IDs are arbitrary text PKs in the schema.
  competition_id: z.string().min(1).max(256).optional(),
});

const ClubsQuery = z.object({
  q: z.string().min(1).max(120),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

const EventsQuery = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  organisationIds: z.string().max(120).optional(),
});

const CACHE_MARKER_KEY = 'eventor_cache_refreshed_at_ms';
const STALE_THRESHOLD_MS = 7 * 86_400_000;

export default async function registerEventorRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: {
      si_card?: string;
      prefix?: string;
      q?: string;
      club_id?: string;
      limit?: string;
      competition_id?: string;
    };
  }>('/api/eventor/lookup', async (req, reply) => {
    const parsed = LookupQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send(issuesToErrors(parsed.error.issues));
    }
    const { si_card, prefix, q, club_id, limit, competition_id } = parsed.data;

    // Mutual-exclusion gate — exactly one of si_card / prefix / q must
    // be supplied. We keep the old `conflicting_query` / `missing_query`
    // error codes for back-compat with WalkupModal.
    const supplied = [si_card !== undefined, prefix !== undefined, q !== undefined].filter(
      Boolean
    ).length;
    if (supplied > 1) {
      return reply.code(400).send({ error: 'conflicting_query' });
    }
    if (supplied === 0) {
      return reply.code(400).send({ error: 'missing_query' });
    }

    if (si_card !== undefined) {
      return lookupBySiCard(app.fartolaDb, si_card, competition_id ?? null);
    }
    if (q !== undefined) {
      const suggestions = searchCompetitorsByName(app.fartolaDb, q, limit ?? 20, club_id);
      return { suggestions };
    }
    const suggestions = lookupByNamePrefix(app.fartolaDb, prefix as string, limit ?? 20);
    return { suggestions };
  });

  // GET /api/eventor/clubs?q=stk&limit=20 — FTS5-backed federation club
  // search. Matches across name + short_name + media_name; diacritic-
  // folded and word-order-free. Used by SmartClubSearch in the Lägg-till
  // sheet so an operator typing "stk" finds "Stora Tuna OK" without
  // having to know the canonical full name.
  app.get<{ Querystring: { q?: string; limit?: string } }>(
    '/api/eventor/clubs',
    async (req, reply) => {
      const parsed = ClubsQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send(issuesToErrors(parsed.error.issues));
      }
      const suggestions = searchClubsByName(app.fartolaDb, parsed.data.q, parsed.data.limit ?? 20);
      return { suggestions };
    }
  );

  // GET /api/eventor/events?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD&organisationIds=637
  //
  // Proxies Eventor's public `events` REST endpoint — documented in the
  // SOFT "Guide Eventor — Hämta data via API" v2.1 (page 3 sample uses
  // exactly `events?fromDate=2014-04-01&toDate=2014-04-30`) and at
  // https://eventor.orientering.se/api/documentation. Returns parsed
  // JSON the web UI can render directly. Used by ImportRunnersView to
  // populate the event picker (operator types the competition date →
  // sees matching Eventor events → picks one → imports the entries via
  // the per-competition route below).
  app.get<{ Querystring: { fromDate?: string; toDate?: string; organisationIds?: string } }>(
    '/api/eventor/events',
    async (req, reply) => {
      const parsed = EventsQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send(issuesToErrors(parsed.error.issues));
      }
      const apiKey = resolveSecret(app.fartolaDb, 'EVENTOR_API_KEY');
      if (!apiKey || apiKey.length === 0) {
        return reply.code(503).send({ error: 'eventor_no_key' });
      }
      try {
        const events = await listEventorEvents({
          apiKey,
          fromDate: parsed.data.fromDate,
          ...(parsed.data.toDate !== undefined ? { toDate: parsed.data.toDate } : {}),
          ...(parsed.data.organisationIds !== undefined
            ? { organisationIds: parsed.data.organisationIds }
            : {}),
        });
        return { events };
      } catch (e) {
        const msg = (e as Error).message ?? 'fetch failed';
        app.log.warn({ err: msg }, 'eventor events fetch failed');
        return reply.code(502).send({ error: 'eventor_fetch_failed', detail: msg });
      }
    }
  );

  // GET /api/eventor/events/:id — fetch metadata for a single Eventor event.
  //
  // Used by the wizard Eventor quickstart to validate an event ID the
  // operator typed and to prefill name + date. Path param is validated
  // as a positive integer. Delegates to fetchEventorEvent() which calls
  // GET /api/event/:id on the Eventor API with the ApiKey header.
  //
  // Error mapping:
  //   404 → not_found (Eventor returned 404 or event ID doesn't exist)
  //   403 → forbidden (API key rejected by Eventor)
  //   key absent → no_key (503)
  //   network failure → eventor_down (502)
  //
  // T-02.1-22: wizard validates event ID via this call before persisting it
  // on the competition row — ensures the ID belongs to a real Eventor event.
  app.get<{ Params: { id: string } }>('/api/eventor/events/:id', async (req, reply) => {
    const eventId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(eventId) || eventId <= 0) {
      return reply.code(400).send({ error: 'invalid_event_id' });
    }
    const apiKey = resolveSecret(app.fartolaDb, 'EVENTOR_API_KEY');
    if (!apiKey || apiKey.length === 0) {
      return reply.code(503).send({ error: 'no_key' });
    }
    try {
      const event = await fetchEventorEvent({ apiKey, eventId });
      return event;
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (msg.includes('not_found') || msg.includes('404')) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (msg.includes('forbidden') || msg.includes('403')) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      app.log.warn({ err: msg, eventId }, 'eventor event fetch failed');
      return reply.code(502).send({ error: 'eventor_down', detail: msg });
    }
  });

  app.get('/api/eventor/status', async () => {
    // Request-time env eval — closure captures process.env which is mutable
    // at runtime. import.meta.env.DEV would be bundler-time and wrong in
    // production builds.
    const fartolaDev = process.env['FARTOLA_DEV'] === '1';
    // Plan 02-07 task 2: env→config→absent precedence. The UI write
    // path (PUT /api/settings/integrations) lands the key in the
    // config table; the next status refresh reflects source='config'
    // without a restart. process.env still wins so the headless
    // ~/.env.fartola path stays the source of truth for CLI operators.
    const apiKey = resolveSecret(app.fartolaDb, 'EVENTOR_API_KEY');
    const source = resolveSecretSource(app.fartolaDb, 'EVENTOR_API_KEY');

    // Competitor count is cheap (SQLite COUNT over a 252k indexed table is
    // sub-ms). Drives the 'offline' vs 'no_key' branch when no marker is set.
    const countRow = app.fartolaDb.db
      .select({ n: sql<number>`COUNT(*)` })
      .from(eventorCompetitors)
      .get();
    const competitorCount = countRow?.n ?? 0;

    const markerRow = app.fartolaDb.db
      .select({ value: configTable.value })
      .from(configTable)
      .where(eq(configTable.key, CACHE_MARKER_KEY))
      .get();

    let state: 'ready' | 'stale' | 'offline' | 'no_key';
    let ageDays: number | null = null;

    if (markerRow) {
      const markerMs = Number.parseInt(markerRow.value, 10);
      if (Number.isFinite(markerMs)) {
        const ageMs = Date.now() - markerMs;
        ageDays = Math.floor(ageMs / 86_400_000);
        state = ageMs >= STALE_THRESHOLD_MS ? 'stale' : 'ready';
      } else {
        state = competitorCount > 0 ? 'ready' : apiKey ? 'offline' : 'no_key';
      }
    } else if (!apiKey || apiKey.length === 0) {
      state = 'no_key';
    } else {
      // Key present but no marker — the boot fetch hasn't run yet OR it
      // failed. If we have rows the prior cache survives ('ready'-ish but
      // we have no age info); otherwise we're offline.
      state = competitorCount > 0 ? 'ready' : 'offline';
    }

    return { state, ageDays, competitorCount, source, fartola_dev: fartolaDev };
  });
}
