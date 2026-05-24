// Authored for fartola. Not ported from upstream.
//
// MeOS Input Protocol (MIP) server — Fastify route `GET /mip` that MeOS
// polls every few seconds to learn about walk-up registrations fartOLa has
// taken. This is fartOLa → MeOS direktanmälningar sync per Phase 2.0 locked
// decision #2 (fartOLa primary; MeOS parallel backup).
//
// Wire shape (mip.xsd v3.0, pinned at apps/edge/src/integrations/meos/mip.xsd):
//   <?xml version="1.0" encoding="UTF-8"?>
//   <MIPData xmlns="http://www.melin.nu/mip" lastid="N">
//     <entry id="..." extId="..." classname="..."><name>...</name>
//       <club>...</club><card hired="true">...</card></entry>
//     ...
//   </MIPData>
//
// Locked decisions honored:
//   - D-MIP-1: NO auth. `pwd` query param is silently ignored. Closed club
//     LAN posture for 4-klubbs; Phase 2.1 will gate sanctioned events.
//   - D-MIP-2: `lastid` = events.local_seq. Zero new state — we read the
//     Phase 1 events table directly with WHERE local_seq > input_lastid.
//   - D-MIP-3: only <entry> on bind + <entry> re-emit on card-replace.
//     The replace path (POST /api/competitors with replace_card_for_competitor_id)
//     emits a fresh card_bound event with the SAME competitor UUID and the
//     NEW card_number — so the next /mip poll naturally re-serializes the
//     updated runner and MeOS UPDATEs (matches by <extId>) rather than
//     INSERTing.
//   - D-MIP-4: <classname> string + <extId> fartOLa competitor UUID.
//     Verified against MeOS source at /home/jonas/src/meos/code/onlineinput.cpp:989-997
//     (falls back to oe.getClass(clsName) when classid absent).
//
// Mount path: `/mip` at the ROOT (NOT under `/api/*`). MeOS hard-codes its
// poll URL and does not add a path prefix; RESEARCH §Anti-patterns warns
// against the temptation to nest under /api/meos/mip.
//
// Landmine mitigations:
//   - MIP <entry> requires <name> — competitor.name is NOT NULL in the
//     Phase 1 schema, so we never emit an empty <name>. We additionally
//     skip rows where competitor was deleted between event-emit and now
//     (`if (!competitor) continue;`).
//   - MIP lastid must be strictly increasing — response lastid =
//     max(input_lastid, max(entry.id)). Each entry.id = row.localSeq which
//     is monotonic per-node (Phase 1 D-13).
//   - input.php lastid coercion accepts negatives + decimals; we are
//     stricter — Zod rejects with 400. RESEARCH "Landmine: input.php
//     lastid coercion" documents the asymmetry.
//
// Locked by:
// - .planning/phases/02-4-klubbs-mvp/02-03-PLAN.md task 2
// - .planning/phases/02-4-klubbs-mvp/02-CONTEXT.md D-MIP-1..4
// - .planning/phases/02-4-klubbs-mvp/02-RESEARCH.md §"Pattern 3"
// - .planning/phases/02-4-klubbs-mvp/02-PATTERNS.md §3 (export.ts route
//   shape + clubs.ts Querystring parser template)

import type { FastifyInstance, FastifyReply } from 'fastify';
import { XMLBuilder } from 'fast-xml-parser';
import { z } from 'zod';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';

import {
  events,
  competitors,
  classes,
  config as configTable,
  hiredCards,
} from '../../db/schema.ts';
import type { EventPayload } from '../../db/schema.ts';
import { issuesToErrors } from '../../routes/_zod-errors.ts';
import { MIP_NS, coerceInt } from './shared.ts';
import { refreshClassCache } from './classCache.ts';

const ACTIVE_COMP_KEY = 'active_competition_id';

