// Ported from MeOS code/oEventDraw.cpp and code/random.cpp (melinsoftware/meos, GPL-3.0-or-later).
// Copyright (C) Melin Software HB and contributors. Modified for fartOLa 2026-10-07.
//
// Reference translations of MeOS's two club-aware draws, used only by the
// draw benchmark (draw-benchmark.ts) to compare them with fartOLa's own
// SOFT draw (src/draw/soft.ts). Not used by the server.
// - drawSOFTMethod with getLargestClub/getRange (oEventDraw.cpp:107-209);
// - drawMeOSMethod (oEventDraw.cpp:211-431);
// - permute (random.cpp:83-111), the shuffle both use.
// Modified: every random bit or number comes from the injected `rng`, not
// MeOS's fixed-table generator (random.cpp:24-81, not ported) or
// std::mt19937; `GetRandomNumber(m)` becomes `rng(0, m)`. A runner without
// a club gets MeOS's club id 0 (one club for all of them), as in MeOS.

import type { DrawRunner, RngFn } from '../src/draw/types.ts';

type Slot = DrawRunner | null;
/** MeOS getClubId(): 0 for no club; a null slot (blank) is -1 (:137-138). */
const clubId = (r: Slot): string => (r === null ? '-1' : (r.club ?? '0'));

/** random.cpp:91-111 — random partition, then each part recursively. */
function permute<T>(a: T[], rng: RngFn, from = 0, size = a.length): void {
  let size1 = from + size - 1;
  let m = from;
  while (m <= size1) {
    if (rng(0, 2) === 1) {
      const t = a[size1]!;
      a[size1] = a[m]!;
      size1--;
      a[m] = t;
    } else m++;
  }
  const p1 = m - from;
  const p2 = size - p1;
  if (p1 > 1) permute(a, rng, from, p1);
  if (p2 > 1) permute(a, rng, m, p2);
}

/** oEventDraw.cpp:107-122 — remove and return the first largest club in
 * club-id order (std::map). */
function takeLargestClub(clubs: Map<string, Slot[]>): Slot[] {
  let max = 0;
  for (const v of clubs.values()) max = Math.max(max, v.length);
  const key = [...clubs.keys()].sort().find((k) => clubs.get(k)!.length === max)!;
  const out = clubs.get(key)!;
  clubs.delete(key);
  return out;
}

/** oEventDraw.cpp:130-209. */
export function meosSoftMethod(runners: Slot[], rng: RngFn, handleBlanks = false): Slot[] {
  if (runners.length === 0) return runners;
  const clubs = new Map<string, Slot[]>();
  for (const r of runners) {
    const k = clubId(r);
    if (!clubs.has(k)) clubs.set(k, []);
    clubs.get(k)!.push(r);
  }
  const groups: Slot[][] = [takeLargestClub(clubs)];
  const largeSize = groups[0]!.length;
  const ngroups = Math.ceil(runners.length / largeSize);
  while (groups.length < ngroups) groups.push([]);
  while (clubs.size > 0) {
    let small = runners.length + 1;
    let cgroup = -1;
    for (let k = 1; k < groups.length; k++)
      if (groups[k]!.length < small) {
        cgroup = k;
        small = groups[k]!.length;
      }
    groups[cgroup]!.push(...takeLargestClub(clubs));
  }
  permute(groups[0]!, rng);
  let maxGroup = 0;
  for (const g of groups) maxGroup = Math.max(maxGroup, g.length);
  if (handleBlanks)
    for (let k = 1; k < groups.length; k++)
      while (groups[k]!.length < maxGroup) groups[k]!.push(null);
  for (let k = 1; k < groups.length; k++) groups[k] = meosSoftMethod(groups[k]!, rng, true);
  const order = groups.map((_, i) => i);
  permute(order, rng);
  const out: Slot[] = [];
  for (let level = 0; level < maxGroup; level++)
    for (const gi of order) {
      const g = groups[gi]!;
      if (level < g.length && (g[level] !== null || !handleBlanks)) out.push(g[level]!);
    }
  return out;
}

