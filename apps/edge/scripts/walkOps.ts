// Authored for fartola. Not ported from upstream.
//
// The steps of a walk (scripts/walk.ts): what an operator, a helper or a
// card reader can do to a running server. A step is plain data, so a failing
// sequence can be printed, shrunk and pasted into a test:
//
//   { op, k?, a, b, c, dt, rnd }
//
// `k` is the variant of the op, `a` `b` `c` are numbers the op turns into a
// runner, a class, a value (always modulo what exists when the step runs, so
// a step still means something after others are dropped), `dt` is how far
// the clock moves before the step and `rnd` seeds the server's random
// numbers during it.
//
// Confirmations are two steps on purpose: one that asks and notes what the
// server answered (world.notes), one that confirms with the note. Other
// steps may come between, so a confirmation can be older than what it
// confirms. That was the shape of the faults of 2026-10-12.
//
// A step may return the way back from what it did: a function that undoes
// it on a copy of the world. The walk checks that the copy then equals the
// state before the step.

import {
  DAY,
  activeCompetition,
  FIRST_START_MS,
  courseDataXml,
  entries,
  entryListXml,
  fake,
  fresh,
  rng,
  send,
  startListXml,
  type Step,
  type WayBack,
  type World,
} from './walkWorld.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const at = <T>(xs: readonly T[], n: number): T | undefined => xs[n % xs.length];
/** Most steps go to the main competition, one in eight to the second one. */
const compOf = (w: World, s: Step): string => w.comps[s.c % 8 === 0 ? 1 : 0]!;
const baseOf = (id: string): string => `/api/competitions/${id}`;
const REASON = 'Satt av sekretariatet';

async function runnersOf(w: World, id: string): Promise<Any[]> {
  return (await send(w, 'GET', `${baseOf(id)}/competitors`)).json.competitors ?? [];
}
async function detail(
  w: World,
  id: string
): Promise<{ competition: Any; classes: Any[]; courses: Any[] }> {
  return (await send(w, 'GET', baseOf(id))).json;
}
/** The control codes of a class's course, in order. */
function codesOf(d: { classes: Any[]; courses: Any[] }, classId: string): number[] {
  const cls = d.classes.find((c) => c.id === classId);
  const course =
    d.courses.find((c) => c.id === cls?.course_id) ?? d.courses.find((c) => c.class_id === classId);
  return (course?.controls ?? []).map((c: Any) => c.control_code);
}
/** One runner of the step's competition, with its paths. */
async function pick(
  w: World,
  s: Step
): Promise<{ id: string; base: string; r: Any; path: string } | null> {
  const id = compOf(w, s);
  const r = at(await runnersOf(w, id), s.a);
  return r ? { id, base: baseOf(id), r, path: `${baseOf(id)}/competitors/${r.id}` } : null;
}

const RESETS = ['race_reset', 'race_reset_undone'];
const RACE_PHASE = ['race_started', ...RESETS];
/** The newest event of some types in a competition: what a confirmation was
 * made for. A confirmation sent after it has moved is stale; when the server
 * still acts on it, check 4 fails. */
function phaseOf(w: World, id: string, types: string[]): number {
  const row = w.handle.sqlite
    .prepare(
      `SELECT max(local_seq) AS seq FROM events
       WHERE competition_id = ? AND event_type IN (${types.map(() => '?').join(',')})`
    )
    .get(id, ...types) as { seq: number | null };
  return row.seq ?? 0;
}

/** The newest start-time event, to tell whether a step wrote one. */
async function newestStartEvent(w: World, id: string): Promise<Any | undefined> {
  return (await send(w, 'GET', `${baseOf(id)}/start-times/history`)).json.items?.[0];
}
/** Run a step that may change start times; its way back is the undo of the
 * start-time event it wrote. */
async function withStartUndo(
  w: World,
  id: string,
  fn: () => Promise<unknown>
): Promise<WayBack | void> {
  const before = await newestStartEvent(w, id);
  await fn();
  const after = await newestStartEvent(w, id);
  if (after === undefined || after.local_seq === before?.local_seq) return;
  return (copy) =>
    send(copy, 'POST', `${baseOf(id)}/start-times/undo`, {
      node_id: after.node_id,
      local_seq: after.local_seq,
    });
}

/** Clear a status set by hand; the way back is to set it again. */
async function takeBackStatus(
  w: World,
  p: { id: string; path: string; r: Any },
  route: 'clear-status' | 'un-dnf'
): Promise<WayBack | void> {
  const was = fresh(w, p.id).competitors.get(p.r.id);
  const res = await send(w, 'POST', `${p.path}/${route}`);
  if (res.status === 201 && was?.manual_status) {
    return (copy) =>
      send(copy, 'POST', `${p.path}/status`, {
        status: was.manual_status,
        reason: was.manual_dnf_reason,
      });
  }
}

