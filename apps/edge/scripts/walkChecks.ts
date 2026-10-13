// Authored for fartola. Not ported from upstream.
//
// The checks of a walk (scripts/walk.ts), run after every step. Each one
// says what must hold whatever order things were done in; a walk fails when
// one does not. Numbers as in
// .planning/todos/pending/2026-10-12-operator-mistake-testing.md:
//
//   1  no 5xx answer, no unhandled rejection, no step that throws
//   2  fresh equals cached: the projection the server holds equals one
//      computed anew from the database
//   3  events alone equal events plus columns: the projection without the
//      two columns that cache events (race start, start times) is the same
//   4  nothing gets worse in silence: fewer runners have a result only
//      after a request on the list MAY_LOWER, confirmed where it asks for
//      it; and the server does not act on a confirmation that is older than
//      what it confirms (walkOps.ts notes when each one was given, or what
//      it was given for)
//   5  a step that names its way back gets the state back with it, and a
//      step that took results away names one
//   6  twice is once: the step's writing requests sent again change nothing
//   7  restart changes nothing: a new server on a copy of the database
//      gives the same projection and the same active competition
//   8  every card read is stored exactly once, on the competition it was
//      read for
//   9  what goes out matches: the IOF result list and the MOP data carry
//      the statuses and times of the projection
//
// "State" in 2, 3, 5, 6 and 7 is the projection of both competitions,
// without last_event_seq (an undo adds events, by design).
//
// A fault that is known and written down is listed in KNOWN: the walk
// counts it and goes on, so it is reported every time and hides nothing.

import { XMLParser } from 'fast-xml-parser';

import { buildMopXml } from '../src/integrations/liveresultat/mopBuilder.ts';
import { loadCompetitionInputs } from '../src/projection/loader.ts';
import { reduce, type ReduceInput } from '../src/projection/reduce.ts';
import type { CompetitionState, PunchStatus } from '../src/projection/types.ts';
import { liveresultatMopMeta } from '../src/routes/liveresultat.ts';
import { resultListInputs } from '../src/routes/_resultListInputs.ts';
import { buildResultListXml, splitName, statusForXml } from '../src/xml/iofExport.ts';
import {
  closeWorld,
  copyWorld,
  flush,
  fresh,
  inCopy,
  resend,
  type Sent,
  type Step,
  type WayBack,
  type World,
} from './walkWorld.ts';

