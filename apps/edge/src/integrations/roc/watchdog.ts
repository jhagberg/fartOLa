// Authored for fartola. Not ported from upstream.
//
// Radio watchdog: a pure function over radio punches and read-out card
// punches, all epoch ms (the competition clock is one fixed offset, ADR-0017).
// Per radio control:
//   - last heard, punches received;
//   - coverage: of the read-out card punches at the control in the last M
//     minutes, the share with a radio punch from the same card within ±2 s;
//   - silent: nothing RECEIVED for N minutes while read-out cards passed the
//     control in the last hour AFTER the last radio punch was received. A
//     control on the expected list that never sent anything is silent as
//     soon as card punches at it exist. (Card punches that
//     the radio did hear before it went quiet say nothing about the link, and
//     a control that is simply quiet late in the day must not alarm.)
//   - few: coverage under the threshold, with at least MIN_SAMPLE card
//     punches in the window (three runners, one missed, is not a trend).
// Controls that sent at least once, plus the listed ones, are shown.
// Last heard and silence use the time we received a punch; matching against
// card punches uses the punch's own time. median_delay_ms (received minus
// punch time over the last M min) shows a backlog or a wrong sender clock.
// SIAC (touch-free) coverage is split out: a link that drops them while
// forwarding ordinary cards is flagged (siac_problem).
// Start, check and finish are not controls but UNITS (SI stations with their
// own programmed code, e.g. finish 10 and 20). Radio codes listed as such are
// compared with the card's start/check/finish time stamped by that unit (the
// card's CN); cards that do not say which unit (SI5) are an "unknown unit"
// compared with every radio row of the role. Coverage and the SIAC check are
// per unit: one finish unit dropping SIAC is hidden by a role-level total.
// The date mismatch count is reported next to the state, not as a state.

import type { RadioControlStatus } from '@fartola/shared-types';

export interface RadioPunchIn {
  code: number;
  card: number;
  /** The punch's own time, epoch ms. */
  timeMs: number;
  /** When we received it, epoch ms. Silence, last heard and delay are all
   * epoch arithmetic: a repeated autumn hour must not move them. */
  receivedMs: number;
  /** receivedMs minus the punch's own time, ms. */
  delayMs: number;
  dateMismatch: boolean;
}

export type RadioRole = 'control' | 'start' | 'check' | 'finish';

export interface CardPunchIn {
  /** Control code of an ordinary punch; unused for start/check/finish. */
  code: number;
  /** Set for the card's start, check or finish time. */
  role?: Exclude<RadioRole, 'control'>;
  /** Station code (CN) of the unit that stamped it; null/absent = the card
   * does not say (SI5), an "unknown unit". */
  unit?: number | null;
  card: number;
  /** The punch's own time, epoch ms. */
  timeMs: number;
  /** SIAC card (touch-free capable). The fallback for touch-free below. */
  siac?: boolean;
  /** This punch was touch-free (Air+), as the card's start/finish/check record
   * says (PTD bit 7). Set (true/false) when the card type records it; absent
   * for ordinary punches and older cards, which fall back to `siac`. */
  touchFree?: boolean;
}

export interface WatchdogParams {
  nowMs: number;
  /** Coverage window M, minutes. */
  windowMin?: number;
  /** Silence N, minutes. */
  silenceMin?: number;
  /** Coverage under this is "few". */
  coverageThreshold?: number;
  matchToleranceMs?: number;
  /** Expected radio control codes. */
  expectedCodes?: readonly number[];
  /** Radio codes that are start, check and finish units. A radio row with such
   * a code is compared with the card's start/check/finish time stamped by
   * that unit (CN), not with ordinary punches. */
  roleCodes?: { start: readonly number[]; check: readonly number[]; finish: readonly number[] };
}

