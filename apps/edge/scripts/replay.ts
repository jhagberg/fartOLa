// Authored for fartola. Not ported from upstream.
//
// Replays a real competition day through fartOLa and compares the result
// with the official one (02.1-14 Task 8).
//
//   FARTOLA_REPLAY_DIR=…/replay/dag1 pnpm --filter @fartola/edge exec tsx scripts/replay.ts
//
// The directory is a fixture from fartOLa-tools/replay: CourseData.xml,
// EntryList.xml, StartList.xml, readouts.ndjson (card_read events with the
// time MeOS got each card in ts_ms), manual.ndjson (statuses set by hand),
// expected.json and manifest.json.
// Everything goes through the normal paths: the three imports through the
// HTTP routes, a race start one hour before the first read-out, each read-out through
// insertEvent with its original time, then the same loader + reducer the
// server uses. The script only reports; it always exits 0.
//
// Start (02.1-14 Task 14): fartOLa times a runner with a start time from it
// (SOFT TR 4.18.9 (2026-07-01)); MeOS from the start punch. A runner who
// matches the official result only when timed from the punch is listed
// under "Skillnad mot MeOS", not as a mismatch. `--meos-start` replays with
// start_method 'start_punch' in every class, as MeOS does.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { CardReadEvent } from '@fartola/sportident';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { openDatabase } from '../src/db/index.ts';
import { competitions, competitors } from '../src/db/schema.ts';
import type { CompetitionState, ManualStatus } from '../src/projection/types.ts';
import { ensureNodeId } from '../src/db/node-id.ts';
import { formatLocalTime } from '../src/time/competitionClock.ts';
import { loadCompetitionInputs } from '../src/projection/loader.ts';
import { reduce } from '../src/projection/reduce.ts';
import { buildServer } from '../src/server.ts';
import type { CardReadPayload } from '../src/si/cardReadPayload.ts';
import { insertEvent } from '../src/si/eventInserter.ts';

export interface Expected {
  runner: string;
  card: number | null;
  className: string;
  status: string;
  time: number | null;
}

/** One line of manual.ndjson: a secretariat action in MeOS, with its time. */
type ManualAction = { ts_ms: number; card: number | null } & (
  { action?: 'status'; status: ManualStatus } | { action: 'start_time'; start: string | null }
);

export interface Mismatch {
  card: number | null;
  className: string;
  expected: string;
  got: string;
  expectedTime: number | null;
  gotTime: number | null;
  /** fartOLa warned "Saknar starttid"; its suggested start, if any. */
  missingStart?: { suggestedStartMs: number | null };
}

/** A runner who differs from the official (MeOS) result only because
 * fartOLa times from the start time and MeOS from the start punch. */
export interface MeosDifference {
  card: number | null;
  className: string;
  expectedTime: number | null;
  /** fartOLa's time (s), from the start time. */
  gotTime: number | null;
  /** The time (s) with start_method 'start_punch', as MeOS. */
  meosTime: number | null;
}

export interface ReplayReport {
  total: number;
  equal: number;
  mismatches: Mismatch[];
  meosDifferences: MeosDifference[];
  imports: Record<string, unknown>;
  unknownCards: number[];
}

/** IOF result status → the fartOLa statuses that mean the same thing. */
const SAME: Record<string, string[]> = {
  OK: ['OK'],
  MissingPunch: ['MP'],
  DidNotFinish: ['DNF'],
  DidNotStart: ['PEND', 'DNS'],
  OverTime: ['MAX'],
  Disqualified: ['DQ'],
};

async function upload(app: FastifyInstance, url: string, file: string): Promise<unknown> {
  const bytes = readFileSync(file);
  const form = new FormData();
  form.set(
    'file',
    new File([new Uint8Array(bytes)], path.basename(file), { type: 'application/xml' })
  );
  const req = new Request('http://x/', { method: 'POST', body: form });
  const res = await app.inject({
    method: 'POST',
    url,
    payload: Buffer.from(await req.arrayBuffer()),
    headers: { 'content-type': req.headers.get('content-type') ?? '' },
  });
  if (res.statusCode >= 300) throw new Error(`${url}: ${res.statusCode} ${res.body}`);
  return res.json();
}