export interface Failure {
  check: number;
  /** Stable name of the kind of failure; a shrunk walk fails with the same. */
  id: string;
  msg: string;
  /** Set when the failure is one of KNOWN. */
  known?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** The projection as plain data in a fixed order. */
export function canon(s: CompetitionState): Any {
  return {
    competitors: [...s.competitors.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    results: [...s.results_by_class.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
    unknown: s.pending_unknown_cards,
    check_to_start: s.check_to_start,
  };
}

/** The first few places two values differ, for the failure text. */
export function diff(a: Any, b: Any, path = '', out: string[] = []): string[] {
  if (out.length >= 4 || JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    out.push(`${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
    return out;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    // A runner is easier to find by name than by index.
    const name = typeof a[k]?.name === 'string' ? `[${a[k].name}]` : `.${k}`;
    diff(a[k], b[k], path + name, out);
  }
  return out;
}

export interface Snap {
  /** canon() of each competition, as JSON. */
  json: string[];
  /** Runners with a result (any status but PEND), per competition. */
  results: number[];
}

const withResult = (s: CompetitionState): number =>
  [...s.competitors.values()].filter((v) => v.status !== 'PEND').length;

export function snapshot(w: World): Snap {
  const states = w.comps.map((id) => fresh(w, id));
  return { json: states.map((s) => JSON.stringify(canon(s))), results: states.map(withResult) };
}

const differs = (a: Snap, b: Snap): string | null => {
  const i = a.json.findIndex((j, n) => j !== b.json[n]);
  return i === -1 ? null : diff(JSON.parse(a.json[i]!), JSON.parse(b.json[i]!)).join('; ');
};

// ---------------------------------------------------------------------------
// The lists the checks rest on. Short on purpose: an entry is a decision.
// ---------------------------------------------------------------------------

/** Check 1: a 503 with one of these codes says "no hardware, queue or key
 * here", which is true in a walk. Any other 5xx is a fault. */
const NOTHING_ATTACHED = new Set([
  'no_reader',
  'no_queue',
  'bridge_not_attached',
  'eventor_no_key',
]);
const broke = (t: Sent): boolean =>
  t.status >= 500 && !(t.status === 503 && NOTHING_ATTACHED.has(t.json?.error));

/** Check 4: the requests after which fewer runners may have a result.
 * `when` narrows an entry to requests with such a body: the confirmation a
 * reset must carry, the field that changes the clock. An entry without it
 * is the operator's own decision about the one thing the request names. */
export const MAY_LOWER: ReadonlyArray<{
  method: string;
  url: RegExp;
  when?: (body: Any) => boolean;
  /** Check 5 asks no way back of it (the reason is in `why`). */
  noWayBack?: true;
  why: string;
}> = [
  {
    method: 'POST',
    url: /\/reset-race$/,
    when: (b) => b?.force === true && typeof b.started_at_ms === 'number',
    why: 'a reset of a real race, confirmed for the start it names',
  },
  {
    method: 'POST',
    url: /\/(clear-status|un-dnf)$/,
    why: 'takes back one status set by hand; a runner without a read is then not read out',
  },
  {
    method: 'PATCH',
    url: /\/api\/competitions\/[^/]+$/,
    when: (b) => b?.clock_offset_min !== undefined || b?.date !== undefined,
    why: 'the competition clock changes: a finish entered by hand keeps its clock time (ADR-0017) and can land before the race start',
  },
  {
    method: 'PATCH',
    url: /\/api\/competitors\/[^/]+\/profile$/,
    when: (b) => b?.lose_result !== undefined,
    why: '"Ändra" of a card, confirmed for the result it takes away (routes/_cardResult.ts)',
  },
  {
    method: 'POST',
    url: /\/api\/competitors$/,
    when: (b) => b?.lose_result !== undefined,
    why: '"Byt bricka", confirmed for the result it takes away',
  },
  {
    method: 'POST',
    url: /\/card-binds\/undo$/,
    why: 'the undo of a card change takes back the read-out the change attached; a read made since needs lose_result (routes/cardBinds.test.ts)',
  },
  {
    method: 'POST',
    url: /\/start-times\/undo$/,
    why: 'the undo of a start list import takes back the cards it gave, and with them a read-out it attached; it is refused after a read made since (routes/import.test.ts)',
  },
  {
    method: 'POST',
    url: /\/unread-dns\/undo$/,
    noWayBack: true,
    why: 'the undo of "set unread to DNS"; doing that again is the way back, but it also takes runners entered since, so the state is not compared',
  },
];

/** Check 6: requests that add something each time, by design. */
const ADDS_EACH_TIME: ReadonlyArray<{ url: RegExp; why: string }> = [
  { url: /\/__dev\/simulate-(read|radio)$/, why: 'a card read twice is two reads' },
  {
    url: /\/manual-punch$/,
    why: 'a course can visit a control twice, so two punches by hand of one code are two punches (projection/corrections.ts)',
  },
];

/** Faults that are known and written down: a failure with this id, after a
 * request to this url, with this in its text. A match is counted and
 * reported, and the walk goes on. */
export const KNOWN: ReadonlyArray<{
  name: string;
  where: string;
  id: string;
  url?: RegExp;
  msg?: RegExp;
}> = [
  {
    name: 'a forced reset sent again after its undo resets the race again',
    where: '.planning/todos/pending/2026-10-12-race-phase-revision.md',
    id: 'stale-confirmation',
    url: /\/reset-race$/,
  },
  {
    // The entry list imported again, and a walk-up entry sent twice.
    name: 'a runner without a card is entered twice',
    where:
      '.planning/todos/pending/2026-10-11-import-dedupe-cardless-runners.md, 2026-05-17-mobile-registration-outbox-idempotency.md',
    id: 'twice-differs',
    url: /\/api\/competitors$|\/import$/,
    msg: /"card_number":null/,
  },
  {
    // Only when every difference listed is a punch the view no longer shows.
    name: 'a DQ taken back and set again does not give the punches back',
    where: '.planning/todos/pending/2026-10-13-dq-before-read-keeps-punches.md',
    id: 'way-back-differs',
    url: /\/(clear-status|un-dnf)$/,
    msg: /before ≠ after: (?:\.competitors\[[^\]]*\]\.latest_punches\.\d+: [^;]* ≠ undefined(?:; |$))+$/,
  },
];

/** A card read in the same millisecond as race_started and stored before it
 * counts live (read time >= the column) but not when the log is replayed
 * (the read sorts before the start). Seen in PR 130 and left as it is;
 * .planning/todos/pending/2026-10-12-race-phase-revision.md. */
const SAME_MS = 'read in the same millisecond as the start, stored before it';

// ---------------------------------------------------------------------------

/** Check 3: the runners whose card was read in the start's millisecond and
 * stored before the start event. */
function readInStartMs(input: ReduceInput): Set<string> {
  const startMs = input.race_started_at_ms;
  const start = input.events.find(
    (e) => e.payload.event_type === 'race_started' && e.payload.started_at_ms === startMs
  );
  const cards = new Set<number>();
  for (const e of input.events) {
    if (
      start !== undefined &&
      e.payload.event_type === 'card_read' &&
      e.eventTimeMs === startMs &&
      e.localSeq < start.localSeq
    ) {
      cards.add(e.payload.card_number);
    }
  }
  return new Set(
    input.competitors
      .filter((c) => c.cardNumber !== null && cards.has(c.cardNumber))
      .map((c) => c.id)
  );
}

function eventsAlone(w: World, id: string): Failure[] {
  const input = loadCompetitionInputs(w.handle, id)!;
  const live = canon(reduce(input));
  const alone = canon(
    reduce({
      ...input,
      race_started_at_ms: null,
      competitors: input.competitors.map((c) => ({ ...c, startTimeMs: null })),
    })
  );
  if (JSON.stringify(live) === JSON.stringify(alone)) return [];
  const differing = live.competitors
    .filter((v: Any, i: number) => JSON.stringify(v) !== JSON.stringify(alone.competitors[i]))
    .map((v: Any) => v.id);
  const sameMs = readInStartMs(input);
  return [
    {
      check: 3,
      id: 'events-differ',
      msg: `live ≠ events alone: ${diff(live, alone).join('; ')}`,
      ...(differing.length > 0 && differing.every((d: string) => sameMs.has(d))
        ? { known: SAME_MS }
        : {}),
    },
  ];
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => ['ClassResult', 'PersonResult', 'cmp'].includes(name),
});

/** MeOS RunnerStatus codes, as liveresultat reads them. */
const MOP_STAT: Record<PunchStatus, number> = {
  OK: 1,
  MP: 3,
  DNF: 4,
  DQ: 5,
  MAX: 6,
  DNS: 20,
  CANCEL: 21,
  PEND: 0,
};

async function whatGoesOut(w: World, id: string, viaRoute: boolean): Promise<Failure[]> {
  const out: Failure[] = [];
  const state = fresh(w, id);
  const input = loadCompetitionInputs(w.handle, id)!;
  const className = new Map(input.classes.map((c) => [c.id, c.name]));

  // MOP, from the projection the server holds, as the push queue takes it.
  const held = w.app.projectionStore.get(id);
  if (held !== null) {
    const mop = xml.parse(
      buildMopXml({
        state: held,
        // Name and date are not compared; the offset only places `st`.
        competition: {
          id: '1',
          name: '',
          date: '2026-10-10',
          clockOffsetMin: input.clock_offset_min,
        },
        ...liveresultatMopMeta(w.handle, id),
      })
    );
    const sent = new Map<string, string>(
      (mop.MOPComplete.cmp ?? []).map((c: Any) => [
        c['@_id'],
        `${c.base['@_stat']}/${c.base['@_rt'] ?? '-'}`,
      ])
    );
    for (const v of state.competitors.values()) {
      const stat = v.status === 'OK' && v.no_timing ? 2 : MOP_STAT[v.status];
      const rt =
        v.elapsed_time_ms !== null && !v.no_timing ? Math.round(v.elapsed_time_ms / 100) : '-';
      if (sent.get(v.id) !== `${stat}/${rt}`) {
        out.push({
          check: 9,
          id: 'mop-differs',
          msg: `MOP: ${v.name} is ${v.status} ${v.elapsed_time_ms}, sent stat/rt ${sent.get(v.id)}`,
        });
        break;
      }
    }
  }

  // The IOF result list, final. Every step it is built as the route builds
  // it; about one step in sixteen it comes from the route itself, which also
  // validates it against the XSD (85 ms, too slow for every step).
  const base = `/api/competitions/${id}`;
  let body: string;
  if (viaRoute) {
    const res = await w.app.inject({
      method: 'GET',
      url: `${base}/export?format=iof30&status=Final`,
    });
    if (res.statusCode !== 200) {
      return [
        ...out,
        {
          check: 9,
          id: 'export-refused',
          msg: `export: ${res.statusCode} ${res.body.slice(0, 300)}`,
        },
      ];
    }
    body = res.body;
  } else {
    const d = (await w.app.inject({ method: 'GET', url: base })).json();
    body = buildResultListXml({
      competition: d.competition,
      classes: d.classes,
      ...resultListInputs(w.handle, id),
      state,
      status: 'Final',
    }).xml;
  }
  const row = (cls: string, name: string, status: string, time: string): string =>
    `${cls} | ${name} | ${status} | ${time}`;
  const sent: string[] = [];
  for (const c of xml.parse(body).ResultList.ClassResult ?? []) {
    for (const p of c.PersonResult ?? []) {
      const n = p.Person.Name;
      sent.push(row(c.Class.Name, `${n.Given} ${n.Family}`, p.Result.Status, p.Result.Time ?? '-'));
    }
  }
  // A runner who has not read out (PEND) is in no list, final or not.
  const expected = [...state.competitors.values()]
    .filter((v) => v.status !== 'PEND')
    .map((v) => {
      const n = splitName(v.name);
      return row(
        className.get(v.class_id) ?? '?',
        `${n.given} ${n.family}`,
        statusForXml(v.status)!,
        v.elapsed_time_ms !== null && !v.no_timing
          ? String(Math.round(v.elapsed_time_ms / 1000))
          : '-'
      );
    });
  const d = diff(expected.sort(), sent.sort());
  if (d.length > 0)
    out.push({ check: 9, id: 'export-differs', msg: `projection ≠ export: ${d.join('; ')}` });
  return out;
}

export interface Done {
  step: Step;
  before: Snap;
  wayBack?: WayBack;
  threw?: unknown;
  rejections: unknown[];
}

/** Run the checks after a step. `only` limits them to some numbers (used
 * while shrinking, where one check is enough). */
export async function runChecks(
  w: World,
  done: Done,
  only?: ReadonlySet<number>
): Promise<{ failures: Failure[]; after: Snap }> {
  const on = (n: number): boolean => only === undefined || only.has(n);
  const failures: Failure[] = [];
  const fail = (check: number, id: string, msg: string): void => {
    failures.push({ check, id, msg });
  };
  const trace = [...w.trace];
  const said = (t: Sent): string =>
    `${t.method} ${t.url.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id')} ${JSON.stringify(t.body ?? '')} → ${t.status} ${JSON.stringify(t.json).slice(0, 100)}`;

  // 2 first: every read of the projection below this point may refresh it.
  if (on(2)) {
    for (const id of w.comps) {
      const held = w.app.projectionStore.get(id);
      if (held === null) continue; // never computed: the next reader computes it
      const d = diff(canon(held), canon(fresh(w, id)));
      if (d.length > 0) fail(2, 'cache-stale', `held ≠ fresh: ${d.join('; ')}`);
    }
  }

  if (on(1)) {
    for (const t of trace.filter(broke)) fail(1, 'answer-5xx', said(t));
    if (done.threw !== undefined)
      fail(1, 'step-threw', String((done.threw as Error)?.stack ?? done.threw));
    for (const r of done.rejections) fail(1, 'unhandled-rejection', String(r));
  }

  const after = snapshot(w);

  if (on(3)) for (const id of w.comps) failures.push(...eventsAlone(w, id));

  const writes = trace.filter((t) => t.method !== 'GET');
  const lowered = after.results.some((n, i) => n < done.before.results[i]!);
  const allowed = MAY_LOWER.find((m) =>
    writes.some(
      (t) =>
        m.method === t.method &&
        m.url.test(t.url) &&
        t.status < 300 &&
        (m.when === undefined || m.when(t.body))
    )
  );
  if (on(4))
    for (const what of w.stale)
      fail(4, 'stale-confirmation', `${what}: ${writes.map(said).join(' ; ')}`);
  if (on(4) && lowered) {
    if (allowed === undefined) {
      fail(
        4,
        'results-fell',
        `runners with a result ${done.before.results.join('+')} → ${after.results.join('+')} after ${writes.map(said).join(' ; ') || 'a card read'}`
      );
    }
  }

  if (on(5)) {
    if (done.wayBack !== undefined) {
      await inCopy(done.step.rnd + 1, async () => {
        const copy = await copyWorld(w);
        try {
          await done.wayBack!(copy);
          await flush();
          for (const t of copy.trace.filter(broke)) fail(5, 'way-back-5xx', said(t));
          const d = differs(done.before, snapshot(copy));
          if (d !== null) {
            fail(
              5,
              'way-back-differs',
              `after ${writes.map(said).join(' ; ')} and back with ${copy.trace.map(said).join(' ; ') || 'nothing'}: before ≠ after: ${d}`
            );
          }
        } finally {
          await closeWorld(copy);
        }
      });
    } else if (lowered && allowed?.noWayBack !== true) {
      fail(
        5,
        'no-way-back',
        `results fell and the step has no way back: ${writes.map(said).join(' ; ')}`
      );
    }
  }

  if (on(6) || on(7)) {
    await inCopy(done.step.rnd, async () => {
      const copy = await copyWorld(w);
      try {
        if (on(7)) {
          const d = differs(after, snapshot(copy));
          if (d !== null) fail(7, 'restart-differs', `running ≠ restarted: ${d}`);
          const active = async (x: World): Promise<unknown> =>
            (await x.app.inject({ method: 'GET', url: '/api/sessions/active-competition' })).json()
              .competition_id;
          const [was, is] = [await active(w), await active(copy)];
          if (was !== is) fail(7, 'restart-active', `active competition ${was} → ${is}`);
        }
        const again = writes.filter((t) => !ADDS_EACH_TIME.some((a) => a.url.test(t.url)));
        if (on(6) && again.length > 0) {
          for (const t of again) await resend(copy, t);
          await flush();
          for (const t of copy.trace.filter(broke)) fail(6, 'twice-5xx', said(t));
          const d = differs(after, snapshot(copy));
          if (d !== null) {
            fail(
              6,
              'twice-differs',
              `${again.map(said).join(' ; ')} sent twice: once ≠ twice: ${d}`
            );
          }
        }
      } finally {
        await closeWorld(copy);
      }
    });
  }

  if (on(8)) {
    const stored = w.handle.sqlite
      .prepare(
        `SELECT competition_id AS competitionId, json_extract(payload, '$.card_number') AS card
         FROM events WHERE event_type = 'card_read' ORDER BY local_seq`
      )
      .all();
    const d = diff(w.reads, stored);
    if (d.length > 0)
      fail(
        8,
        'reads-differ',
        `read ≠ stored (${w.reads.length} read, ${stored.length} stored): ${d.join('; ')}`
      );
  }

  if (on(9))
    for (const id of w.comps)
      failures.push(...(await whatGoesOut(w, id, done.step.rnd % 16 === 0)));

  for (const f of failures) {
    const known = KNOWN.find(
      (k) =>
        k.id === f.id &&
        (k.url === undefined || writes.some((t) => k.url!.test(t.url))) &&
        (k.msg === undefined || k.msg.test(f.msg))
    );
    if (known !== undefined && f.known === undefined) f.known = known.name;
  }
  return { failures, after };
}