// Zod schema — strict integers only. We accept the conventional MIP-spec
// names AND a couple of pragmatic aliases (`x-lastid`, `x-competition`)
// that some MIP test harnesses use. `pwd` is ignored (D-MIP-1) but allowed
// in the schema so it doesn't trip 400.
const MipQuery = z.object({
  competition: z.coerce.number().int().nonnegative().optional(),
  lastid: z.coerce.number().int().nonnegative().optional(),
  pwd: z.string().optional(),
});

// Shape of the entry object handed to XMLBuilder. Attribute keys carry the
// `@_` prefix per fast-xml-parser convention.
interface MipEntryNode {
  '@_id': number;
  '@_extId': string;
  '@_classname': string;
  '@_classid': number;
  name: string;
  club?: string;
  card?: { '#text': number; '@_hired'?: 'true' };
}

interface MipDataNode {
  '@_xmlns': string;
  '@_lastid': number;
  entry?: MipEntryNode[];
}

const XML_PROLOG = '<?xml version="1.0" encoding="UTF-8"?>\n';

/** Render the MIPData tree to a complete XML document (with prolog). */
function renderMipData(builder: XMLBuilder, data: MipDataNode): string {
  // fast-xml-parser doesn't emit the prolog by default; prepend manually so
  // every response is a complete XML document MeOS can parse.
  const body = builder.build({ MIPData: data }) as string;
  return XML_PROLOG + body;
}

/** Send an empty MIPData response with the given lastid. */
function sendEmpty(reply: FastifyReply, builder: XMLBuilder, lastid: number): FastifyReply {
  const xml = renderMipData(builder, { '@_xmlns': MIP_NS, '@_lastid': lastid });
  void reply.header('Content-Type', 'application/xml; charset=utf-8');
  return reply.code(200).send(xml);
}