export async function replay(
  dir: string,
  opts: { meosStart?: boolean } = {}
): Promise<ReplayReport> {
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf-8')) as {
    source: { event: string; date: string };
  };
  const reads = readFileSync(path.join(dir, 'readouts.ndjson'), 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as CardReadEvent);
  const expected = JSON.parse(readFileSync(path.join(dir, 'expected.json'), 'utf-8')) as Expected[];

  const handle = openDatabase(':memory:');
  const nodeId = ensureNodeId(handle);
  const app = await buildServer({ logger: false, dbHandle: handle, nodeId });
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/competitions',
      payload: { name: manifest.source.event, date: manifest.source.date },
    });
    const competitionId = (created.json() as { id: string }).id;
    const base = `/api/competitions/${competitionId}`;
    const imports = {
      courses: await upload(app, `${base}/import`, path.join(dir, 'CourseData.xml')),
      entries: await upload(app, `${base}/import`, path.join(dir, 'EntryList.xml')),
      starts: await upload(app, `${base}/import/startlist`, path.join(dir, 'StartList.xml')),
    };
    // The start-race route stamps Date.now(); a replay must start the race
    // before its first read-out instead, so write what the route writes.
    const startedAtMs = Math.min(...reads.map((r) => r.ts_ms)) - 3_600_000;
    insertEvent(
      handle,
      nodeId,
      'race_started',
      startedAtMs,
      { event_type: 'race_started', started_at_ms: startedAtMs },
      competitionId
    );
    handle.db
      .update(competitions)
      .set({ raceStartedAtMs: startedAtMs })
      .where(eq(competitions.id, competitionId))
      .run();

    for (const read of reads) {
      // Same stored shape as the SI bridge (si/cardReadPayload.ts): the
      // NDJSON envelope fields go, event becomes event_type.
      const card: Partial<CardReadEvent> = { ...read };
      delete card.schema_version;
      delete card.event;
      delete card.ts_ms;
      delete card.device_path;
      const payload = { event_type: 'card_read', ...card } as CardReadPayload;
      insertEvent(handle, nodeId, 'card_read', read.ts_ms, payload, competitionId);
    }

    // Statuses the MeOS secretariat set by hand (manual.ndjson), replayed as
    // the same operator action in fartOLa at the time it was made.
    const manualPath = path.join(dir, 'manual.ndjson');
    const manual = existsSync(manualPath)
      ? readFileSync(manualPath, 'utf-8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l) as ManualAction)
      : [];
    const idByCard = new Map(
      handle.db
        .select({ id: competitors.id, card: competitors.cardNumber })
        .from(competitors)
        .where(eq(competitors.competitionId, competitionId))
        .all()
        .filter((c) => c.card !== null)
        .map((c) => [c.card!, c.id])
    );
    for (const m of manual) {
      const competitorId = m.card === null ? undefined : idByCard.get(m.card);
      if (!competitorId) continue;
      if (m.action === 'start_time') {
        // Start times are a column, not an event: set through the route.
        const res = await app.inject({
          method: 'PATCH',
          url: `${base}/competitors/${competitorId}/start-time`,
          payload: { start_time_ms: m.start === null ? null : Date.parse(m.start) },
        });
        if (res.statusCode >= 300) throw new Error(`start-time: ${res.statusCode} ${res.body}`);
        continue;
      }
      insertEvent(
        handle,
        nodeId,
        'manual_status_set',
        m.ts_ms,
        {
          event_type: 'manual_status_set',
          competitor_id: competitorId,
          status: m.status,
          reason: 'Satt för hand i MeOS (replay)',
        },
        competitionId
      );
    }

    const input = loadCompetitionInputs(handle, competitionId);
    if (!input) throw new Error('competition vanished');
    // MeOS times from the start punch: the same input with start_method
    // 'start_punch' in every class.
    const meosState = reduce({
      ...input,
      classes: input.classes.map((c) => ({ ...c, startMethod: 'start_punch' as const })),
    });
    const state = opts.meosStart ? meosState : reduce(input);
    const seconds = (ms: number | null | undefined): number | null =>
      ms == null ? null : Math.round(ms / 1000);
    /** One runner's verdict in a projection: equal to the official result? */
    const verdict = (s: CompetitionState, e: Expected) => {
      const view = e.card
        ? [...s.competitors.values()].find((c) => c.card_number === e.card)
        : undefined;
      const got = view?.status ?? 'NOT_IMPORTED';
      const gotTime = seconds(view?.elapsed_time_ms);
      const statusOk = (SAME[e.status] ?? [e.status]).includes(got);
      // Untimed class: the published result must show no time (what the
      // result list shows). Otherwise a missing official time means status
      // only (e.g. OK set by hand).
      const shownMs = view
        ? ([...s.results_by_class.values()].flat().find((r) => r.competitor_id === view.id)
            ?.elapsed_time_ms ?? null)
        : null;
      const timeOk = view?.no_timing
        ? shownMs === null
        : e.status !== 'OK' ||
          e.time === null ||
          (gotTime !== null && Math.abs(gotTime - e.time) <= 1);
      return { view, got, gotTime, ok: statusOk && timeOk };
    };

    const mismatches: Mismatch[] = [];
    const meosDifferences: MeosDifference[] = [];
    let equal = 0;
    for (const e of expected) {
      const { view, got, gotTime, ok } = verdict(state, e);
      const meos = opts.meosStart ? null : verdict(meosState, e);
      if (ok) equal++;
      else if (meos?.ok)
        meosDifferences.push({
          card: e.card,
          className: e.className,
          expectedTime: e.time,
          gotTime,
          meosTime: meos.gotTime,
        });
      else
        mismatches.push({
          card: e.card,
          className: e.className,
          expected: e.status,
          got,
          expectedTime: e.time,
          gotTime,
          ...(view?.missing_start
            ? { missingStart: { suggestedStartMs: view.suggested_start_ms } }
            : {}),
        });
    }
    return {
      total: expected.length,
      equal,
      mismatches,
      meosDifferences,
      imports,
      unknownCards: state.pending_unknown_cards,
    };
  } finally {
    await app.close();
    handle.close();
  }
}