/** oEventDraw.cpp:211-431. */
export function meosMethod(input: DrawRunner[], rng: RngFn): DrawRunner[] {
  if (input.length === 0) return [];
  const perClub = new Map<string, DrawRunner[]>();
  for (const r of input) {
    const k = clubId(r);
    if (!perClub.has(k)) perClub.set(k, []);
    perClub.get(k)!.push(r);
  }
  // sort(sizeClub.rbegin(), sizeClub.rend()): size, then club id, descending.
  const sizeClub = [...perClub].map(([k, v]) => [v.length, k] as const);
  sizeClub.sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0));
  const largeClubs = new Set<string>();
  for (let i = 0; i < 3 && i < sizeClub.length; i++)
    if (sizeClub[i]![0] > 3) largeClubs.add(sizeClub[i]![1]);
  const target = Math.max(Math.trunc(input.length / 20), sizeClub[0]![0]);
  const groups: DrawRunner[][] = [[]];
  for (const [n, k] of sizeClub) {
    const cur = groups.at(-1)!.length;
    if (Math.abs(cur - target) < Math.abs(cur + n - target)) groups.push([]);
    groups.at(-1)!.push(...perClub.get(k)!);
  }
  const total = input.length;
  const half = Math.trunc((total + 2) / 2);
  if (groups[0]!.length > half && groups.length > 1) {
    const toMove = groups[0]!.length - half;
    for (let i = 0; i < toMove; i++) groups[1 + (i % (groups.length - 1))]!.push(groups[0]!.pop()!);
  }
  let maxGroupSize = 0;
  for (const g of groups) {
    permute(g, rng);
    maxGroupSize = Math.max(maxGroupSize, g.length);
  }
  let interval =
    groups.length > 10 ? Math.trunc(groups.length / 4) : Math.max(2, groups.length - 2);
  const recent: number[] = [];
  let ix = 0;
  if (maxGroupSize * 2 > total) {
    interval = 2;
    ix = 1;
  }
  const out: DrawRunner[] = [];
  for (;;) {
    ix++;
    let maxSize = 0;
    let maxIx = -1;
    let other = -1;
    let nonEmpty = 0;
    for (let g = 0; g < groups.length; g++) {
      const s = groups[g]!.length;
      if (s === 0) continue;
      nonEmpty++;
      if (s > maxSize) {
        if (other === -1 || groups[other]!.length < maxSize) other = maxIx;
        maxSize = s;
        maxIx = g;
      } else if (other === -1 || groups[other]!.length < s) other = g;
    }
    if (maxSize === 0) break;
    let use = maxIx;
    if (ix !== interval) {
      for (let attempt = 0; attempt < groups.length * 2; attempt++) {
        const g = rng(0, groups.length);
        if (groups[g]!.length > 0 && !recent.includes(g)) {
          use = g;
          break;
        }
      }
    } else ix = 0;
    if (recent.length > 0 && recent.at(-1) === use && other !== -1) use = other;
    recent.push(use);
    if (recent.length > interval || recent.length >= nonEmpty) recent.shift();
    out.push(groups[use]!.pop()!);
  }
  // Extra randomisation: swaps that never create a same-club neighbour (:349-390).
  const compatible = (a: string | undefined, b: string | undefined) =>
    a === undefined || b === undefined || a === '0' || b === '0' || a !== b;
  for (let i = 0; i < out.length * 2; i++) {
    const a = rng(0, out.length);
    const b = rng(0, out.length);
    if (a === b) continue;
    const ac = clubId(out[a]!);
    const bc = clubId(out[b]!);
    if (ac !== bc && (largeClubs.has(ac) || largeClubs.has(bc))) continue;
    const near = (i: number) => (i >= 0 && i < out.length ? clubId(out[i]!) : undefined);
    if (
      compatible(near(a - 1), bc) &&
      compatible(near(a + 1), bc) &&
      compatible(near(b - 1), ac) &&
      compatible(near(b + 1), ac)
    )
      [out[a], out[b]] = [out[b]!, out[a]!];
  }
  // Move any runner left next to a club-mate to a place where neither
  // neighbour is from that club (:392-431).
  let noResolve: string | null = null;
  let maxIter = out.length * 2;
  for (let i = 1; i < out.length; i++) {
    if (--maxIter < 0) break;
    const cid = clubId(out[i]!);
    if (clubId(out[i - 1]!) !== cid || cid === noResolve) continue;
    let resolveIx = -1;
    for (let j = 1; j < out.length; j++)
      if (clubId(out[j - 1]!) !== cid && clubId(out[j]!) !== cid) resolveIx = j;
    if (resolveIx === -1) {
      noResolve = cid;
      continue;
    }
    const [moved] = out.splice(i, 1);
    if (resolveIx > i) resolveIx--;
    out.splice(resolveIx, 0, moved!);
    i--;
  }
  return out;
}
