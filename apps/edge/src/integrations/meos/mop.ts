// Authored for fartola. Not ported from upstream.
//
// MeOS Online Protocol (MOP) receiver — Fastify route `POST /mop` that MeOS
// pushes <MOPComplete> or <MOPDiff> updates to. Honors the four D-MOP-*
// decisions from CONTEXT.md round 2:
//
//   - D-MOP-1: shadow `meos_competitors` / `meos_classes` / `meos_clubs`
//     tables. fartOLa ground truth in `competitors` stays untouched except
//     for the explicit auto-merge step (D-MOP-3).
//   - D-MOP-2: <MOPComplete> = TRUNCATE+INSERT inside ONE sqlite.transaction
//     — partial-parse failure rolls back to the prior snapshot. <MOPDiff>
//     does UPSERT by id, plus DELETE for rows with delete="true".
//   - D-MOP-3: auto-merge MeOS-only competitors into `competitors` with
//     source='meos', consent_status='pending_first_read'. Class-match guard
//     (NAME equality between meos_classes and classes) prevents importing
//     into unknown classes. WS broadcast `meos_merge` envelope AFTER the
//     transaction commits (PATTERNS S-4 broadcast-after-commit).
//   - D-MOP-4 (revised 2026-10-05): was "no auth, always-on, `pwd`
//     ignored". /mop adds runners, so it now takes the MeOS password (`pwd`)
//     when one is set, else only this machine unless the operator explicitly
//     allows MeOS without a password (meosAccessHook, access.ts, checked
//     before the body is read).
//
// Mount path: `/mop` at the ROOT (NOT under `/api/*`) — MeOS hard-codes its
// POST URL and won't add a prefix. Same posture as `/mip`.
//
// Wire format reference: mop.xsd v2.0 (pinned at apps/edge/src/integrations/
// meos/mop.xsd) + .planning/research/meos-protocols.md + PHP reference
// receiver `update.php`.
//
// Response shape (always 200 at the HTTP layer — MOPStatus is the
// application-level signal MeOS reads):
//   <?xml version="1.0"?><MOPStatus status="OK"/>
//   Status codes: OK | BADCMP | BADPWD | NOZIP | ERROR
//
// Locked by:
// - .planning/phases/02-4-klubbs-mvp/02-04-PLAN.md task 2
// - .planning/phases/02-4-klubbs-mvp/02-CONTEXT.md D-MOP-1..4
// - .planning/phases/02-4-klubbs-mvp/02-RESEARCH.md §"Pattern 4: MOP POST /mop"
// - .planning/phases/02-4-klubbs-mvp/02-PATTERNS.md §4 (transactional ingest)
//   + §S-4 (broadcast after commit)

import crypto from 'node:crypto';

import type { FastifyInstance, FastifyReply } from 'fastify';
import { XMLParser } from 'fast-xml-parser';
import { eq, sql } from 'drizzle-orm';

import {
  meosCompetitors,
  meosClasses,
  meosClubs,
  competitors,
  config as configTable,
} from '../../db/schema.ts';
import { readoutChannel } from '@fartola/shared-types';
import { toArray, asInt, asString, asBool } from './shared.ts';
import { meosAccessHook } from './access.ts';

/** 50 MB cap per RESEARCH "Plan 4 — MOP route" + plan 02-04 must_haves. MeOS
 * exports of a busy O-ringen-sized event can be ~10 MB; 50 MB gives the
 * operator headroom without risking OOM on a 4 GB bench laptop. */
const MOP_BODY_LIMIT = 50 * 1024 * 1024;

const ACTIVE_COMP_KEY = 'active_competition_id';

type MopStatus = 'OK' | 'BADCMP' | 'BADPWD' | 'NOZIP' | 'ERROR';

/** Send a 200 response with the canonical MOPStatus body. update.php emits
 * the same shape (no namespace, no version attribute) so MeOS's parser
 * doesn't have to do anything fancy. */
function mopStatus(reply: FastifyReply, status: MopStatus): FastifyReply {
  void reply.header('Content-Type', 'application/xml; charset=utf-8');
  return reply
    .code(200)
    .send(`<?xml version="1.0" encoding="UTF-8"?><MOPStatus status="${status}"/>`);
}