const mmss = (s: number | null): string =>
  s === null ? '–' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function formatReport(r: ReplayReport): string {
  const diffs = r.meosDifferences.length;
  const out = [
    `${r.equal}/${r.total} lika som officiella resultatet` +
      (diffs ? `, ${diffs} skillnad mot MeOS (start, se nedan)` : ''),
  ];
  const kinds = new Map<string, number>();
  for (const m of r.mismatches) {
    const k = `${m.expected} → ${m.got}${m.expected === 'OK' && m.got === 'OK' ? ' (tid)' : ''}`;
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
  }
  for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1]))
    out.push(`  ${n.toString().padStart(4)}  ${k}`);
  if (r.unknownCards.length) out.push(`  okända brickor vid utläsning: ${r.unknownCards.length}`);
  const byClass = new Map<string, Mismatch[]>();
  for (const m of r.mismatches) byClass.set(m.className, [...(byClass.get(m.className) ?? []), m]);
  for (const [cls, ms] of [...byClass].sort()) {
    out.push(`\n${cls}`);
    for (const m of ms)
      out.push(
        `  bricka ${m.card ?? '–'}: väntat ${m.expected} ${mmss(m.expectedTime)}, fick ${m.got} ${mmss(m.gotTime)}` +
          (m.missingStart
            ? ` — varnad: saknar starttid, förslag ${m.missingStart.suggestedStartMs === null ? '–' : formatLocalTime(m.missingStart.suggestedStartMs)}`
            : '')
      );
  }
  if (diffs) {
    out.push(
      `\nSkillnad mot MeOS (SOFT TR 4.18.9 (2026-07-01)): tid från starttiden, inte startstämplingen`
    );
    for (const d of r.meosDifferences)
      out.push(
        `  ${d.className} bricka ${d.card ?? '–'}: MeOS ${mmss(d.meosTime)}, fartOLa ${mmss(d.gotTime)}`
      );
  }
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.env['FARTOLA_REPLAY_DIR'];
  if (!dir) {
    console.error('Sätt FARTOLA_REPLAY_DIR till en replay-mapp (fartOLa-tools/replay).');
    process.exit(2);
  }
  const report = await replay(dir, { meosStart: process.argv.includes('--meos-start') });
  console.log(
    JSON.stringify(
      report.imports,
      (k, v) => (Array.isArray(v) && v.length > 20 ? `[${v.length} st]` : v),
      2
    )
  );
  console.log(formatReport(report));
}
