// Authored for fartola. Not ported from upstream.
//
// Draw benchmark (ADR-0011 update 2026-10): fartOLa's SOFT draw against
// reference translations of MeOS drawSOFTMethod and drawMeOSMethod
// (meosDrawReference.ts) on the same classes and the same seeded random
// numbers. Reproducible: a fixed seed gives the same report.
//
//   pnpm --filter @fartola/edge exec tsx scripts/draw-benchmark.ts [seed]
//
// Metrics:
// - excess neighbours (SOFT TR 7.5.1): same-club neighbours above the
//   fewest possible, max(0, 2·M − n − 1), over random classes (1–5 clubs of
//   1–8 runners, all with a club so MeOS's one-club-for-the-club-less rule
//   does not count against it);
// - distinct outcomes and most common outcome's share (SOFT TR 7.5.2): club
//   patterns over repeated draws of fixed classes, with the number of
//   valid patterns (no avoidable neighbour) for scale.

import { drawSOFT } from '../src/draw/soft.ts';
import type { DrawRunner, RngFn } from '../src/draw/types.ts';
import { meosMethod, meosSoftMethod } from './meosDrawReference.ts';

export type Method = 'fartola' | 'meos_soft' | 'meos';
export const METHODS: readonly Method[] = ['fartola', 'meos_soft', 'meos'];

/** Seeded mulberry32: integer in [min, max). */
export function seededRng(seed: number): RngFn {
  let a = seed >>> 0;
  return (min, max) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return min + Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * (max - min));
  };
}

export function draw(method: Method, runners: DrawRunner[], rng: RngFn): DrawRunner[] {
  if (method === 'fartola')
    return drawSOFT(runners, { rngFn: rng }).order.filter((s): s is DrawRunner => s !== null);
  if (method === 'meos_soft')
    return meosSoftMethod([...runners], rng).filter((s): s is DrawRunner => s !== null);
  return meosMethod([...runners], rng);
}

const neighbours = (order: readonly DrawRunner[]) =>
  order.reduce(
    (n, r, i) => n + (i > 0 && r.club !== null && r.club === order[i - 1]!.club ? 1 : 0),
    0
  );

const classOf = (sizes: readonly number[]): DrawRunner[] =>
  sizes.flatMap((n, c) =>
    Array.from({ length: n }, (_, i) => ({ id: `K${c}-${i}`, club: `K${c}` }))
  );

export interface Report {
  seed: number;
  classes: number;
  excess: Record<Method, { classesWithExcess: number; worst: number }>;
  shapes: Array<{
    shape: string;
    validPatterns: number;
    draws: number;
    result: Record<Method, { distinct: number; topShare: number }>;
  }>;
}

const SHAPES: readonly number[][] = [
  [4, 4, 2],
  [5, 3, 2],
  [3, 2, 2],
];

function validPatternCount(sizes: readonly number[]): number {
  const left = [...sizes];
  const n = left.reduce((a, b) => a + b, 0);
  const walk = (len: number, last: number): number => {
    if (len === n) return 1;
    let total = 0;
    for (let c = 0; c < left.length; c++)
      if (left[c]! > 0 && c !== last) {
        left[c]!--;
        total += walk(len + 1, c);
        left[c]!++;
      }
    return total;
  };
  return walk(0, -1);
}

export function runBenchmark(seed = 2026, classes = 4000, drawsPerShape = 5000): Report {
  const pick = seededRng(seed);
  const shapesRandom: number[][] = Array.from({ length: classes }, () =>
    Array.from({ length: pick(1, 6) }, () => pick(1, 9))
  );
  const excess = {} as Report['excess'];
  for (const m of METHODS) {
    const rng = seededRng(seed + 1);
    let classesWithExcess = 0;
    let worst = 0;
    for (const sizes of shapesRandom) {
      const fewest = Math.max(0, 2 * Math.max(...sizes) - sizes.reduce((a, b) => a + b, 0) - 1);
      const extra = neighbours(draw(m, classOf(sizes), rng)) - fewest;
      if (extra > 0) classesWithExcess++;
      worst = Math.max(worst, extra);
    }
    excess[m] = { classesWithExcess, worst };
  }
  const shapes = SHAPES.map((sizes) => {
    const result = {} as Record<Method, { distinct: number; topShare: number }>;
    for (const m of METHODS) {
      const rng = seededRng(seed + 2);
      const seen = new Map<string, number>();
      for (let k = 0; k < drawsPerShape; k++) {
        const p = draw(m, classOf(sizes), rng)
          .map((r) => r.club)
          .join(',');
        seen.set(p, (seen.get(p) ?? 0) + 1);
      }
      result[m] = { distinct: seen.size, topShare: Math.max(...seen.values()) / drawsPerShape };
    }
    return {
      shape: sizes.map((n, c) => `${String.fromCharCode(65 + c)}×${n}`).join('/'),
      validPatterns: validPatternCount(sizes),
      draws: drawsPerShape,
      result,
    };
  });
  return { seed, classes, excess, shapes };
}

export function formatReport(r: Report): string {
  const lines = [
    `Draw benchmark, seed ${r.seed}`,
    `Excess same-club neighbours over ${r.classes} random classes (SOFT TR 7.5.1):`,
    ...METHODS.map(
      (m) =>
        `  ${m.padEnd(10)} classes with excess ${String(r.excess[m].classesWithExcess).padStart(5)}, worst +${r.excess[m].worst}`
    ),
    'Outcomes over repeated draws (SOFT TR 7.5.2):',
  ];
  for (const s of r.shapes) {
    lines.push(`  ${s.shape}: ${s.validPatterns} valid patterns, ${s.draws} draws`);
    for (const m of METHODS)
      lines.push(
        `    ${m.padEnd(10)} distinct ${String(s.result[m].distinct).padStart(4)}, most common ${(100 * s.result[m].topShare).toFixed(1)} %`
      );
  }
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(formatReport(runBenchmark(Number(process.argv[2] ?? 2026))));
}