export default async function registerMipRoute(app: FastifyInstance): Promise<void> {
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    format: true,
    indentBy: '  ',
    suppressEmptyNode: true,
    // mip.xsd treats `hired` as xsd:boolean (CardInfo lines 337-344) and
    // libxml2's strict validator demands an explicit value — without this
    // flag, fast-xml-parser emits `<card hired>` (shorthand) which trips
    // "Specification mandates value for attribute hired".
    suppressBooleanAttributes: false,
  });

  app.get('/mip', async (req, reply) => {
    // (1) Parse query — Zod rejects decimals/negatives/garbage with 400
    // (RESEARCH Landmine "input.php lastid coercion" — we're stricter).
    const parsedQuery = MipQuery.safeParse(req.query);
    if (!parsedQuery.success) {
      return reply.code(400).send(issuesToErrors(parsedQuery.error.issues));
    }
    const queryData = parsedQuery.data;

    // (2) Header fallback (some MIP clients send these as headers per
    // input.php:44-47). Query wins when both present.
    const headers = req.headers;
    const lastid =
      queryData.lastid ?? coerceInt(headers['lastid']) ?? coerceInt(headers['x-lastid']) ?? 0;
    // `competition` and `pwd` are accepted but ignored — D-MIP-1 + the
    // single-active-competition session model owns scope. Read-and-discard
    // satisfies the linter without changing behavior.
    void queryData.competition;
    void coerceInt(headers['competition']);
    void coerceInt(headers['x-competition']);
    void queryData.pwd;
    void headers['pwd'];

    // (3) Resolve active competition. If no competition is active, emit
    // an empty <MIPData lastid="0"/> — safe default that MeOS treats as
    // "nothing to consume yet." Per the Plan task 1 must-have:
    // "GET /mip with no active competition returns lastid=0 (no error)."
    const activeRow = app.fartolaDb.db
      .select({ value: configTable.value })
      .from(configTable)
      .where(eq(configTable.key, ACTIVE_COMP_KEY))
      .get();
    const activeCompetitionId = activeRow?.value ?? null;

    if (activeCompetitionId === null) {
      return sendEmpty(reply, builder, 0);
    }

    // (4) Query card_bound events newer than `lastid` in the active
    // competition. D-MIP-2 reuses events.local_seq as the cursor; the
    // existing idx_events_comp_type index covers (competition_id, event_type)
    // so this scan stays sub-ms at 4-klubbs scale.
    //
    // Pitfall 2 mitigation: ALWAYS filter by competition_id so cross-
    // competition local_seqs don't bleed into the MIP poll.
    const rows = app.fartolaDb.db
      .select({
        localSeq: events.localSeq,
        payload: events.payload,
      })
      .from(events)
      .where(
        and(
          eq(events.competitionId, activeCompetitionId),
          gt(events.localSeq, lastid),
          eq(events.eventType, 'card_bound')
        )
      )
      .orderBy(asc(events.localSeq))
      .all();

    if (rows.length === 0) {
      // Echo the input lastid — Open Question 1 resolution per Plan task 2
      // behavior #2: "empty MIP poll with active comp echoes the input."
      return sendEmpty(reply, builder, lastid);
    }

    // (5) Hydrate competitor + class + hired_card data via three batched
    // queries (one inArray per table) instead of a SELECT per card_bound
    // event. Class name "cache" is now just the pre-built Map.
    //
    // classCache: fetch MeOS class list so we can include classid on each
    // <entry> (D-13 / "Okänd klass" fix). The MeOS host is derived from
    // the polling client's source IP. IPv6-mapped IPv4 addresses (::ffff:
    // prefix) are stripped to their plain IPv4 form. On any fetch failure
    // the cache returns an empty Map and entries fall back to classid=0.
    const meosHost = (() => {
      const raw = req.socket?.remoteAddress ?? '127.0.0.1';
      // Strip IPv6-mapped IPv4 prefix (::ffff:192.168.x.x → 192.168.x.x).
      if (raw.startsWith('::ffff:')) return raw.slice(7);
      // Wrap bare IPv6 addresses in brackets for URL construction.
      if (raw.includes(':')) return `[${raw}]`;
      return raw;
    })();
    // The class cache is module-level in classCache.ts. Integration tests
    // call getClassCacheForTest().seed() BEFORE this handler runs so the
    // TTL guard is already satisfied and refreshClassCache returns the
    // seeded Map without making a network call. No special wiring needed
    // here — the module-level cache is shared within the process.
    const meosCacheMap = await refreshClassCache(meosHost);

    const entries: MipEntryNode[] = [];
    let maxSeq = lastid;

    const competitorIds = rows
      .map((r) => {
        const p = r.payload as EventPayload;
        return p.event_type === 'card_bound' ? p.competitor_id : null;
      })
      .filter((id): id is string => id !== null);

    // Chunk the inArray to stay clear of SQLite's default
    // SQLITE_LIMIT_VARIABLE_NUMBER (999 on legacy builds). 4-klubbs polls
    // are tiny (delta since last lastid) but a fresh-restart catchup could
    // see a thousand+ card_bound events on one call.
    const INARRAY_CHUNK = 500;
    type CompetitorRow = typeof competitors.$inferSelect;
    const competitorRows: CompetitorRow[] = [];
    for (let i = 0; i < competitorIds.length; i += INARRAY_CHUNK) {
      const slice = competitorIds.slice(i, i + INARRAY_CHUNK);
      const partial = app.fartolaDb.db
        .select()
        .from(competitors)
        .where(inArray(competitors.id, slice))
        .all();
      for (const row of partial) competitorRows.push(row);
    }
    const competitorMap = new Map(competitorRows.map((c) => [c.id, c]));

    const classIds = Array.from(new Set(competitorRows.map((c) => c.classId)));
    const classRows =
      classIds.length === 0
        ? []
        : app.fartolaDb.db
            .select({ id: classes.id, name: classes.name })
            .from(classes)
            .where(inArray(classes.id, classIds))
            .all();
    const classNameMap = new Map(classRows.map((c) => [c.id, c.name]));

    // Pre-fetch hired-card numbers, scoped to the cards we'll actually
    // look up in this poll. Narrower than the whole-competition fetch —
    // a sanctioned event with hundreds of rentals only pays for the
    // delta. A row counts as "open" regardless of returned_at; MeOS
    // wants hired=true throughout the rental lifecycle.
    const pollCardNumbers = competitorRows
      .map((c) => c.cardNumber)
      .filter((n): n is number => n !== null);
    const hiredCardSet = new Set<number>();
    if (pollCardNumbers.length > 0) {
      for (let i = 0; i < pollCardNumbers.length; i += INARRAY_CHUNK) {
        const slice = pollCardNumbers.slice(i, i + INARRAY_CHUNK);
        const partial = app.fartolaDb.db
          .select({ cardNumber: hiredCards.cardNumber })
          .from(hiredCards)
          .where(
            and(
              eq(hiredCards.competitionId, activeCompetitionId),
              inArray(hiredCards.cardNumber, slice)
            )
          )
          .all();
        for (const h of partial) hiredCardSet.add(h.cardNumber);
      }
    }

    for (const row of rows) {
      if (row.localSeq > maxSeq) maxSeq = row.localSeq;

      const payload = row.payload as EventPayload;
      // Defensive — events.payload is typed but the DB only enforces JSON.
      if (payload.event_type !== 'card_bound') continue;

      const competitor = competitorMap.get(payload.competitor_id);
      // Skip rows whose competitor was deleted between event-emit and now.
      // The events row is immutable but the competitors row is mutable.
      if (!competitor) continue;

      const className = classNameMap.get(competitor.classId) ?? '';
      // Landmine: MeOS rejects entries with empty <classname> (falls back
      // to <classid> which we don't emit — D-MIP-4). Skip rather than
      // emit something MeOS will reject. Log at warn so operator can
      // diagnose the "walk-up exists in fartOLa but never lands in MeOS"
      // symptom (code-review F-007 — missing class is the only path that
      // produces this silent drop, and it's near-impossible to debug
      // without the log line). No-op at 4-klubbs scale (5 classes, no
      // deletes expected) but high diagnostic value if anything goes
      // sideways during the race.
      if (className.length === 0) {
        req.log.warn(
          { competitorId: competitor.id, classId: competitor.classId },
          'MIP: skipping competitor with unresolvable class — MeOS will not see this entry'
        );
        continue;
      }

      // Hired-card lookup against the pre-fetched set (see above).
      const hired = competitor.cardNumber !== null && hiredCardSet.has(competitor.cardNumber);

      // D-13: include classid so MeOS doesn't reject with "Okänd klass".
      // Falls back to 0 when the class is not in the cache; MeOS then
      // uses classname for lookup (safe for small events).
      const classId = meosCacheMap.get(className) ?? 0;

      const entry: MipEntryNode = {
        '@_id': row.localSeq,
        '@_extId': competitor.id,
        '@_classname': className,
        '@_classid': classId,
        name: competitor.name,
      };
      if (competitor.club !== null && competitor.club.length > 0) {
        entry.club = competitor.club;
      }
      if (competitor.cardNumber !== null) {
        // <card hired="true">12345</card> per mip.xsd CardInfo lines 329-346.
        // The simpleContent type takes the card number as text content and
        // accepts an optional `hired` boolean attribute.
        const card: { '#text': number; '@_hired'?: 'true' } = {
          '#text': competitor.cardNumber,
        };
        if (hired) card['@_hired'] = 'true';
        entry.card = card;
      }
      entries.push(entry);
    }

    // (6) Serialize. The MIP XSD requires `lastid` on every MIPData, and
    // the xmlns must declare the http://www.melin.nu/mip namespace so
    // xmllint validation passes against the pinned mip.xsd.
    const data: MipDataNode = {
      '@_xmlns': MIP_NS,
      '@_lastid': maxSeq,
    };
    if (entries.length > 0) {
      data.entry = entries;
    }
    const xml = renderMipData(builder, data);

    void reply.header('Content-Type', 'application/xml; charset=utf-8');
    return reply.code(200).send(xml);
  });
}