export const WATCHDOG_DEFAULTS = {
  windowMin: 20,
  silenceMin: 10,
  coverageThreshold: 0.8,
  matchToleranceMs: 2000,
  /** Card punches in the window needed before coverage is judged. */
  minSample: 5,
  /** SIAC problem: SIAC coverage under this while the others' is at least
   * `coverageThreshold`, with `minSample` of each. */
  siacThreshold: 0.5,
  /** How far back card punches count as "runners are passing". */
  silenceLookbackMin: 60,
} as const;

const MIN_MS = 60_000;

export function evaluateRadioWatchdog(
  radio: RadioPunchIn[],
  card: CardPunchIn[],
  params: WatchdogParams
): RadioControlStatus[] {
  const windowMin = params.windowMin ?? WATCHDOG_DEFAULTS.windowMin;
  const silenceMin = params.silenceMin ?? WATCHDOG_DEFAULTS.silenceMin;
  const threshold = params.coverageThreshold ?? WATCHDOG_DEFAULTS.coverageThreshold;
  const tol = params.matchToleranceMs ?? WATCHDOG_DEFAULTS.matchToleranceMs;
  const { nowMs } = params;

  // A card read twice yields the same punches: count each (card, code, time) once.
  const seen = new Set<string>();
  const cardUnique = card.filter((p) => {
    const k = `${p.card}:${p.role ?? ''}:${p.unit ?? ''}:${p.code}:${p.timeMs}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // The same punch can arrive via two sender types (two rows). Heard-ness
  // (last heard, date mismatches) looks at every row; the punch itself
  // (received count, matching, delay) once, as the first row received.
  const allRows: RadioPunchIn[] = radio;
  const firstByKey = new Map<string, RadioPunchIn>();
  for (const p of radio) {
    const k = `${p.card}:${p.code}:${p.timeMs}`;
    const first = firstByKey.get(k);
    if (!first || p.receivedMs < first.receivedMs) firstByKey.set(k, p);
  }
  const roleCodes = params.roleCodes ?? { start: [], check: [], finish: [] };
  const ROLES = ['start', 'check', 'finish'] as const;
  const roleOfCode = new Map<number, (typeof ROLES)[number]>();
  for (const r of ROLES) for (const c of roleCodes[r]) if (!roleOfCode.has(c)) roleOfCode.set(c, r);

  const expected = new Set(params.expectedCodes ?? []);
  const share = (matched: number, total: number): number => (total === 0 ? 1 : matched / total);

  // A channel is one radio-side stream and the card punches it should carry:
  // an ordinary control, or one start/check/finish UNIT (card CN = radio code),
  // or the cards of a role that do not name their unit.
  interface Channel {
    role: RadioRole;
    code: number; // control code or unit code; 0 for the unknown unit
    unknownUnit: boolean;
    rows: RadioPunchIn[]; // every ROC row (dups included)
    punches: RadioPunchIn[]; // each punch once
    cards: CardPunchIn[];
  }
  const channels = new Map<string, Channel>();
  const channel = (role: RadioRole, code: number, unknownUnit = false): Channel => {
    const key = `${role}:${unknownUnit ? 'unknown' : code}`;
    let ch = channels.get(key);
    if (!ch) {
      ch = { role, code, unknownUnit, rows: [], punches: [], cards: [] };
      channels.set(key, ch);
    }
    return ch;
  };
  const roleChannelFor = (r: (typeof ROLES)[number], p: { code: number }) => channel(r, p.code);

  for (const code of expected) if (!roleOfCode.has(code)) channel('control', code);
  for (const r of ROLES) for (const u of roleCodes[r]) channel(r, u);

  for (const p of allRows) {
    const r = roleOfCode.get(p.code);
    (r ? roleChannelFor(r, p) : channel('control', p.code)).rows.push(p);
  }
  for (const p of firstByKey.values()) {
    const r = roleOfCode.get(p.code);
    (r ? roleChannelFor(r, p) : channel('control', p.code)).punches.push(p);
  }
  for (const c of cardUnique) {
    if (c.role === undefined) {
      if (!roleOfCode.has(c.code)) channels.get(`control:${c.code}`)?.cards.push(c);
    } else if (typeof c.unit === 'number') {
      if (roleCodes[c.role].includes(c.unit)) channel(c.role, c.unit).cards.push(c);
    } else if (roleCodes[c.role].length > 0) {
      channel(c.role, 0, true).cards.push(c);
    }
  }
  // The unknown unit is compared with every radio row of its role.
  for (const r of ROLES) {
    const unk = channels.get(`${r}:unknown`);
    if (!unk) continue;
    for (const u of roleCodes[r]) {
      const ch = channels.get(`${r}:${u}`);
      if (ch) {
        unk.rows.push(...ch.rows);
        unk.punches.push(...ch.punches);
      }
    }
  }

  const ROLE_RANK: Record<RadioRole, number> = { control: 0, start: 1, check: 2, finish: 3 };
  const out: RadioControlStatus[] = [];
  for (const ch of channels.values()) {
    const { code, punches, rows } = ch;
    const lastHeard = rows.length === 0 ? null : Math.max(...rows.map((p) => p.receivedMs));
    const cardHere = ch.cards.filter((p) => p.timeMs <= nowMs);

    const inWindow = cardHere.filter((p) => p.timeMs >= nowMs - windowMin * MIN_MS);
    const isMatched = (c: CardPunchIn): boolean =>
      punches.some((r) => r.card === c.card && Math.abs(r.timeMs - c.timeMs) <= tol);
    const matched = inWindow.filter(isMatched);
    const siacIn = inWindow.filter((p) => (p.touchFree ?? p.siac) === true);
    const otherIn = inWindow.filter((p) => (p.touchFree ?? p.siac) !== true);
    const siacMatched = siacIn.filter(isMatched).length;
    const otherMatched = otherIn.filter(isMatched).length;
    const siacProblem =
      siacIn.length >= WATCHDOG_DEFAULTS.minSample &&
      otherIn.length >= WATCHDOG_DEFAULTS.minSample &&
      share(siacMatched, siacIn.length) < WATCHDOG_DEFAULTS.siacThreshold &&
      share(otherMatched, otherIn.length) >= threshold;

    const delays = punches
      .filter((p) => p.receivedMs >= nowMs - windowMin * MIN_MS)
      .map((p) => p.delayMs)
      .sort((a, b) => a - b);
    const medianDelay =
      delays.length === 0
        ? null
        : delays.length % 2 === 1
          ? delays[(delays.length - 1) / 2]!
          : (delays[delays.length / 2 - 1]! + delays[delays.length / 2]!) / 2;

    const unheardRecent = cardHere.some(
      (p) =>
        p.timeMs >= nowMs - WATCHDOG_DEFAULTS.silenceLookbackMin * MIN_MS &&
        (lastHeard === null || p.timeMs > lastHeard)
    );
    const silent = (lastHeard === null || lastHeard < nowMs - silenceMin * MIN_MS) && unheardRecent;
    const coverage = inWindow.length === 0 ? null : matched.length / inWindow.length;
    const few =
      coverage !== null && inWindow.length >= WATCHDOG_DEFAULTS.minSample && coverage < threshold;

    out.push({
      control_code: code,
      role: ch.role,
      unknown_unit: ch.unknownUnit,
      state: silent ? 'silent' : few ? 'few' : 'ok',
      last_heard_ms: lastHeard,
      median_delay_ms: medianDelay,
      listed: ch.role !== 'control' || expected.has(code),
      received: punches.length,
      window_card_punches: inWindow.length,
      window_matched: matched.length,
      coverage,
      siac_card_punches: siacIn.length,
      siac_matched: siacMatched,
      other_card_punches: otherIn.length,
      other_matched: otherMatched,
      siac_problem: siacProblem,
      date_mismatch_count: rows.filter((p) => p.dateMismatch).length,
    });
  }
  return out.sort(
    (a, b) =>
      ROLE_RANK[a.role] - ROLE_RANK[b.role] ||
      Number(a.unknown_unit) - Number(b.unknown_unit) ||
      a.control_code - b.control_code
  );
}
