// Ported from MeOS code/oEventDraw.cpp (melinsoftware/meos, GPL-3.0-or-later).
// Copyright (C) Melin Software HB and contributors. Modified for fartOLa 2026-10-07.
//
// Late entrants (efteranmälda) in a class that already has a start list,
// without redrawing it (SOFT TR 7.5.7, TR 7.5.8). From oEvent::drawList,
// DrawType::RemainingBefore/RemainingAfter (oEventDraw.cpp:2498-2550):
// the runners without a start time start in a block just before the first
// start (day: "starta först") or just after the last (night: "sist"), at
// the class interval. MeOS infers the interval as the smallest gap between
// the starts (:2525-2533); fartOLa uses the class's stored interval first.
// MeOS falls back to 01:00 and 2 minutes when it cannot infer (:2544-2548);
// fartOLa refuses instead (DrawError), so nobody gets a start at 01:00.
//
// fartOLa additions: seamClubs gives the club next to the block, so the
// SOFT draw of the block (drawSOFT boundary) counts a same-club neighbour
// at the seam and draws uniformly among the orders with the fewest
// (TR 7.5.1, TR 7.5.2); fillVacancies puts late entrants into free places
// of the class's start grid (TR 7.5.8: "vakanta platser", not in elite
// classes; the route checks the class kind); in SOFT mode its placement has
// the fewest same-club neighbours, drawn uniformly (placeFewest, our own).

import { binom, drawSOFT, patternCounts, randomBelow, samplePattern } from './soft.ts';
import type { DrawBoundary } from './soft.ts';
import type { DrawRunner, RngFn } from './types.ts';
import { DrawError } from './types.ts';

/** A runner who already has a start time in the class. */
export interface StartedRunner {
  id: string;
  club: string | null;
  startTimeMs: number;
}

export interface Assignment {
  id: string;
  startTimeMs: number;
}

/** The smallest positive gap between the start times, or null when there
 * are fewer than two distinct times (oEventDraw.cpp:2525-2533). */
export function smallestGapMs(startTimesMs: readonly number[]): number | null {
  const times = [...new Set(startTimesMs)].sort((a, b) => a - b);
  let gap: number | null = null;
  for (let i = 1; i < times.length; i++) {
    const d = times[i]! - times[i - 1]!;
    if (gap === null || d < gap) gap = d;
  }
  return gap;
}

/** The club of the starter next to the block: the first start for
 * 'Before' (the block ends just before it), the last for 'After'. Pass it
 * to drawSOFT as its boundary. */
export function seamClubs(
  existing: readonly StartedRunner[],
  placement: 'Before' | 'After'
): DrawBoundary {
  if (existing.length === 0) return {};
  const byTime = [...existing].sort((a, b) => a.startTimeMs - b.startTimeMs);
  return placement === 'Before'
    ? { after: byTime[0]!.club }
    : { before: byTime[byTime.length - 1]!.club };
}

/** MeOS RemainingBefore/RemainingAfter: `order` (the late entrants, already
 * drawn) starts in a block before the first or after the last start. */
export function placeBeforeOrAfter(
  existing: readonly StartedRunner[],
  order: readonly DrawRunner[],
  placement: 'Before' | 'After',
  intervalMs: number
): Assignment[] {
  if (order.length === 0) return [];
  if (existing.length === 0)
    throw new DrawError('no_start_list', 'The class has no start times yet; draw the whole class.');
  const times = existing.map((r) => r.startTimeMs);
  const start =
    placement === 'Before'
      ? Math.min(...times) - order.length * intervalMs
      : Math.max(...times) + intervalMs;
  return order.map((r, i) => ({ id: r.id, startTimeMs: start + i * intervalMs }));
}

/** Work (about one BigInt product per unit) placeFewest may do before it
 * falls back. Measured (Node 26, random clubs, remaining.test.ts): exact for
 * 20 free places and 10 late entrants in 10 clubs (20–50 ms), 10 places
 * and 20 late entrants in 15 clubs (45–50 ms) and 5 places and 30 late
 * entrants (120–350 ms); 20 places and 30 late entrants in 15 clubs, and
 * 40 places and 50 late entrants in 25 clubs, fall back (about 0.2 s). An
 * exact count for every size is not to be had: one late entrant per club
 * into single free places is already a permanent with forbidden places. */