export default async function registerMopRoute(app: FastifyInstance): Promise<void> {
  // Raw-XML body parsers for both content types MeOS may set. We hand back
  // the raw string to the route handler so its DOCTYPE/ENTITY pre-flight
  // regex can run BEFORE the XMLParser ever sees the bytes (T-FILE-IMPORT
  // mitigation — PATTERNS S-7).
  app.addContentTypeParser(
    'text/xml',
    { parseAs: 'string', bodyLimit: MOP_BODY_LIMIT },
    (_req, body, done) => {
      done(null, body);
    }
  );
  app.addContentTypeParser(
    'application/xml',
    { parseAs: 'string', bodyLimit: MOP_BODY_LIMIT },
    (_req, body, done) => {
      done(null, body);
    }
  );

  // fast-xml-parser config matches Phase 1's xml/parse.ts hardened defaults
  // (PATTERNS S-7). `removeNSPrefix: true` strips the `mop:` namespace
  // prefix from element + attribute names so the dispatch can key on bare
  // `MOPComplete` / `MOPDiff` regardless of how MeOS prefixes its output.
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    processEntities: false, // PATTERNS S-7 — no entity expansion (XXE / billion-laughs).
    allowBooleanAttributes: true,
    parseAttributeValue: true,
    trimValues: true,
    removeNSPrefix: true,
  });

  app.post('/mop', { onRequest: meosAccessHook(app) }, async (req, reply) => {
    const body = req.body;

    // (1) Pre-flight: empty body. MeOS occasionally sends heartbeat POSTs;
    // we return ERROR rather than crashing the parser (Pitfall 7).
    if (typeof body !== 'string' || body.length === 0) {
      return mopStatus(reply, 'ERROR');
    }

    // (2) Pre-flight: gzipped POST detection. The first byte 0x50 ('P') is
    // the ZIP local-file-header magic. update.php rejects with NOZIP; we
    // do the same (Phase 2.0 doesn't support `zipupdate.php` semantics —
    // deferred to 2.1 per RESEARCH).
    if (body.charCodeAt(0) === 80 /* 'P' */) {
      return mopStatus(reply, 'NOZIP');
    }

    // (3) Pre-flight: T-FILE-IMPORT DOCTYPE/ENTITY guard. Same regex pattern
    // as apps/edge/src/xml/parse.ts:115-124. Scan only the first 8 KB —
    // both declarations must appear at the top of an XML document, so
    // scanning the full 50 MB body is wasteful. Fails closed on either
    // match so a malicious `<!ENTITY foo SYSTEM "file:///etc/passwd">`
    // never reaches the parser.
    const head = body.length > 8192 ? body.slice(0, 8192) : body;
    if (/<!DOCTYPE/i.test(head) || /<!ENTITY/i.test(head)) {
      return mopStatus(reply, 'ERROR');
    }

    // (4) Parse. fast-xml-parser throws on malformed input; we convert to
    // MOPStatus ERROR so MeOS gets a sensible signal instead of an HTTP 500.
    let parsed: Record<string, unknown>;
    try {
      parsed = parser.parse(body) as Record<string, unknown>;
    } catch {
      return mopStatus(reply, 'ERROR');
    }

    // Root key dispatch — skip the `?xml` prolog entry + any top-level
    // attribute keys (the `xmlns` declaration becomes `@_xmlns` when
    // attributeNamePrefix='@_').
    const rootKey = Object.keys(parsed).find((k) => !k.startsWith('?') && !k.startsWith('@_'));
    if (rootKey !== 'MOPComplete' && rootKey !== 'MOPDiff') {
      return mopStatus(reply, 'ERROR');
    }
    const root = parsed[rootKey] as Record<string, unknown>;

    const nowMs = Date.now();
    let mergedCount = 0;

    // Resolve the active competition outside the transaction — the config
    // table is read-only here. If no competition is active, the auto-merge
    // step is skipped entirely (MeOS shadow rows still land in meos_*).
    const activeRow = app.fartolaDb.db
      .select({ value: configTable.value })
      .from(configTable)
      .where(eq(configTable.key, ACTIVE_COMP_KEY))
      .get();
    const activeCompetitionId = activeRow?.value ?? null;

    try {
      app.fartolaDb.sqlite.transaction(() => {
        if (rootKey === 'MOPComplete') {
          // D-MOP-2: drop prior snapshot. If any subsequent UPSERT throws,
          // the surrounding transaction rolls back AND restores these rows.
          app.fartolaDb.db.run(sql`DELETE FROM meos_competitors`);
          app.fartolaDb.db.run(sql`DELETE FROM meos_classes`);
          app.fartolaDb.db.run(sql`DELETE FROM meos_clubs`);
        }

        // ---- <cmp> --------------------------------------------------------
        const cmps = toArray(root['cmp'] as unknown);
        for (const raw of cmps) {
          const cmp = raw as Record<string, unknown>;
          const id = asInt(cmp['@_id']);
          if (id === null) continue;
          if (asBool(cmp['@_delete'])) {
            app.fartolaDb.db.delete(meosCompetitors).where(eq(meosCompetitors.id, id)).run();
            continue;
          }
          const base = (cmp['base'] as Record<string, unknown> | undefined) ?? {};
          // BaseCompetitor text content is the runner's name. fast-xml-parser
          // surfaces it under '#text' when attributes coexist with character
          // data (which is always the case for <base> per mop.xsd).
          const nameRaw = asString(base['#text']) ?? asString(base) ?? '';
          const card = asInt(cmp['@_card']);
          const row = {
            id,
            name: nameRaw,
            classId: asInt(base['@_cls']),
            orgId: asInt(base['@_org']),
            statusCode: asInt(base['@_stat']) ?? 0,
            startTimeTenths: asInt(base['@_st']),
            runningTimeTenths: asInt(base['@_rt']),
            bib: asString(base['@_bib']),
            // card="0" per mop.xsd means "no card" — normalize to NULL so the
            // auto-merge `card_number IS NOT NULL` guard works as intended.
            cardNumber: card === 0 ? null : card,
            lastMopUpdateMs: nowMs,
          };
          app.fartolaDb.db
            .insert(meosCompetitors)
            .values(row)
            .onConflictDoUpdate({ target: meosCompetitors.id, set: row })
            .run();
        }

        // ---- <cls> --------------------------------------------------------
        const clss = toArray(root['cls'] as unknown);
        for (const raw of clss) {
          const cls = raw as Record<string, unknown>;
          const id = asInt(cls['@_id']);
          if (id === null) continue;
          // NOTE: mop.xsd v2.0 doesn't formally declare a `delete` attribute
          // on Class — fixtures intended for round-trip validation avoid it.
          // We still honor the attribute defensively at parse time so a
          // future XSD revision (or a lenient MeOS build) can use it without
          // requiring a code change.
          if (asBool(cls['@_delete'])) {
            app.fartolaDb.db.delete(meosClasses).where(eq(meosClasses.id, id)).run();
            continue;
          }
          const row = {
            id,
            name: asString(cls['#text']) ?? asString(cls) ?? '',
            ord: asInt(cls['@_ord']),
            lastMopUpdateMs: nowMs,
          };
          app.fartolaDb.db
            .insert(meosClasses)
            .values(row)
            .onConflictDoUpdate({ target: meosClasses.id, set: row })
            .run();
        }

        // ---- <org> --------------------------------------------------------
        const orgs = toArray(root['org'] as unknown);
        for (const raw of orgs) {
          const org = raw as Record<string, unknown>;
          const id = asInt(org['@_id']);
          if (id === null) continue;
          if (asBool(org['@_delete'])) {
            app.fartolaDb.db.delete(meosClubs).where(eq(meosClubs.id, id)).run();
            continue;
          }
          const row = {
            id,
            name: asString(org['#text']) ?? asString(org) ?? '',
            nat: asString(org['@_nat']),
            lastMopUpdateMs: nowMs,
          };
          app.fartolaDb.db
            .insert(meosClubs)
            .values(row)
            .onConflictDoUpdate({ target: meosClubs.id, set: row })
            .run();
        }

        // ---- D-MOP-3 auto-merge ------------------------------------------
        // Insert any meos_competitors row whose card_number is NOT yet in
        // the active competition's competitors AND whose class name has a
        // matching `classes.name` (class-match guard limits us to known
        // classes — RESEARCH Pattern 4 EXISTS clause). Runs INSIDE the
        // transaction so a downstream failure rolls the merge back too.
        //
        // F-002 BLOCKER fix: meos_competitors has no competition_id column
        // (it's a global shadow). Without a temporal filter, switching the
        // active competition mid-day (morning HD-träning → afternoon 4-
        // klubbs) would re-merge every stale shadow row whose class name
        // accidentally matches into the new active competition. The fix is
        // `mc.last_mop_update_ms = ${nowMs}` so only rows the CURRENT POST
        // just wrote get merged. This is race-safe because both writes and
        // the merge SELECT run inside the same sqlite.transaction.
        if (activeCompetitionId !== null) {
          // Gemini review G-003: was a single INSERT...SELECT using SQL
          // `lower(hex(randomblob(16)))` which produces 32-char hex strings
          // (no hyphens) — inconsistent with the rest of the codebase, which
          // uses crypto.randomUUID() (RFC 4122 36-char hyphenated). External
          // consumers (frontend routes, IOF XML export) expect the canonical
          // shape. Refactor: SELECT the eligible rows in one query, then
          // INSERT each with crypto.randomUUID() in a JS loop. Still runs
          // inside the surrounding sqlite.transaction() so the all-or-nothing
          // atomicity (D-MOP-2) is preserved.
          const eligible = app.fartolaDb.db.all<{
            name: string;
            club: string | null;
            card_number: number;
            class_id: string;
          }>(sql`
            SELECT
              mc.name AS name,
              (SELECT mo.name FROM meos_clubs mo WHERE mo.id = mc.org_id) AS club,
              mc.card_number AS card_number,
              (SELECT c.id FROM classes c
                JOIN meos_classes mcl ON mcl.id = mc.class_id
                WHERE c.competition_id = ${activeCompetitionId}
                  AND c.name = mcl.name
                LIMIT 1) AS class_id
            FROM meos_competitors mc
            WHERE mc.card_number IS NOT NULL
              AND mc.last_mop_update_ms = ${nowMs}
              AND NOT EXISTS (
                SELECT 1 FROM competitors c2
                WHERE c2.competition_id = ${activeCompetitionId}
                  AND c2.card_number = mc.card_number
              )
              AND EXISTS (
                SELECT 1 FROM classes c
                JOIN meos_classes mcl ON mcl.id = mc.class_id
                WHERE c.competition_id = ${activeCompetitionId}
                  AND c.name = mcl.name
              )
          `);

          for (const row of eligible) {
            app.fartolaDb.db
              .insert(competitors)
              .values({
                id: crypto.randomUUID(),
                competitionId: activeCompetitionId,
                name: row.name,
                club: row.club,
                classId: row.class_id,
                cardNumber: row.card_number,
                consentAtMs: null,
                consentStatus: 'pending_first_read',
                source: 'meos',
              })
              .run();
            mergedCount++;
          }
        }
      })();
    } catch (err) {
      // Transaction rolled back — log verbosely (Pitfall 4) and signal MeOS
      // with ERROR. The shadow tables retain whatever state they had before
      // this POST.
      app.log.error({ err }, 'MOP ingest failed');
      return mopStatus(reply, 'ERROR');
    }

    // PATTERNS S-4: broadcast AFTER commit so subscribers only see committed
    // state. The readout view's WS handler (Plan 02-04 task 3) listens for
    // `meos_merge` and surfaces "N löpare hämtade från MeOS".
    if (mergedCount > 0 && activeCompetitionId !== null) {
      app.wsBroadcast(readoutChannel(activeCompetitionId), {
        type: 'meos_merge',
        payload: { count: mergedCount },
      });
      app.projectionStore.markDirty(activeCompetitionId);
    }

    return mopStatus(reply, 'OK');
  });
}