/** Seconds since midnight on the competition clock: what an SI card stores. */
const cardSeconds = (ms: number, offsetMin: number): number =>
  Math.floor(((((ms + offsetMin * 60_000) % 86_400_000) + 86_400_000) % 86_400_000) / 1000);

/** A card as a runner would bring it to the read-out: started at the start
 * time (without one, the run and half a minute ago), finished after a run of
 * 15 to 75 minutes or just now, with the course's controls between. */
async function cardFor(w: World, s: Step, id: string): Promise<Any | null> {
  const d = await detail(w, id);
  const r = at(await runnersOf(w, id), s.a);
  if (s.k === 'unknown') return { card: 8900000 + (s.a % 40), codes: [31, 32], d, runSec: 600 };
  if (!r || r.card_number === null) return null;
  const codes = codesOf(d, r.class_id);
  if (s.k === 'mp') codes.splice(s.b % Math.max(1, codes.length), 1);
  return { card: r.card_number, codes, d, runSec: 900 + (s.b % 3600), start: r.start_time_ms };
}

interface Op {
  /** How often the walk picks it. */
  w: number;
  ks?: readonly string[];
  run: (w: World, s: Step) => Promise<WayBack | void>;
}

/** Routes that answer without hardware, a key or a queue: deterministic
 * refusals in a walk. They are poked for check 1 only. */
const POKES = [
  ['POST', 'classes/kinds/from-eventor'],
  ['POST', 'fees/from-eventor'],
  ['POST', 'eventor/push-results'],
  ['POST', 'eventor/push-startlist'],
  ['POST', 'eventor-import', { eventId: 1 }],
  ['POST', 'liveresultat/push'],
  ['POST', 'checkunit/snapshot'],
  ['POST', '/api/__admin/run-backup-now'],
  ['POST', '/api/__admin/run-retention-now'],
  ['POST', '/api/__admin/eventor/refresh'],
  ['POST', '/api/sessions/reconnect-bridge'],
  ['POST', '/api/__dev/eventor-seed'],
] as const;

