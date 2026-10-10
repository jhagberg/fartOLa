// Authored for fartola. Not ported from upstream.
//
// TDD tests for the draw algorithms (SOFT, Simultaneous).
// Phase 2.1 D-03 (drawSimultaneous) and D-04 (drawSOFT).
//
// Seeded RNG: all tests inject a deterministic rngFn to avoid flaky
// randomized assertions (GPT MEDIUM: seeded RNG pattern).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { drawSOFT, fewestPatterns } from './soft.ts';
import { placeVacancies } from './vacancies.ts';
import { drawSimultaneous } from './simultaneous.ts';
import type { DrawRunner } from './types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic RNG using a linear congruential generator (LCG).
 *  Returns numbers in [min, max). Produces the same sequence given the same
 *  seed, allowing reproducible test runs. */
function makeLcgRng(seed: number): (min: number, max: number) => number {
  let state = seed;
  return (min: number, max: number): number => {
    state = (state * 1664525 + 1013904223) & 0xffffffff;
    const range = max - min;
    if (range <= 0) return min;
    return min + (Math.abs(state) % range);
  };
}

/** Seeded mulberry32 for statistical tests. The LCG above repeats its low
 * bits (`% range` on a power-of-two modulus), so over many draws it yields
 * one club pattern only; frequencies need a generator without that flaw. */
function makeMulberryRng(seed: number): (min: number, max: number) => number {
  let a = seed >>> 0;
  return (min: number, max: number): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return min + Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * (max - min));
  };
}

/** Every club pattern with no two equal neighbours, e.g. {A:2,B:1} → ['ABA']. */
function validPatterns(sizes: Record<string, number>): string[] {
  const left = { ...sizes };
  const n = Object.values(left).reduce((a, b) => a + b, 0);
  const out: string[] = [];
  const walk = (s: string, last: string): void => {
    if (s.length === n) {
      out.push(s);
      return;
    }
    for (const c of Object.keys(left))
      if (left[c]! > 0 && c !== last) {
        left[c]!--;
        walk(s + c, c);
        left[c]!++;
      }
  };
  walk('', '');
  return out;
}

function runners(count: number, club: string): DrawRunner[] {
  return Array.from({ length: count }, (_, i) => ({ id: `${club}-${i}`, club }));
}

function mixedRunners(clubs: Array<[string, number]>): DrawRunner[] {
  return clubs.flatMap(([club, count]) => runners(count, club));
}

// ---------------------------------------------------------------------------
// drawSOFT tests
// ---------------------------------------------------------------------------

