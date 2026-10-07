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
// - outcomes over repeated draws of fixed classes (SOFT TR 7.5.2): distinct
//   club patterns against the valid ones (no avoidable neighbour), the most
//   common pattern's share, the ratio of the most to the least common valid
//   pattern (∞ when one never comes) and chi-square against uniform over the
//   valid patterns (invalid outcomes count as missing valid ones).
//   A×10/B×9/C×1 is the Codex counterexample to the earlier swap chain.
// The command line also times fartOLa's draw of a few large classes.

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

export interface Outcomes {
  distinct: number;
  topShare: number;
  /** Most / least common valid pattern; Infinity when one never comes. */
  ratio: number;
  /** Chi-square against uniform over the valid patterns. */
  chi2: number;
}

export interface Report {
  seed: number;
  classes: number;
  excess: Record<Method, { classesWithExcess: number; worst: number }>;
  shapes: Array<{
    shape: string;
    validPatterns: number;
    draws: number;
    result: Record<Method, Outcomes>;
  }>;
}

const SHAPES: readonly number[][] = [
  [10, 9, 1],
  [4, 4, 2],
  [5, 3, 2],
  [3, 2, 2],
];

/** Every club pattern with no two equal neighbours, e.g. [2, 1] → ['K0,K1,K0']. */
function validPatterns(sizes: readonly number[]): string[] {
  const left = [...sizes];
  const n = left.reduce((a, b) => a + b, 0);
  const out: string[] = [];
  const word: string[] = [];
  const walk = (last: number): void => {
    if (word.length === n) {
      out.push(word.join(','));
      return;
    }
    for (let c = 0; c < left.length; c++)
      if (left[c]! > 0 && c !== last) {
        left[c]!--;
        word.push(`K${c}`);
        walk(c);
        word.pop();
        left[c]!++;
      }
  };
  walk(-1);
  return out;
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
    const valid = validPatterns(sizes);
    const expected = drawsPerShape / valid.length;
    const result = {} as Record<Method, Outcomes>;
    for (const m of METHODS) {
      const rng = seededRng(seed + 2);
      const seen = new Map<string, number>();
      for (let k = 0; k < drawsPerShape; k++) {
        const p = draw(m, classOf(sizes), rng)
          .map((r) => r.club)
          .join(',');
        seen.set(p, (seen.get(p) ?? 0) + 1);
      }
      const counts = valid.map((p) => seen.get(p) ?? 0);
      result[m] = {
        distinct: seen.size,
        topShare: Math.max(...seen.values()) / drawsPerShape,
        ratio: Math.max(...counts) / Math.min(...counts),
        chi2: counts.reduce((x, o) => x + (o - expected) ** 2 / expected, 0),
      };
    }
    return {
      shape: sizes.map((n, c) => `${String.fromCharCode(65 + c)}×${n}`).join('/'),
      validPatterns: valid.length,
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
        `    ${m.padEnd(10)} distinct ${String(s.result[m].distinct).padStart(4)}, most common ${(100 * s.result[m].topShare).toFixed(1)} %, max/min ${s.result[m].ratio.toFixed(2)}, chi-square ${s.result[m].chi2.toFixed(1)} (df ${s.validPatterns - 1})`
      );
  }
  return lines.join('\n');
}

/** Milliseconds per fartOLa draw (median of `runs`) for large classes. */
export function timeDraws(runs = 5): Array<{ name: string; n: number; ms: number }> {
  const classes: Array<[string, number[]]> = [
    // 200 runners: a few big clubs, many small, 35 alone (a runner without
    // a club draws as a club of one).
    [
      'realistic 200',
      [
        20, 16, 14, 12, 10, 9, 8, 7, 6, 6, 5, 5, 4, 4, 4, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2,
        2,
      ].concat(Array<number>(35).fill(1)),
    ],
    ['10 clubs × 20', Array<number>(10).fill(20)],
    ['20 clubs × 15', Array<number>(20).fill(15)],
    ['one club of 150 + 50', [150, 50]],
    ['50 clubs × 20', Array<number>(50).fill(20)],
  ];
  return classes.map(([name, sizes]) => {
    const runners = classOf(sizes);
    const ms: number[] = [];
    for (let k = 0; k < runs; k++) {
      const t = performance.now();
      drawSOFT(runners);
      ms.push(performance.now() - t);
    }
    return { name, n: runners.length, ms: ms.sort((a, b) => a - b)[runs >> 1]! };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(formatReport(runBenchmark(Number(process.argv[2] ?? 2026))));
  console.log('fartOLa draw time (crypto.randomInt, median):');
  for (const t of timeDraws())
    console.log(`  ${t.name.padEnd(22)} n ${t.n}: ${t.ms.toFixed(1)} ms`);
}
