// Authored for fartola. Not ported from upstream.
//
// Vacant start places (vakansplatser, SOFT TR 7.3.2) in a drawn order.
// The three positions mimic MeOS (oEvent::VacantPosition, MeOS
// code/oEvent.h:540-544; drawList moves vacancies first or last,
// code/oEventDraw.cpp:2570-2582 and 2607-2612). Mixed is our own: MeOS draws
// vacancies as runners of a "vacant" club, so its club spreading keeps them
// apart. Here each vacancy takes a random gap between runners, one per gap
// while gaps remain, so a redraw puts them elsewhere (SOFT TR 7.5.2) and no
// runner gets a new same-club neighbour (TR 7.5.1 counts across vacancies).

import type { DrawRunner, DrawSlot, RngFn, VacantPosition } from './types.ts';

export function placeVacancies(
  order: readonly DrawRunner[],
  count: number,
  position: VacantPosition,
  rng: RngFn
): DrawSlot[] {
  if (count <= 0) return [...order];
  const blanks: DrawSlot[] = Array.from({ length: count }, () => null);
  if (position === 'First') return [...blanks, ...order];
  if (position === 'Last') return [...order, ...blanks];

  // Mixed. Gap g lies before order[g]; gap order.length is after the last.
  const gaps = order.length + 1;
  const perGap = new Array<number>(gaps).fill(0);
  for (let left = count; left > 0; left -= Math.min(left, gaps)) {
    // One round: min(left, gaps) distinct gaps, uniformly (partial Fisher-Yates).
    const idx = Array.from({ length: gaps }, (_, i) => i);
    for (let i = 0; i < Math.min(left, gaps); i++) {
      const j = rng(i, gaps);
      [idx[i], idx[j]] = [idx[j]!, idx[i]!];
      perGap[idx[i]!] = perGap[idx[i]!]! + 1;
    }
  }
  const out: DrawSlot[] = [];
  for (let g = 0; g < gaps; g++) {
    for (let v = 0; v < perGap[g]!; v++) out.push(null);
    if (g < order.length) out.push(order[g]!);
  }
  return out;
}