export const PLACE_FEWEST_BUDGET = 1_000_000;

/** Too much work for placeFewest (PLACE_FEWEST_BUDGET). */
class TooLarge extends Error {}

/** Late entrants into free places of the start grid first + k·interval,
 * k from 0 to the last start; those beyond the free places start right
 * after the last start (TR 7.5.7: there is always room).
 *
 * With `separateClubs` (SOFT) the placement is drawn uniformly among those
 * with the fewest same-club neighbours in the whole start list
 * (placeFewest, TR 7.5.1, TR 7.5.2). Beyond `budget` work (no realistic
 * class; see PLACE_FEWEST_BUDGET) it falls back, reporting `onFallback`:
 * 'split' — a random min(late, free places) of the late entrants take the
 *   free places and the rest start after the last start, each part drawn
 *   exactly (the fewest neighbours given that split);
 * 'preference' — when that is too large as well, or there is no overflow:
 *   the rule below, with the overflow drawn with the seam.
 * Otherwise (Random) each takes a random free place, preferring one where
 * neither nearest starter is from the same club, and the rest follow in
 * order. */
export function fillVacancies(
  existing: readonly StartedRunner[],
  late: readonly DrawRunner[],
  grid: { firstStartMs: number; intervalMs: number },
  rng: RngFn,
  separateClubs = false,
  limits: { budget?: number; onFallback?: (to: 'split' | 'preference') => void } = {}
): Assignment[] {
  if (late.length === 0) return [];
  if (existing.length === 0)
    throw new DrawError('no_start_list', 'The class has no start times yet; draw the whole class.');
  // floor: a hand-edited off-grid start occupies the place it falls in, so a
  // late entrant never lands before it.
  const slotOf = (t: number) => Math.floor((t - grid.firstStartMs) / grid.intervalMs);
  const taken = new Map<number, string | null>();
  for (const r of existing) taken.set(slotOf(r.startTimeMs), r.club);
  const lastSlot = Math.max(...taken.keys());
  const free: number[] = [];
  for (let k = 0; k <= lastSlot; k++) if (!taken.has(k)) free.push(k);
  const at = (slot: number) => grid.firstStartMs + slot * grid.intervalMs;
  const budget = limits.budget ?? PLACE_FEWEST_BUDGET;
  const shuffled = [...late];
  if (separateClubs) {
    try {
      return placeFewest(taken, lastSlot, free, late, rng, budget)
        .map((p) => ({ id: p.id, startTimeMs: at(p.slot) }))
        .sort((a, b) => a.startTimeMs - b.startTimeMs);
    } catch (e) {
      if (!(e instanceof TooLarge)) throw e;
    }
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = rng(0, i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    if (late.length > free.length)
      try {
        const placed = placeFewest(
          taken,
          lastSlot,
          free,
          shuffled.slice(0, free.length),
          rng,
          budget
        );
        limits.onFallback?.('split');
        return [
          ...placed.map((p) => ({ id: p.id, startTimeMs: at(p.slot) })),
          ...overflow(shuffled.slice(free.length)),
        ].sort((a, b) => a.startTimeMs - b.startTimeMs);
      } catch (e) {
        if (!(e instanceof TooLarge)) throw e;
      }
    limits.onFallback?.('preference');
  }
  // After the last start; SOFT draws the block with its seam to the last starter.
  function overflow(rest: readonly DrawRunner[]): Assignment[] {
    const block = separateClubs
      ? (drawSOFT([...rest], { boundary: { before: taken.get(lastSlot) ?? null }, rngFn: rng })
          .order as DrawRunner[])
      : rest;
    return block.map((r, i) => ({ id: r.id, startTimeMs: at(lastSlot + 1 + i) }));
  }
  for (let i = free.length - 1; i > 0; i--) {
    const j = rng(0, i + 1);
    [free[i], free[j]] = [free[j]!, free[i]!];
  }
  const neighbourClubs = (k: number): Array<string | null> => {
    const out: Array<string | null> = [];
    for (const dir of [-1, 1])
      for (let s = k + dir; s >= 0 && s <= lastSlot; s += dir)
        if (taken.has(s)) {
          out.push(taken.get(s)!);
          break;
        }
    return out;
  };
  const order = separateClubs ? shuffled : late;
  const placed = order.slice(0, free.length).map((r) => {
    const pick = free.findIndex((f) => r.club === null || !neighbourClubs(f).includes(r.club));
    const k = free.splice(pick === -1 ? 0 : pick, 1)[0]!;
    taken.set(k, r.club);
    return { id: r.id, startTimeMs: at(k) };
  });
  return [...placed, ...overflow(order.slice(placed.length))];
}

/**
 * SOFT late entrants into the free places, the rest after the last start:
 * uniform among the placements with the fewest same-club neighbours in the
 * whole start list, counted across empty places (TR 7.5.1, TR 7.5.2). With
 * fewer late entrants than free places some places stay empty; otherwise
 * every free place is taken and the rest start after the last start.
 *
 * Own algorithm. The free places form holes: runs of free places between
 * the starters' clubs X and Y (the block after the last start: X = its
 * club, no Y). A hole of h places taking j runners whose clubs form a word
 * with d neighbours, seams to X and Y included, can do so in C(h, j) ×
 * patternCounts(clubs, X, Y)[d] ways (soft.ts); an empty hole costs one
 * neighbour when X and Y are the same club. A dynamic program over the
 * holes counts the placements by neighbours in all; its state is what is
 * left: the exact counts of late clubs that are some hole's X or Y, and how
 * many other clubs have each count left (they are interchangeable; a runner
 * without a club is a club of one). Draw back from the fewest total in
 * proportion to the counts, which clubs give the runners uniformly, the
 * places uniformly, and the word with samplePattern: every placement with
 * the fewest neighbours is equally likely, as in soft.ts.
 */
function placeFewest(
  taken: ReadonlyMap<number, string | null>,
  lastSlot: number,
  free: readonly number[],
  late: readonly DrawRunner[],
  rng: RngFn,
  budget: number
): Array<{ id: string; slot: number }> {
  // Clubs by index: late clubs first, then starters' clubs with no late entrant.
  const index = new Map<string, number>();
  const runnersOf: DrawRunner[][] = [];
  for (const r of late) {
    const k = r.club ?? `__null_${r.id}`;
    if (!index.has(k)) {
      index.set(k, runnersOf.length);
      runnersOf.push([]);
    }
    runnersOf[index.get(k)!]!.push(r);
  }
  const K = runnersOf.length;
  const clubIndex = (club: string | null | undefined): number => {
    if (club == null) return -1;
    if (!index.has(club)) index.set(club, index.size);
    return index.get(club)!;
  };
  const holes: Array<{ slots: number[]; X: number; Y: number; full: boolean }> = [];
  for (const k of free) {
    const h = holes.at(-1);
    if (h !== undefined && h.slots.at(-1) === k - 1) h.slots.push(k);
    else
      holes.push({ slots: [k], X: k > 0 ? clubIndex(taken.get(k - 1)) : -1, Y: -1, full: false });
  }
  for (const h of holes) h.Y = clubIndex(taken.get(h.slots.at(-1)! + 1));
  const full = late.length >= free.length;
  for (const h of holes) h.full = full;
  if (late.length > free.length)
    holes.push({
      slots: Array.from({ length: late.length - free.length }, (_, i) => lastSlot + 1 + i),
      X: clubIndex(taken.get(lastSlot)),
      Y: -1,
      full: true,
    });
  const N = index.size;

  const special = [...new Set(holes.flatMap((h) => [h.X, h.Y]))].filter((c) => c >= 0 && c < K);
  const plain = runnersOf.map((_, c) => c).filter((c) => !special.includes(c));
  const maxCount = Math.max(1, ...runnersOf.map((r) => r.length));
  interface State {
    sp: number[];
    hist: number[]; // hist[c] = clubs not in `special` with c runners left
  }
  interface Take {
    sp: number[];
    plain: Array<{ c: number; t: number; n: number }>; // n clubs with c left give t each
    j: number;
    ways: bigint; // which clubs give them
  }
  // From hole i on, only clubs that border a hole ≥ i need their exact
  // count; the others count as interchangeable, like `plain`.
  const bordersFrom = holes.map((_, i) =>
    special.map((c) => holes.slice(i).some((h) => h.X === c || h.Y === c))
  );
  const keyOf = (i: number, s: State) => {
    const hist = [...s.hist];
    const sp = s.sp.map((v, k) => {
      if (bordersFrom[i]![k]) return v;
      if (v > 0) hist[v]!++;
      return '';
    });
    return `${sp.join(',')}|${hist.join(',')}`;
  };
  const start: State = {
    sp: special.map((c) => runnersOf[c]!.length),
    hist: Array.from({ length: maxCount + 1 }, (_, c) =>
      c === 0 ? 0 : plain.filter((p) => runnersOf[p]!.length === c).length
    ),
  };
  const fact = (n: number) => {
    let f = 1n;
    for (let i = 2; i <= n; i++) f *= BigInt(i);
    return f;
  };

  /** Every way to take between lo and hi runners from the state. */
  const takes = (s: State, lo: number, hi: number): Take[] => {
    const out: Take[] = [];
    const sp = new Array<number>(special.length).fill(0);
    const pl: Array<{ c: number; t: number; n: number }> = [];
    // Class c (clubs with c left): n_t clubs give t each, chosen in
    // m! / ((m − Σn)! · ∏ n_t!) ways.
    const plainPart = (
      c: number,
      t: number,
      used: number,
      den: bigint,
      j: number,
      ways: bigint
    ): void => {
      if (c > maxCount) {
        if (j >= lo) out.push({ sp: [...sp], plain: [...pl], j, ways });
        return;
      }
      const m = s.hist[c]!;
      if (t > c || used === m)
        return plainPart(c + 1, 1, 0, 1n, j, (ways * fact(m)) / (fact(m - used) * den));
      for (let n = 0; used + n <= m && j + n * t <= hi; n++) {
        if (n > 0) pl.push({ c, t, n });
        plainPart(c, t + 1, used + n, den * fact(n), j + n * t, ways);
        if (n > 0) pl.pop();
      }
    };
    const specialPart = (i: number, j: number): void => {
      if (i === special.length) return plainPart(1, 1, 0, 1n, j, 1n);
      for (let t = 0; t <= s.sp[i]! && j + t <= hi; t++) {
        sp[i] = t;
        specialPart(i + 1, j + t);
      }
      sp[i] = 0;
    };
    specialPart(0, 0);
    return out;
  };
  const after = (s: State, t: Take): State => {
    const hist = [...s.hist];
    for (const { c, t: k, n } of t.plain) {
      hist[c]! -= n;
      if (c - k > 0) hist[c - k]! += n;
    }
    return { sp: s.sp.map((v, i) => v - t.sp[i]!), hist };
  };
  const tableCache = new Map<string, bigint[]>();
  // A hole's counts only see its own X and Y clubs exactly; the other
  // clubs' amounts are interchangeable (relabelling changes nothing).
  const holeTable = (i: number, t: Take): bigint[] => {
    const { X, Y } = holes[i]!;
    const amounts = [
      ...t.plain.flatMap(({ t: k, n }) => Array<number>(n).fill(k)),
      ...special.flatMap((c, k) => (c === X || c === Y || t.sp[k] === 0 ? [] : [t.sp[k]!])),
    ].sort((a, b) => a - b);
    const at = (c: number) => (special.includes(c) ? t.sp[special.indexOf(c)]! : 0);
    const key = `${i}|${at(X)},${at(Y)}|${amounts.join(',')}`;
    let tb = tableCache.get(key);
    if (tb === undefined) {
      const counts = new Array<number>(N + amounts.length).fill(0);
      if (X >= 0) counts[X] = at(X);
      if (Y >= 0) counts[Y] = at(Y);
      amounts.forEach((k, a) => (counts[N + a] = k));
      // A pattern table costs about n · Σc² BigInt products (soft.ts).
      spend(counts.reduce((a, c) => a + c, 0) * counts.reduce((a, c) => a + c * c, 0) + 1);
      tb = patternCounts(counts, X, Y);
      tableCache.set(key, tb);
    }
    return tb;
  };
  const bounds = (i: number, s: State): [number, number] => {
    const left = s.sp.reduce((a, b) => a + b, 0) + s.hist.reduce((a, n, c) => a + n * c, 0);
    const h = holes[i]!;
    return h.full ? [h.slots.length, h.slots.length] : [0, Math.min(h.slots.length, left)];
  };
  const memo = holes.map(() => new Map<string, bigint[]>());
  let work = 0;
  const spend = (units: number) => {
    work += units;
    if (work > budget) throw new TooLarge();
  };
  const G = (i: number, s: State): bigint[] => {
    if (i === holes.length)
      return s.sp.every((v) => v === 0) && s.hist.every((n) => n === 0) ? [1n] : [];
    const key = keyOf(i, s);
    const hit = memo[i]!.get(key);
    if (hit !== undefined) return hit;
    const out: bigint[] = [];
    for (const t of takes(s, ...bounds(i, s))) {
      const rest = G(i + 1, after(s, t));
      if (rest.length === 0) continue;
      const w = t.ways * binom(holes[i]!.slots.length, t.j);
      const tb = holeTable(i, t);
      spend(tb.length * rest.length);
      for (let d = 0; d < tb.length; d++)
        if (tb[d]! > 0n)
          for (let e = 0; e < rest.length; e++)
            if (rest[e]! > 0n) out[d + e] = (out[d + e] ?? 0n) + w * tb[d]! * rest[e]!;
    }
    memo[i]!.set(key, out);
    spend(1);
    return out;
  };

  let D = G(0, start).findIndex((v) => v !== undefined && v > 0n);
  // Clubs not in `special` by how many runners they have left.
  const leftOf = runnersOf.map((r) => r.length);
  let s = start;
  const clubAt = new Map<number, number>();
  holes.forEach((h, i) => {
    const options: Array<{ t: Take; d: number; w: bigint }> = [];
    for (const t of takes(s, ...bounds(i, s))) {
      const rest = G(i + 1, after(s, t));
      const tb = holeTable(i, t);
      const w = t.ways * binom(h.slots.length, t.j);
      for (let d = 0; d <= D && d < tb.length; d++) {
        const x = w * tb[d]! * (rest[D - d] ?? 0n);
        if (x > 0n) options.push({ t, d, w: x });
      }
    }
    let r = randomBelow(
      options.reduce((a, o) => a + o.w, 0n),
      rng
    );
    let pick = options[0]!;
    for (const o of options) {
      pick = o;
      if (r < o.w) break;
      r -= o.w;
    }
    const { t, d } = pick;
    // Which clubs give the runners: uniformly among `ways`.
    const counts = new Array<number>(N).fill(0);
    special.forEach((c, k) => (counts[c] = t.sp[k]!));
    const byLeft = new Map<number, number[]>();
    for (const c of plain)
      if (leftOf[c]! > 0) byLeft.set(leftOf[c]!, [...(byLeft.get(leftOf[c]!) ?? []), c]);
    for (const [c, clubs] of byLeft) {
      for (let a = clubs.length - 1; a > 0; a--) {
        const b = rng(0, a + 1);
        [clubs[a], clubs[b]] = [clubs[b]!, clubs[a]!];
      }
      let next = 0;
      for (const p of t.plain.filter((p) => p.c === c))
        for (let k = 0; k < p.n; k++) counts[clubs[next++]!] = p.t;
    }
    const word = samplePattern(counts, h.X, h.Y, rng, d);
    // Which places: uniformly.
    const places = [...h.slots];
    for (let a = 0; a < word.length; a++) {
      const b = rng(a, places.length);
      [places[a], places[b]] = [places[b]!, places[a]!];
    }
    const chosen = places.slice(0, word.length).sort((a, b) => a - b);
    word.forEach((c, k) => {
      clubAt.set(chosen[k]!, c);
      leftOf[c]!--;
    });
    s = after(s, t);
    D -= d;
  });

  for (const list of runnersOf)
    for (let a = list.length - 1; a > 0; a--) {
      const b = rng(0, a + 1);
      [list[a], list[b]] = [list[b]!, list[a]!];
    }
  return [...clubAt].map(([slot, c]) => ({ id: runnersOf[c]!.pop()!.id, slot }));
}