export const OPS: Record<string, Op> = {
  // --- the race phase ------------------------------------------------------
  start: {
    w: 8,
    run: async (w, s) => void (await send(w, 'POST', `${baseOf(compOf(w, s))}/start-race`)),
  },
  /** "Återställ start". A refusal is noted, for resetConfirm. */
  reset: {
    w: 5,
    run: async (w, s) => {
      const id = compOf(w, s);
      const res = await send(w, 'POST', `${baseOf(id)}/reset-race`);
      if (res.status === 409 && res.json.error === 'reads_since_start') {
        w.notes['reset'] = {
          id,
          started_at_ms: res.json.started_at_ms,
          phase: phaseOf(w, id, RACE_PHASE),
        };
      }
      // A reset that went through took nothing: starting again is the way back.
      if (res.status === 201) return (copy) => send(copy, 'POST', `${baseOf(id)}/start-race`);
    },
  },
  /** Confirm the reset warning seen earlier, however long ago. */
  resetConfirm: {
    w: 8,
    run: async (w) => {
      const n = w.notes['reset'];
      if (!n) return;
      const url = `${baseOf(n.id)}/reset-race`;
      const stale = phaseOf(w, n.id, RACE_PHASE) !== n.phase;
      const res = await send(w, 'POST', url, { force: true, started_at_ms: n.started_at_ms });
      if (res.status !== 201) return;
      if (stale)
        w.stale.push('a reset confirmed before the race was started, reset or restored again');
      return async (copy) => {
        const undo = (await send(copy, 'GET', `${url}/undo`)).json?.undo;
        if (undo) {
          await send(copy, 'POST', `${url}/undo`, {
            node_id: undo.node_id,
            local_seq: undo.local_seq,
          });
        }
      };
    },
  },
  undoAsk: {
    w: 4,
    run: async (w, s) => {
      const id = compOf(w, s);
      const undo = (await send(w, 'GET', `${baseOf(id)}/reset-race/undo`)).json?.undo;
      if (undo) {
        w.notes['undo'] = {
          id,
          node_id: undo.node_id,
          local_seq: undo.local_seq,
          phase: phaseOf(w, id, RESETS),
        };
      }
    },
  },
  undoConfirm: {
    w: 4,
    run: async (w) => {
      const n = w.notes['undo'];
      if (!n) return;
      // A new start does not make the undo stale: reset, then start again,
      // is the mistake the undo is for (routes/_resetUndo.ts).
      const stale = phaseOf(w, n.id, RESETS) !== n.phase;
      const res = await send(w, 'POST', `${baseOf(n.id)}/reset-race/undo`, {
        node_id: n.node_id,
        local_seq: n.local_seq,
      });
      if (res.status === 201 && stale) {
        w.stale.push('an undo confirmed before another reset or undo was made');
      }
    },
  },

  // --- cards ---------------------------------------------------------------
  /** A card in the reader: through the SI bridge, to the active competition. */
  read: {
    w: 70,
    ks: ['ok', 'ok', 'ok', 'ok', 'mp', 'dnf', 'unknown', 'nostart'],
    run: async (w, s) => {
      const c = await cardFor(w, s, compOf(w, s));
      if (!c) return;
      const offset = c.d.competition.clock_offset_min;
      const startMs = c.start ?? fake.now - (c.runSec + 30) * 1000;
      const finishMs = Math.min(startMs + c.runSec * 1000, fake.now - 5000);
      const sec = (ms: number): number => cardSeconds(ms, offset);
      w.reads.push({ card: c.card, competitionId: activeCompetition(w) });
      w.station!.emit('cardRead', {
        cardNumber: c.card,
        raceResult: {
          cardNumber: c.card,
          checkTime: sec(startMs - 120_000),
          // No start punch: "Saknar starttid" where the time runs from it.
          ...(s.k === 'nostart' ? {} : { startTime: sec(startMs) }),
          ...(s.k === 'dnf' ? {} : { finishTime: sec(finishMs) }),
          punches: c.codes.map((code: number, i: number) => ({
            code,
            time: sec(startMs + ((finishMs - startMs) * (i + 1)) / (c.codes.length + 1)),
          })),
        },
      });
    },
  },
  /** The dev route: a read sent to a named competition, active or not. */
  devRead: {
    w: 4,
    ks: ['ok', 'mp', 'unknown'],
    run: async (w, s) => {
      const id = compOf(w, s);
      const c = await cardFor(w, s, id);
      if (!c) return;
      const clock = (ms: number): Any => {
        const t = cardSeconds(ms, c.d.competition.clock_offset_min);
        return { seconds_in_half_day: t % 43_200, half_day: t >= 43_200 ? 1 : 0, weekday: null };
      };
      const startMs = c.start ?? fake.now - (c.runSec + 30) * 1000;
      const res = await send(w, 'POST', '/api/__dev/simulate-read', {
        competition_id: id,
        card_number: c.card,
        card_type: 'SIAC',
        punches: c.codes.map((control_code: number) => ({ control_code, time_ms: null })),
        start: clock(startMs),
        finish: clock(Math.min(startMs + c.runSec * 1000, fake.now - 5000)),
      });
      if (res.status === 201) w.reads.push({ card: c.card, competitionId: id });
    },
  },
  radio: {
    w: 2,
    run: async (w, s) => {
      const p = await pick(w, s);
      if (!p || p.r.card_number === null) return;
      await send(w, 'POST', '/api/__dev/simulate-radio', {
        competition_id: p.id,
        card_number: p.r.card_number,
        control_code: 31 + (s.b % 5),
        time_ms: fake.now - 60_000,
      });
    },
  },
  activate: {
    w: 4,
    run: async (w, s) =>
      void (await send(w, 'POST', '/api/sessions/active-competition', {
        competition_id: w.comps[s.a % 4 === 0 ? 1 : 0],
      })),
  },
  deactivate: {
    w: 1,
    run: async (w) => void (await send(w, 'DELETE', '/api/sessions/active-competition')),
  },

  // --- runners -------------------------------------------------------------
  addRunner: {
    w: 4,
    ks: ['card', 'card', 'nocard', 'hired'],
    run: async (w, s) => {
      const id = compOf(w, s);
      const n = (await runnersOf(w, id)).length;
      const cls = at((await detail(w, id)).classes, s.a);
      if (!cls) return;
      await send(w, 'POST', '/api/competitors', {
        competition_id: id,
        name: `Ny Löpare ${n + 1}`,
        club: 'OK Granen',
        class_id: cls.id,
        card_number: s.k === 'nocard' ? null : 8200000 + (s.b % 30),
        consent: true,
        ...(s.k === 'hired'
          ? {
              hired_card: true,
              hired_contact: { name: 'Ny Löpare', phone: '000-000 00 00', email: null, note: null },
            }
          : {}),
      });
    },
  },
  /** "Byt bricka" at the read-out; the answer carries the undo token. */
  replaceCard: {
    w: 4,
    run: async (w, s) => {
      const p = await pick(w, s);
      if (!p) return;
      const res = await send(w, 'POST', '/api/competitors', {
        competition_id: p.id,
        replace_card_for_competitor_id: p.r.id,
        card_number: 8300000 + (s.b % 30),
      });
      const e = res.json?.card_event;
      if (res.status !== 200 || !e) return;
      w.notes['bind'] = {
        id: p.id,
        node_id: e.node_id,
        local_seq: e.local_seq,
        runner: p.r.id,
        card: 8300000 + (s.b % 30),
      };
      return (copy) =>
        send(copy, 'POST', `${p.base}/card-binds/undo`, {
          node_id: e.node_id,
          local_seq: e.local_seq,
        });
    },
  },
  undoBind: {
    w: 3,
    run: async (w) => {
      const n = w.notes['bind'];
      if (!n) return;
      const res = await send(w, 'POST', `${baseOf(n.id)}/card-binds/undo`, {
        node_id: n.node_id,
        local_seq: n.local_seq,
      });
      // The way back from the undo is to change the card again.
      if (res.status === 201) {
        return (copy) =>
          send(copy, 'POST', '/api/competitors', {
            competition_id: n.id,
            replace_card_for_competitor_id: n.runner,
            card_number: n.card,
          });
      }
    },
  },
  /** The "Ändra" dialog. The way back is to type the old value again. */
  profile: {
    w: 10,
    ks: ['card', 'card', 'otherCard', 'noCard', 'class', 'class', 'name', 'club', 'bib', 'paid'],
    run: async (w, s) => {
      const p = await pick(w, s);
      if (!p) return;
      const all = await runnersOf(w, p.id);
      const classes = (await detail(w, p.id)).classes;
      const change: Record<string, [string, unknown]> = {
        card: ['card_number', 8400000 + (s.b % 30)],
        otherCard: ['card_number', at(all, s.b)?.card_number ?? null],
        noCard: ['card_number', null],
        class: ['class_id', at(classes, s.b)?.id],
        name: ['name', `Omdöpt Löpare ${s.b % 20}`],
        club: ['club', s.b % 2 ? 'Tallens IF' : null],
        bib: ['bib', s.b % 3 ? String(300 + (s.b % 10)) : null],
        paid: ['paid_amount', (s.b % 3) * 50],
      };
      const [field, value] = change[s.k!]!;
      const url = `/api/competitors/${p.r.id}/profile`;
      const res = await send(w, 'PATCH', url, { [field]: value });
      if (res.status === 200 && field !== 'paid_amount') {
        return (copy) => send(copy, 'PATCH', url, { [field]: p.r[field] });
      }
    },
  },
  consent: {
    w: 1,
    run: async (w, s) => {
      const p = await pick(w, s);
      if (!p) return;
      await send(w, 'PATCH', `/api/competitors/${p.r.id}`, {
        consent_status: 'confirmed_on_read',
        consent_at_ms: fake.now,
      });
    },
  },
  startTime: {
    w: 4,
    ks: ['set', 'set', 'clear'],
    run: async (w, s) => {
      const p = await pick(w, s);
      if (!p) return;
      return withStartUndo(w, p.id, () =>
        send(w, 'PATCH', `${p.path}/start-time`, {
          start_time_ms: s.k === 'clear' ? null : FIRST_START_MS + (s.b % 90) * 60_000,
        })
      );
    },
  },

  // --- statuses and corrections by hand -------------------------------------
  status: {
    w: 6,
    ks: ['DNF', 'DNS', 'DQ', 'CANCEL', 'MAX', 'MP'],
    run: async (w, s) => {
      const p = await pick(w, s);
      if (!p) return;
      const was = fresh(w, p.id).competitors.get(p.r.id)?.manual_status;
      const res = await send(w, 'POST', `${p.path}/status`, { status: s.k, reason: REASON });
      if (res.status === 201 && was === null)
        return (copy) => send(copy, 'POST', `${p.path}/clear-status`);
    },
  },
  clearStatus: {
    w: 3,
    run: async (w, s) => {
      const p = await pick(w, s);
      if (p) return takeBackStatus(w, p, 'clear-status');
    },
  },
  manualDnf: {
    w: 1,
    run: async (w, s) => {
      const p = await pick(w, s);
      if (!p) return;
      const was = fresh(w, p.id).competitors.get(p.r.id)?.manual_status;
      const res = await send(w, 'POST', `${p.path}/manual-dnf`, { reason: REASON });
      if (res.status === 201 && was === null)
        return (copy) => send(copy, 'POST', `${p.path}/un-dnf`);
    },
  },
  unDnf: {
    w: 1,
    run: async (w, s) => {
      const p = await pick(w, s);
      if (p) return takeBackStatus(w, p, 'un-dnf');
    },
  },
  voidLeg: {
    w: 2,
    run: async (w, s) => {
      const p = await pick(w, s);
      if (!p) return;
      const code = at(codesOf(await detail(w, p.id), p.r.class_id), s.b) ?? 31;
      const was = fresh(w, p.id).competitors.get(p.r.id)?.voided_legs.includes(code);
      const res = await send(w, 'POST', `${p.path}/void-leg`, {
        control_code: code,
        reason: REASON,
      });
      if (res.status === 201 && !was) {
        return (copy) => send(copy, 'POST', `${p.path}/unvoid-leg`, { control_code: code });
      }
    },
  },
  unvoidLeg: {
    w: 1,
    run: async (w, s) => {
      const p = await pick(w, s);
      if (p) await send(w, 'POST', `${p.path}/unvoid-leg`, { control_code: 31 + (s.b % 5) });
    },
  },
  /** "Sätt ej utlästa till Ej start" and its undo. */
  unreadDns: {
    w: 2,
    run: async (w, s) => {
      const id = compOf(w, s);
      const base = baseOf(id);
      // The undo takes back every runner set this way, also by an earlier
      // click: it is the way back from this step only when it is the first.
      const first = ![...fresh(w, id).competitors.values()].some(
        (v) => v.manual_status === 'DNS' && v.manual_dnf_reason === 'Ej utläst: satt till Ej start'
      );
      const res = await send(w, 'POST', `${base}/unread-dns`);
      if (res.status === 201 && res.json.count > 0 && first) {
        return (copy) => send(copy, 'POST', `${base}/unread-dns/undo`);
      }
    },
  },
  unreadDnsUndo: {
    w: 2,
    run: async (w, s) => void (await send(w, 'POST', `${baseOf(compOf(w, s))}/unread-dns/undo`)),
  },
  manualFinish: {
    w: 3,
    run: async (w, s) => {
      const p = await pick(w, s);
      if (!p) return;
      const was = fresh(w, p.id).competitors.get(p.r.id)?.manual_finish_ms;
      const res = await send(w, 'POST', `${p.path}/manual-finish`, {
        finish_ms: fake.now - (s.b % 600) * 1000,
        reason: REASON,
      });
      if (res.status === 201 && was === null) {
        return (copy) => send(copy, 'POST', `${p.path}/clear-manual-finish`);
      }
    },
  },
  clearManualFinish: {
    w: 1,
    run: async (w, s) => {
      const p = await pick(w, s);
      if (p) await send(w, 'POST', `${p.path}/clear-manual-finish`);
    },
  },
  manualPunch: {
    w: 2,
    run: async (w, s) => {
      const p = await pick(w, s);
      if (!p) return;
      const code = at(codesOf(await detail(w, p.id), p.r.class_id), s.b) ?? 31;
      const had = fresh(w, p.id).competitors.get(p.r.id)?.manual_punches.length;
      const res = await send(w, 'POST', `${p.path}/manual-punch`, {
        control_code: code,
        reason: REASON,
      });
      if (res.status === 201 && had === 0) {
        return (copy) =>
          send(copy, 'POST', `${p.path}/remove-manual-punch`, { control_code: code });
      }
    },
  },
  removeManualPunch: {
    w: 1,
    run: async (w, s) => {
      const p = await pick(w, s);
      if (p)
        await send(w, 'POST', `${p.path}/remove-manual-punch`, { control_code: 31 + (s.b % 5) });
    },
  },
  timeAddition: {
    w: 2,
    run: async (w, s) => {
      const p = await pick(w, s);
      if (!p) return;
      const was = fresh(w, p.id).competitors.get(p.r.id)?.time_addition_min;
      const res = await send(w, 'POST', `${p.path}/time-addition`, {
        minutes: 1 + (s.b % 5),
        reason: REASON,
      });
      if (res.status === 201 && was === 0) {
        return (copy) => send(copy, 'POST', `${p.path}/clear-time-addition`);
      }
    },
  },
  clearTimeAddition: {
    w: 1,
    run: async (w, s) => {
      const p = await pick(w, s);
      if (p) await send(w, 'POST', `${p.path}/clear-time-addition`);
    },
  },

  // --- the competition, its classes and courses ------------------------------
  patchComp: {
    w: 5,
    ks: [
      'name',
      'date',
      'offset',
      'offsetNull',
      'timing',
      'level',
      'distance',
      'autoPrint',
      'template',
    ],
    run: async (w, s) => {
      const id = compOf(w, s);
      const was = (await detail(w, id)).competition;
      const change: Record<string, [string, unknown]> = {
        name: ['name', `Höstträffen ${s.b % 5}`],
        // The other date is after the change to winter time: another offset.
        date: ['date', was.date === DAY ? '2026-10-31' : DAY],
        offset: ['clock_offset_min', [60, 120, 180][s.b % 3]],
        offsetNull: ['clock_offset_min', null],
        timing: ['timing_format', s.b % 2 ? 'tenths' : 'seconds'],
        level: ['level', [null, 'niva2', 'niva4', 'traning'][s.b % 4]],
        distance: ['distance', [null, 'medel', 'lang'][s.b % 3]],
        autoPrint: ['auto_print', s.b % 2 === 0],
        template: ['receipt_template', ['classic', 'detailed', 'kids'][s.b % 3]],
      };
      const [field, value] = change[s.k!]!;
      // The GET shows the offset in force, never "none": the override itself
      // is read from the row.
      const override = (
        w.handle.sqlite
          .prepare('SELECT clock_offset_min AS v FROM competitions WHERE id = ?')
          .get(id) as {
          v: number | null;
        }
      ).v;
      const res = await send(w, 'PATCH', baseOf(id), { [field]: value });
      if (res.status === 200) {
        return (copy) =>
          send(copy, 'PATCH', baseOf(id), {
            [field]: field === 'clock_offset_min' ? override : was[field],
          });
      }
    },
  },
  maxTime: {
    w: 3,
    ks: ['set', 'set', 'none'],
    run: async (w, s) => {
      const id = compOf(w, s);
      const was = (await detail(w, id)).competition.max_time_sec;
      const res = await send(w, 'PATCH', `${baseOf(id)}/max-time`, {
        max_time_sec: s.k === 'none' ? null : 1800 * (1 + (s.b % 4)),
      });
      if (res.status === 200) {
        return (copy) => send(copy, 'PATCH', `${baseOf(id)}/max-time`, { max_time_sec: was });
      }
    },
  },
  patchClass: {
    w: 6,
    ks: ['maxTime', 'noTiming', 'startMethod', 'startMethod', 'bib', 'startName'],
    run: async (w, s) => {
      const id = compOf(w, s);
      const cls = at((await detail(w, id)).classes, s.a);
      if (!cls) return;
      const change: Record<string, [string, unknown, unknown?]> = {
        maxTime: ['maxTimeSec', s.b % 3 ? 1800 * (1 + (s.b % 4)) : null],
        noTiming: ['no_timing', !cls.no_timing, cls.no_timing],
        startMethod: [
          'start_method',
          ['auto', 'start_time', 'start_punch'][s.b % 3],
          cls.start_method,
        ],
        bib: ['bib_base', 100 * (s.b % 9)],
        startName: ['start_name', s.b % 2 ? 'Start 2' : null],
      };
      const [field, value, was] = change[s.k!]!;
      const url = `${baseOf(id)}/classes/${cls.id}`;
      const res = await send(w, 'PATCH', url, { [field]: value });
      if (res.status === 200 && was !== undefined) {
        return (copy) => send(copy, 'PATCH', url, { [field]: was });
      }
    },
  },
  addClass: {
    w: 2,
    run: async (w, s) =>
      void (await send(w, 'POST', `${baseOf(compOf(w, s))}/classes`, {
        name: `Extraklass ${s.a % 6}`,
        class_kind: 'oppen',
      })),
  },
  classKinds: {
    w: 1,
    run: async (w, s) => {
      const id = compOf(w, s);
      const cls = at((await detail(w, id)).classes, s.a);
      if (!cls) return;
      await send(w, 'PUT', `${baseOf(id)}/classes/kinds`, {
        items: [
          {
            class_id: cls.id,
            class_kind: s.b % 2 ? 'oppen' : 'senior',
            age_class: s.b % 2 ? null : 21,
          },
        ],
      });
    },
  },
  addCourse: {
    w: 2,
    ks: ['free', 'assign'],
    run: async (w, s) => {
      const id = compOf(w, s);
      const cls = at((await detail(w, id)).classes, s.a);
      const codes = [31, 32, 33, 34, 35].slice(0, 2 + (s.b % 4));
      await send(w, 'POST', `${baseOf(id)}/courses`, {
        name: `Extrabana ${s.b % 20}`,
        class_id: s.k === 'assign' && cls ? cls.id : null,
        controls: codes.map((control_code, order_idx) => ({ control_code, order_idx })),
      });
    },
  },
  /** "Stryk kontroll" for the whole competition, and back. */
  voidControl: {
    w: 2,
    ks: ['void', 'unvoid'],
    run: async (w, s) => {
      const base = baseOf(compOf(w, s));
      const url = `${base}/voided-controls/${31 + (s.b % 5)}`;
      const voided: number[] =
        (await send(w, 'GET', `${base}/voided-controls`)).json.control_codes ?? [];
      const was = voided.includes(31 + (s.b % 5));
      const res = await send(w, s.k === 'void' ? 'POST' : 'DELETE', url);
      if (res.status === 201 && was === (s.k !== 'void')) {
        return (copy) => send(copy, s.k === 'void' ? 'DELETE' : 'POST', url);
      }
    },
  },

  // --- start times ---------------------------------------------------------
  draw: {
    w: 5,
    ks: ['SOFT', 'SOFT', 'Simultaneous', 'late'],
    run: async (w, s) => {
      const id = compOf(w, s);
      const cls = at((await detail(w, id)).classes, s.a);
      if (!cls) return;
      return withStartUndo(w, id, () =>
        send(
          w,
          'POST',
          `${baseOf(id)}/lottning/${cls.id}`,
          s.k === 'late'
            ? { mode: 'SOFT', drawType: 'RemainingAfter' }
            : {
                mode: s.k,
                firstStartMs: FIRST_START_MS + (s.b % 60) * 60_000,
                intervalSec: s.k === 'Simultaneous' ? 0 : 120,
                ...(s.b % 2 ? { allowStartClash: true, startClashReason: REASON } : {}),
              }
        )
      );
    },
  },
  bibs: {
    w: 1,
    run: async (w, s) => {
      const id = compOf(w, s);
      const cls = at((await detail(w, id)).classes, s.a);
      if (!cls) return;
      await send(w, 'POST', `${baseOf(id)}/lottning/${cls.id}/bibs`, {
        bib_prefix: null,
        bib_base: 100 * (1 + (s.b % 5)),
      });
    },
  },
  seeding: {
    w: 1,
    run: async (w, s) => {
      const id = compOf(w, s);
      const cls = at((await detail(w, id)).classes, s.a);
      if (!cls) return;
      const ids = (await runnersOf(w, id)).filter((r) => r.class_id === cls.id).map((r) => r.id);
      await send(w, 'PUT', `${baseOf(id)}/lottning/${cls.id}/seeding`, {
        groups: ids.length > 1 ? [ids.slice(0, 1), ids.slice(1)] : [],
      });
    },
  },
  /** Look at the start-time history and note one change to undo. */
  startUndoAsk: {
    w: 3,
    run: async (w, s) => {
      const id = compOf(w, s);
      const items: Any[] =
        (await send(w, 'GET', `${baseOf(id)}/start-times/history`)).json.items ?? [];
      const it = at(
        items.filter((i) => !i.undone && i.cause !== 'clock_shift'),
        s.a
      );
      if (it) w.notes['startUndo'] = { id, node_id: it.node_id, local_seq: it.local_seq };
    },
  },
  startUndoConfirm: {
    w: 3,
    run: async (w) => {
      const n = w.notes['startUndo'];
      if (!n) return;
      await send(w, 'POST', `${baseOf(n.id)}/start-times/undo`, {
        node_id: n.node_id,
        local_seq: n.local_seq,
      });
    },
  },
  /** "Fastställ saknade starttider": take every suggestion. */
  missingStarts: {
    w: 2,
    run: async (w, s) => {
      const id = compOf(w, s);
      const items = [...fresh(w, id).competitors.values()]
        .filter((v) => v.missing_start && v.suggested_start_ms !== null)
        .map((v) => ({ competitor_id: v.id, start_time_ms: v.suggested_start_ms }));
      if (items.length === 0) return;
      return withStartUndo(w, id, () =>
        send(w, 'POST', `${baseOf(id)}/missing-starts/apply`, { items })
      );
    },
  },

  // --- files, again ----------------------------------------------------------
  importCourses: {
    w: 3,
    ks: ['same', 'changed'],
    run: async (w, s) =>
      void (await send(w, 'POST', `${baseOf(w.comps[0]!)}/import`, undefined, {
        xml: courseDataXml(s.k === 'changed'),
      })),
  },
  importEntries: {
    w: 3,
    ks: ['same', 'more'],
    run: async (w, s) =>
      void (await send(w, 'POST', `${baseOf(w.comps[0]!)}/import`, undefined, {
        xml: entryListXml(entries(w.seed), s.k === 'more'),
      })),
  },
  /** The start list again; name-only matches are noted for startListConfirm. */
  importStartList: {
    w: 4,
    ks: ['same', 'shifted', 'cards'],
    run: async (w, s) => {
      const id = w.comps[0]!;
      return withStartUndo(w, id, async () => {
        const res = await send(w, 'POST', `${baseOf(id)}/import/startlist`, undefined, {
          xml: startListXml(
            entries(w.seed),
            s.k === 'shifted' ? 5 + (s.b % 20) : 0,
            s.k === 'cards'
          ),
        });
        if (res.status === 201 && res.json.fuzzyMatches?.length > 0) {
          w.notes['fuzzy'] = res.json.fuzzyMatches.map((m: Any) => ({
            competitorId: m.candidate.id,
            startTimeMs: m.imported.startTimeMs,
          }));
        }
      });
    },
  },
  startListConfirm: {
    w: 2,
    run: async (w) => {
      const id = w.comps[0]!;
      const matches = w.notes['fuzzy'];
      if (!matches) return;
      return withStartUndo(w, id, () =>
        send(w, 'POST', `${baseOf(id)}/import/startlist/confirm`, { matches })
      );
    },
  },
  /** Yesterday's results for a pursuit: this competition's own result list. */
  importPrevious: {
    w: 1,
    run: async (w) => {
      const base = baseOf(w.comps[0]!);
      const xml = await w.app.inject({
        method: 'GET',
        url: `${base}/export?format=iof30&status=Final`,
      });
      if (xml.statusCode !== 200) return;
      await send(w, 'POST', `${base}/import/previous-results`, undefined, { xml: xml.body });
    },
  },
  /** MeOS pushes a runner over MOP; it is merged into the active competition. */
  mop: {
    w: 2,
    run: async (w, s) =>
      void (await send(w, 'POST', '/mop', undefined, {
        raw: true,
        xml:
          `<?xml version="1.0" encoding="UTF-8"?><MOPDiff xmlns="http://www.melin.nu/mop">` +
          `<cls id="1">H21</cls><cmp id="${900 + (s.a % 5)}" card="${8500000 + (s.b % 10)}">` +
          `<base cls="1">Furudal, Pim</base></cmp></MOPDiff>`,
      })),
  },
  /** The wizard, and a bare new competition: more competitions on the server. */
  newCompetition: {
    w: 1,
    ks: ['wizard', 'bare'],
    run: async (w, s) =>
      void (s.k === 'bare'
        ? await send(w, 'POST', '/api/competitions', { name: `Extratävling ${s.a % 9}`, date: DAY })
        : await send(w, 'POST', '/api/competitions/from-wizard', {
            name: `Guidetävling ${s.a % 9}`,
            date: DAY,
            xml_file: {
              name: 'banor.xml',
              content_base64: Buffer.from(courseDataXml()).toString('base64'),
            },
          })),
  },

  // --- the rest of the settings ---------------------------------------------
  hiredReturn: {
    w: 2,
    run: async (w, s) => {
      const base = baseOf(compOf(w, s));
      const open: Any[] = (await send(w, 'GET', `${base}/hired-cards`)).json.open ?? [];
      const card = at(open, s.a);
      if (card) await send(w, 'PATCH', `${base}/hired-cards/${card.card_number}/return`);
    },
  },
  fees: {
    w: 1,
    run: async (w, s) => {
      const id = compOf(w, s);
      const classes = (await detail(w, id)).classes;
      await send(w, 'PUT', `${baseOf(id)}/fees`, {
        card_fee: 30 + (s.b % 3) * 10,
        classes: classes.map((c) => ({
          class_id: c.id,
          entry_fee: 100,
          youth_entry_fee: 50,
          late_fee_pct: 50,
        })),
      });
    },
  },
  radioSettings: {
    w: 1,
    run: async (w, s) =>
      void (await send(w, 'PATCH', `${baseOf(compOf(w, s))}/radio/settings`, {
        radio_controls: [31 + (s.b % 5)],
        finish_codes: s.b % 2 ? [100] : [],
      })),
  },
  liveresultat: {
    w: 1,
    ks: ['set', 'clear'],
    run: async (w, s) => {
      const url = `${baseOf(compOf(w, s))}/liveresultat/credentials`;
      await (s.k === 'set'
        ? send(w, 'PATCH', url, {
            liveresultat_id: String(1000 + (s.b % 9)),
            liveresultat_pwd: 'hemligt',
          })
        : send(w, 'DELETE', url));
    },
  },
  settings: {
    w: 1,
    ks: ['meos', 'key'],
    run: async (w, s) =>
      void (s.k === 'meos'
        ? await send(w, 'PUT', '/api/settings/meos', { meos_allow_without_password: s.b % 2 === 0 })
        : // Never the Eventor key: with one set, other routes call Eventor.
          await send(w, 'PUT', '/api/settings/integrations', {
            key: 'LIVELOX_API_KEY',
            value: s.b % 2 ? 'walk' : '',
          })),
  },
  /** A helper's event code: made, used to log in, revoked. */
  eventCode: {
    w: 2,
    ks: ['make', 'use', 'revoke'],
    run: async (w, s) => {
      const id = compOf(w, s);
      const n = w.notes['code'];
      if (s.k === 'make') {
        const res = await send(w, 'POST', `${baseOf(id)}/event-codes`);
        if (res.status === 201) w.notes['code'] = { id, codeId: res.json.id, code: res.json.code };
      } else if (n && s.k === 'use') {
        await send(w, 'POST', '/access', { competition_id: n.id, code: n.code });
      } else if (n) {
        await send(w, 'POST', `${baseOf(n.id)}/event-codes/${n.codeId}/revoke`);
      }
    },
  },
  print: {
    w: 1,
    run: async (w, s) => {
      const p = await pick(w, s);
      if (p) await send(w, 'POST', `${p.base}/print-receipt`, { competitor_id: p.r.id });
    },
  },
  poke: {
    w: 3,
    run: async (w, s) => {
      const [method, url, body] = at(POKES, s.a)! as readonly [string, string, unknown?];
      await send(w, method, url.startsWith('/') ? url : `${baseOf(compOf(w, s))}/${url}`, body);
    },
  },
};

const NAMES = Object.keys(OPS);
const TOTAL = NAMES.reduce((sum, n) => sum + OPS[n]!.w, 0);

/** The walk of a seed: `count` steps, the same every time. */
export function stepsOf(seed: number, count: number): Step[] {
  const r = rng(seed);
  return Array.from({ length: count }, () => {
    let roll = r.int(TOTAL);
    const op = NAMES.find((n) => (roll -= OPS[n]!.w) < 0)!;
    const ks = OPS[op]!.ks;
    return {
      op,
      ...(ks ? { k: ks[r.int(ks.length)]! } : {}),
      a: r.int(1000),
      b: r.int(1000),
      c: r.int(1000),
      // One step in six in the same millisecond as the one before.
      dt: r.int(6) === 0 ? 0 : 1000 + r.int(60_000),
      rnd: r.int(1_000_000),
    };
  });
}