describe('draw algorithms', () => {
  describe('drawSOFT', () => {
    test('test 1: 10 runners from 3 clubs → permutation + zero adjacency', () => {
      const input = mixedRunners([
        ['Alpha', 4],
        ['Beta', 3],
        ['Gamma', 3],
      ]);
      const result = drawSOFT(input, { rngFn: makeLcgRng(1) });
      const real = result.order.filter((s): s is DrawRunner => s !== null);

      // Same set of IDs
      assert.deepEqual(real.map((r) => r.id).sort(), input.map((r) => r.id).sort());
      assert.equal(result.adjacencyCount, 0);
    });

    test('test 2: all runners from same club → no crash, no duplicates, adjacencyCount == 9', () => {
      const input = runners(10, 'Alpha');
      const result = drawSOFT(input, { rngFn: makeLcgRng(2) });
      const real = result.order.filter((s): s is DrawRunner => s !== null);
      assert.equal(real.length, 10);
      // All IDs present
      assert.deepEqual(real.map((r) => r.id).sort(), input.map((r) => r.id).sort());
      // 10 runners same club → 9 adjacencies (every pair adjacent)
      assert.equal(result.adjacencyCount, 9);
    });

    test('test 2b: 6 runners where one club has 5 → adjacencyCount >= 3 (impossibility-aware)', () => {
      const input = mixedRunners([
        ['BigClub', 5],
        ['SmallClub', 1],
      ]);
      const result = drawSOFT(input, { rngFn: makeLcgRng(3) });
      const real = result.order.filter((s): s is DrawRunner => s !== null);
      assert.equal(real.length, 6);
      // With 5/6 from same club, minimum adjacency is 4 (can't avoid it)
      assert.ok(result.adjacencyCount >= 3, `adjacencyCount was ${result.adjacencyCount}`);
    });

    test('test 3: 0 runners → empty array', () => {
      const result = drawSOFT([], { rngFn: makeLcgRng(4) });
      assert.deepEqual(result.order, []);
      assert.equal(result.adjacencyCount, 0);
    });

    test('test 4: 1 runner → array of 1', () => {
      const input: DrawRunner[] = [{ id: 'solo', club: 'OnlyClub' }];
      const result = drawSOFT(input, { rngFn: makeLcgRng(5) });
      const real = result.order.filter((s): s is DrawRunner => s !== null);
      assert.equal(real.length, 1);
      assert.equal(real[0]!.id, 'solo');
    });

    test('test 7: vacantSlots=3 with 10 runners → 13 slots, 3 are null', () => {
      const input = mixedRunners([
        ['A', 4],
        ['B', 3],
        ['C', 3],
      ]);
      const result = drawSOFT(input, { vacantSlots: 3, rngFn: makeLcgRng(6) });
      assert.equal(result.order.length, 13);
      const nullCount = result.order.filter((s) => s === null).length;
      assert.equal(nullCount, 3);
      const realCount = result.order.filter((s) => s !== null).length;
      assert.equal(realCount, 10);
    });

    test('test 8: vacant slots distributed (not all at end)', () => {
      // 10 runners + 3 vacant = 13 slots; max gap between vacants <= ceil(13/3) = 5
      const input = mixedRunners([
        ['A', 4],
        ['B', 3],
        ['C', 3],
      ]);
      const result = drawSOFT(input, { vacantSlots: 3, rngFn: makeLcgRng(7) });
      const vacantIdxs = result.order.map((s, i) => (s === null ? i : -1)).filter((i) => i >= 0);
      assert.equal(vacantIdxs.length, 3);
      // Verify not all at end
      const allAtEnd = vacantIdxs.every((i) => i >= 10);
      assert.ok(!allAtEnd, 'All vacant slots were at the end');
    });

    test('test 9: 200 runners from 20 clubs completes without stack overflow', () => {
      const input = mixedRunners(
        Array.from({ length: 20 }, (_, i) => [`Club${i}`, 10] as [string, number])
      );
      assert.equal(input.length, 200);
      const result = drawSOFT(input, { rngFn: makeLcgRng(9) });
      const real = result.order.filter((s): s is DrawRunner => s !== null);
      assert.equal(real.length, 200);
      // Must be a permutation
      assert.deepEqual(real.map((r) => r.id).sort(), input.map((r) => r.id).sort());
      // Should have zero or very low adjacency (20 clubs x 10 each is perfectly separable)
      assert.equal(result.adjacencyCount, 0);
    });

    test('test 1b: SOFT adjacency verified across 10 seeded runs (3-club scenario)', () => {
      const input = mixedRunners([
        ['Alpha', 4],
        ['Beta', 3],
        ['Gamma', 3],
      ]);
      for (let seed = 100; seed < 110; seed++) {
        const result = drawSOFT(input, { rngFn: makeLcgRng(seed) });
        const real = result.order.filter((s): s is DrawRunner => s !== null);
        // Always a permutation
        assert.deepEqual(
          real.map((r) => r.id).sort(),
          input.map((r) => r.id).sort(),
          `seed ${seed}: not a permutation`
        );
        // Always zero adjacency (3 clubs, none dominant)
        assert.equal(result.adjacencyCount, 0, `seed ${seed}: adjacency not zero`);
      }
    });
  });

  // SOFT TR 7.5.1 (2026-07-01): "Tävlande från samma förening ska om möjligt
  // inte starta direkt efter varandra." Adjacency is counted from the
  // returned order (not the reported adjacencyCount). The fewest same-club
  // neighbours possible is max(0, 2·maxClub − n − 1); a runner without a
  // club neighbours nobody.
  describe('drawSOFT — club separation (SOFT TR 7.5.1)', () => {
    const neighbours = (order: readonly (DrawRunner | null)[]): number => {
      const real = order.filter((s): s is DrawRunner => s !== null);
      let n = 0;
      for (let i = 1; i < real.length; i++)
        if (real[i]!.club !== null && real[i]!.club === real[i - 1]!.club) n++;
      return n;
    };
    const fewest = (input: DrawRunner[]): number => {
      const sizes = new Map<string, number>();
      for (const r of input) {
        const key = r.club ?? `__${r.id}`;
        sizes.set(key, (sizes.get(key) ?? 0) + 1);
      }
      return Math.max(0, 2 * Math.max(...sizes.values()) - input.length - 1);
    };

    test('SOFT TR 7.5.1: A×4/B×2/C×2 → no same-club neighbours (Codex counterexample)', () => {
      const input = mixedRunners([
        ['A', 4],
        ['B', 2],
        ['C', 2],
      ]);
      for (let seed = 1; seed <= 50; seed++) {
        const result = drawSOFT(input, { rngFn: makeLcgRng(seed) });
        const ids = result.order.map((r) => r!.id).sort();
        assert.deepEqual(ids, input.map((r) => r.id).sort(), `seed ${seed}: not a permutation`);
        assert.equal(
          neighbours(result.order),
          0,
          `seed ${seed}: ${result.order.map((r) => r!.club)}`
        );
        assert.equal(result.adjacencyCount, 0);
      }
    });

    test('SOFT TR 7.5.1: property — over random club distributions the same-club neighbours are max(0, 2·maxClub − n − 1)', () => {
      const pick = makeLcgRng(4711);
      for (let i = 0; i < 400; i++) {
        const clubs = pick(1, 6);
        const input: DrawRunner[] = [];
        for (let c = 0; c < clubs; c++) input.push(...runners(pick(1, 9), `K${c}`));
        // Some runners without a club.
        for (let u = pick(0, 3); u > 0; u--) input.push({ id: `none-${i}-${u}`, club: null });
        const result = drawSOFT(input, { vacantSlots: pick(0, 3), rngFn: makeLcgRng(i + 1) });
        const real = result.order.filter((s): s is DrawRunner => s !== null);
        const shape = input.map((r) => r.club).join();
        assert.deepEqual(real.map((r) => r.id).sort(), input.map((r) => r.id).sort(), shape);
        assert.equal(
          neighbours(result.order),
          fewest(input),
          `${shape} → ${real.map((r) => r.club)}`
        );
        assert.equal(result.adjacencyCount, fewest(input), shape);
      }
    });

    test('SOFT TR 7.5.1/7.5.2: re-draws differ — club pattern and first club vary between draws', () => {
      const input = mixedRunners([
        ['A', 4],
        ['B', 4],
        ['C', 2],
      ]);
      const patterns = new Set<string>();
      const firstClubs = new Set<string | null>();
      for (let seed = 1; seed <= 30; seed++) {
        const order = drawSOFT(input, { rngFn: makeLcgRng(seed * 7919) }).order;
        patterns.add(order.map((r) => r!.club).join(''));
        firstClubs.add(order[0]!.club);
      }
      assert.ok(patterns.size >= 10, `only ${patterns.size} club patterns in 30 draws`);
      assert.equal(firstClubs.size, 3, 'every club can start first');
    });
  });

  describe('drawSOFT — runners without a club', () => {
    test('SOFT TR 7.5.1: runners without a club are singletons — two of them may start in a row', () => {
      // TR 7.5.1 separates runners of the same förening; a club-less runner
      // has none. MeOS counts all club-less runners as one club
      // (oEventDraw.cpp:137-138, getClubId() 0) and would keep them apart.
      const input: DrawRunner[] = [
        ...runners(3, 'A'),
        ...Array.from({ length: 3 }, (_, i) => ({ id: `none-${i}`, club: null })),
      ];
      const rng = makeMulberryRng(5);
      const shapes = new Set<string>();
      for (let k = 0; k < 500; k++) {
        const r = drawSOFT(input, { rngFn: rng });
        assert.equal(r.adjacencyCount, 0);
        shapes.add(r.order.map((s) => s!.club ?? '-').join(''));
      }
      assert.ok(
        [...shapes].some((s) => s.includes('--')),
        `club-less runners never adjacent: ${[...shapes].join(' ')}`
      );
    });
  });

  describe('drawSOFT — proof against SOFT TR 7.5.1 and TR 7.5.2', () => {
    const classOf = (sizes: Record<string, number>, clubless = 0): DrawRunner[] => [
      ...Object.entries(sizes).flatMap(([club, n]) => runners(n, club)),
      ...Array.from({ length: clubless }, (_, i) => ({ id: `none-${i}`, club: null })),
    ];
    const pattern = (order: readonly (DrawRunner | null)[]) =>
      order
        .filter((s): s is DrawRunner => s !== null)
        .map((r) => r.club ?? '-')
        .join('');
    /** Chi-square critical value at p = 0.001 (Wilson–Hilferty). */
    const chiCritical = (df: number) =>
      df * Math.pow(1 - 2 / (9 * df) + 3.09 * Math.sqrt(2 / (9 * df)), 3);

    test('SOFT TR 7.5.1: every class shape up to 4 clubs × 4 (+ 0–2 club-less) → fewest neighbours in every draw', () => {
      const rng = makeMulberryRng(1);
      const shapes: number[][] = [];
      const grow = (sizes: number[]) => {
        if (sizes.length > 0) shapes.push(sizes);
        if (sizes.length === 4) return;
        for (let n = 1; n <= (sizes.at(-1) ?? 4); n++) grow([...sizes, n]);
      };
      grow([]);
      for (const sizes of shapes)
        for (let clubless = 0; clubless <= 2; clubless++) {
          const input = classOf(Object.fromEntries(sizes.map((n, i) => [`K${i}`, n])), clubless);
          const fewest = Math.max(0, 2 * sizes[0]! - input.length - 1);
          for (let k = 0; k < 5; k++) {
            const r = drawSOFT(input, { rngFn: rng });
            assert.equal(r.adjacencyCount, fewest, `${sizes}+${clubless}: ${pattern(r.order)}`);
          }
        }
    });

    /** Brute force: every club pattern of the class ('-' = no club, never a
     * neighbour) with the fewest same-club neighbours, the seams to the
     * clubs `before` / `after` counted. */
    const fewestWords = (
      sizes: Record<string, number>,
      clubless = 0,
      before: string | null = null,
      after: string | null = null
    ): { fewest: number; words: string[] } => {
      const left: Record<string, number> = { ...sizes, ...(clubless ? { '-': clubless } : {}) };
      const n = Object.values(left).reduce((a, b) => a + b, 0);
      const pair = (a: string | null, b: string | null) => a !== null && a !== '-' && a === b;
      let fewest = Number.POSITIVE_INFINITY;
      let words: string[] = [];
      const walk = (s: string, last: string | null, cost: number): void => {
        if (cost > fewest) return;
        if (s.length === n) {
          const total = cost + (pair(last, after) ? 1 : 0);
          if (total < fewest) [fewest, words] = [total, []];
          if (total === fewest) words.push(s);
          return;
        }
        for (const c of Object.keys(left))
          if (left[c]! > 0) {
            left[c]!--;
            walk(s + c, c, cost + (pair(last, c) ? 1 : 0));
            left[c]!++;
          }
      };
      walk('', before, 0);
      return { fewest, words };
    };
    /** Draw N = perPattern × patterns times; every pattern appears, no
     * other, and the counts pass chi-square against uniform (p = 0.001). */
    const assertUniform = (
      sizes: Record<string, number>,
      clubless: number,
      boundary: { before?: string | null; after?: string | null },
      seed: number,
      perPattern = 100
    ) => {
      const { words } = fewestWords(sizes, clubless, boundary.before, boundary.after);
      const N = perPattern * words.length;
      const rng = makeMulberryRng(seed);
      const seen = new Map<string, number>();
      for (let k = 0; k < N; k++) {
        const p = pattern(drawSOFT(classOf(sizes, clubless), { boundary, rngFn: rng }).order);
        seen.set(p, (seen.get(p) ?? 0) + 1);
      }
      const shape = `${JSON.stringify(sizes)}+${clubless} ${JSON.stringify(boundary)} seed ${seed}`;
      assert.deepEqual(
        [...seen.keys()].sort(),
        [...words].sort(),
        `${shape}: every pattern, no other`
      );
      const chi = words.reduce(
        (x, p) => x + ((seen.get(p) ?? 0) - perPattern) ** 2 / perPattern,
        0
      );
      if (words.length === 1) return; // one pattern: nothing to compare
      const critical = chiCritical(words.length - 1);
      assert.ok(chi < critical, `${shape}: chi-square ${chi.toFixed(1)} ≥ ${critical.toFixed(1)}`);
    };

    test('SOFT TR 7.5.2: exhaustive — every fewest-neighbour club pattern is drawn, uniformly (chi-square, p = 0.001)', () => {
      // A×10/B×9/C×1: the Codex counterexample to the swap chain (38
      // patterns, 3800 draws, seeds 4711, 99 and 2026).
      for (const seed of [4711, 99, 2026]) assertUniform({ A: 10, B: 9, C: 1 }, 0, {}, seed);
      const shapes: Array<[Record<string, number>, number]> = [
        [{ A: 4, B: 4, C: 2 }, 0],
        [{ A: 5, B: 3, C: 2 }, 0],
        [{ A: 3, B: 2, C: 2 }, 0],
        [{ A: 3, B: 1, C: 1, D: 1 }, 0],
        [{ A: 5, B: 1, C: 1 }, 0], // A > n/2: 2 neighbours at best
        [{ A: 6, B: 2 }, 0], // 3 neighbours at best
        [{ A: 3 }, 3], // runners without a club
        [{ A: 3, B: 2 }, 2],
        [{ A: 5, B: 1 }, 2],
      ];
      for (const [sizes, clubless] of shapes) assertUniform(sizes, clubless, {}, 4711);
    });

    test('SOFT TR 7.5.1/7.5.2: fixed clubs before and after the block → every fewest-neighbour pattern, seams counted, uniformly (chi-square, p = 0.001)', () => {
      const cases: Array<[Record<string, number>, number, { before?: string; after?: string }]> = [
        [{ A: 4, B: 4, C: 2 }, 0, { before: 'A' }],
        [{ A: 4, B: 4, C: 2 }, 0, { after: 'A' }],
        [{ A: 4, B: 4, C: 2 }, 0, { before: 'A', after: 'B' }],
        [{ A: 4, B: 4, C: 2 }, 0, { before: 'C', after: 'C' }],
        [{ A: 5, B: 3, C: 2 }, 0, { before: 'A', after: 'A' }], // A must touch a seam
        [{ A: 3, B: 2, C: 2 }, 0, { before: 'B', after: 'C' }],
        [{ A: 10, B: 9, C: 1 }, 0, { before: 'B' }],
        [{ A: 4, B: 1 }, 0, { before: 'A', after: 'A' }], // A > n/2 and both seams A
        [{ A: 2, B: 2 }, 1, { before: 'Z', after: 'B' }], // Z runs nobody here
        [{ A: 2 }, 0, { before: 'A', after: 'A' }], // nothing but the seam club
      ];
      for (const [sizes, clubless, boundary] of cases)
        assertUniform(sizes, clubless, boundary, 4711);
    });

    test('SOFT TR 7.5.1: the pattern count and the fewest neighbours equal brute force — every shape up to 10 runners in ≤ 4 clubs, every boundary', () => {
      const shapes: number[][] = [];
      const grow = (sizes: number[]) => {
        if (sizes.length > 0) shapes.push(sizes);
        if (sizes.length === 4) return;
        const used = sizes.reduce((a, b) => a + b, 0);
        for (let n = 1; n <= Math.min(sizes.at(-1) ?? 10, 10 - used); n++) grow([...sizes, n]);
      };
      grow([]);
      const letter = (i: number) => (i < 0 ? null : 'ABCDZ'[i]!);
      let checked = 0;
      for (const sizes of shapes) {
        const named = Object.fromEntries(sizes.map((n, i) => [letter(i)!, n]));
        // -1: no fixed starter; 4: a club with no runner in the block.
        for (let b = -1; b <= 4; b++)
          for (let a = -1; a <= 4; a++) {
            if ((b >= sizes.length && b < 4) || (a >= sizes.length && a < 4)) continue;
            const brute = fewestWords(named, 0, letter(b), letter(a));
            const counted = fewestPatterns(sizes, b, a);
            const what = `${sizes} before ${letter(b)} after ${letter(a)}`;
            assert.equal(counted.fewest, brute.fewest, what);
            assert.equal(counted.count, BigInt(brute.words.length), what);
            checked++;
          }
      }
      assert.ok(checked > 1500, `${checked} cases`);
      // No runner between the fixed starters: they meet each other.
      assert.deepEqual(fewestPatterns([0, 0], 0, 0), { fewest: 1, count: 1n });
      assert.deepEqual(fewestPatterns([0, 0], 0, 1), { fewest: 0, count: 1n });
    });

    test('SOFT TR 7.5.1: property — random shapes and boundaries → the drawn order has the fewest neighbours, seams counted', () => {
      const pick = makeMulberryRng(2718);
      for (let i = 0; i < 300; i++) {
        const sizes: Record<string, number> = {};
        for (let c = pick(1, 8); c > 0; c--) sizes[`K${c}`] = pick(1, 12);
        const clubless = pick(0, 4);
        const clubs = [...Object.keys(sizes), 'Other', null];
        const boundary = {
          before: clubs[pick(0, clubs.length)] ?? null,
          after: clubs[pick(0, clubs.length)] ?? null,
        };
        const input = classOf(sizes, clubless);
        const order = drawSOFT(input, { boundary, rngFn: pick }).order as DrawRunner[];
        const keys = Object.keys(sizes);
        const index = (c: string | null) => (c === null ? -1 : keys.indexOf(c));
        const counts = [...Object.values(sizes), ...Array<number>(clubless).fill(1)];
        const { fewest } = fewestPatterns(counts, index(boundary.before), index(boundary.after));
        const all = [{ club: boundary.before }, ...order, { club: boundary.after }];
        let got = 0;
        for (let k = 1; k < all.length; k++)
          if (all[k]!.club !== null && all[k]!.club === all[k - 1]!.club) got++;
        const what = `${JSON.stringify(sizes)}+${clubless} ${JSON.stringify(boundary)}: ${pattern(order)}`;
        assert.deepEqual(order.map((r) => r.id).sort(), input.map((r) => r.id).sort(), what);
        assert.equal(got, fewest, what);
        if (boundary.before === null && boundary.after === null) {
          const n = input.length;
          assert.equal(fewest, Math.max(0, 2 * Math.max(...Object.values(sizes)) - n - 1), what);
        }
      }
    });

    test('SOFT TR 7.5.2: the largest club starts first as often as in the valid orders, not more', () => {
      for (const sizes of [
        { A: 5, B: 3, C: 2 },
        { A: 4, B: 2, C: 2 },
      ]) {
        const valid = validPatterns(sizes);
        const share = valid.filter((p) => p[0] === 'A').length / valid.length;
        const rng = makeMulberryRng(99);
        const N = 2000;
        let first = 0;
        for (let k = 0; k < N; k++)
          if (drawSOFT(classOf(sizes), { rngFn: rng }).order[0]!.club === 'A') first++;
        assert.ok(
          Math.abs(first / N - share) < 0.03,
          `${JSON.stringify(sizes)}: A first in ${(first / N).toFixed(3)}, valid orders ${share.toFixed(3)}`
        );
      }
    });

    test('SOFT TR 7.5.2: vacancy positions vary between redraws (3 vacancies, 10 runners)', () => {
      const input = classOf({ A: 4, B: 3, C: 3 });
      const rng = makeMulberryRng(17);
      const layouts = new Set<string>();
      const firstSlotVacant = { yes: 0, no: 0 };
      for (let k = 0; k < 300; k++) {
        const order = drawSOFT(input, { vacantSlots: 3, rngFn: rng }).order;
        layouts.add(order.map((s, i) => (s === null ? i : '')).join(','));
        if (order[0] === null) firstSlotVacant.yes++;
        else firstSlotVacant.no++;
      }
      assert.ok(layouts.size >= 100, `only ${layouts.size} vacancy layouts in 300 redraws`);
      assert.ok(firstSlotVacant.yes > 0 && firstSlotVacant.no > 0, 'slot 0 always or never vacant');
    });
  });

  describe('placeVacancies (SOFT TR 7.3.2, 7.5.2)', () => {
    const ten = mixedRunners([
      ['A', 4],
      ['B', 3],
      ['C', 3],
    ]);
    const gapsOf = (slots: readonly (DrawRunner | null)[]): string => {
      // Vacancy positions as "gap index" = runners before it.
      const g: number[] = [];
      let seenRunners = 0;
      for (const s of slots)
        if (s === null) g.push(seenRunners);
        else seenRunners++;
      return g.join(',');
    };

    test('Mixed: 3 vacancies among 10 runners → never adjacent, positions vary between draws', () => {
      const rng = makeMulberryRng(17);
      const sets = new Set<string>();
      const used = new Set<number>();
      for (let k = 0; k < 300; k++) {
        const slots = placeVacancies(ten, 3, 'Mixed', rng);
        assert.equal(slots.length, 13);
        assert.deepEqual(
          slots.filter((s) => s !== null),
          ten,
          'runner order kept'
        );
        for (let i = 1; i < slots.length; i++)
          assert.ok(
            !(slots[i] === null && slots[i - 1] === null),
            `adjacent vacancies: ${gapsOf(slots)}`
          );
        sets.add(gapsOf(slots));
        for (const g of gapsOf(slots).split(',')) used.add(Number(g));
      }
      assert.ok(sets.size >= 100, `only ${sets.size} vacancy layouts in 300 draws`);
      assert.equal(used.size, 11, 'every gap 0…10 is used');
    });

    test('Mixed: more vacancies than gaps → all placed, runner order kept', () => {
      const two = runners(2, 'A');
      const slots = placeVacancies(two, 5, 'Mixed', makeMulberryRng(3));
      assert.equal(slots.filter((s) => s === null).length, 5);
      assert.deepEqual(
        slots.filter((s) => s !== null),
        two
      );
    });

    test('First and Last: vacancies before or after the whole class (MeOS VacantPosition)', () => {
      const first = placeVacancies(ten, 2, 'First', makeMulberryRng(1));
      assert.deepEqual(first.slice(0, 2), [null, null]);
      assert.deepEqual(first.slice(2), ten);
      const last = placeVacancies(ten, 2, 'Last', makeMulberryRng(1));
      assert.deepEqual(last.slice(10), [null, null]);
      assert.deepEqual(last.slice(0, 10), ten);
    });

    test('drawSOFT with vacancies → all runners plus the vacancies (SOFT TR 7.3.2)', () => {
      const result = drawSOFT(ten, {
        vacantSlots: 2,
        vacantPosition: 'Last',
        rngFn: makeMulberryRng(9),
      });
      assert.equal(result.order.length, 12);
      assert.deepEqual(result.order.slice(10), [null, null]);
      assert.deepEqual(
        result.order
          .filter((s): s is DrawRunner => s !== null)
          .map((r) => r.id)
          .sort(),
        ten.map((r) => r.id).sort()
      );
    });
  });

  // ---------------------------------------------------------------------------
  // drawSimultaneous tests
  // ---------------------------------------------------------------------------

  describe('drawSimultaneous', () => {
    test('test 6: 5 runners → all get the same start time (order preserved)', () => {
      const input = mixedRunners([
        ['A', 3],
        ['B', 2],
      ]);
      const result = drawSimultaneous(input);
      const real = result.order.filter((s): s is DrawRunner => s !== null);
      assert.equal(real.length, 5);
      // Input order preserved (simultaneous = no reordering)
      assert.deepEqual(
        real.map((r) => r.id),
        input.map((r) => r.id)
      );
      // adjacencyCount should reflect actual adjacencies in the unchanged order
      // (simultaneous means the route will assign the same time to all slots)
    });
  });
});
