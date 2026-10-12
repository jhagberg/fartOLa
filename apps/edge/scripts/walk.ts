// Authored for fartola. Not ported from upstream.
//
// A random walk over the edge API that looks for what an operator can break
// by doing things in the wrong order (layer 1 of
// .planning/todos/pending/2026-10-12-operator-mistake-testing.md).
//
//   pnpm --filter @fartola/edge exec tsx scripts/walk.ts --seed 1 --steps 300
//   pnpm --filter @fartola/edge exec tsx scripts/walk.ts --seed 1 --seeds 20 --steps 200
//
// --seed N    first seed (default 1)
// --seeds K   walk K seeds, N .. N+K-1 (default 1)
// --steps M   steps per seed (default 300)
// --checks L  only the checks in the list L, e.g. 2,4,5
// --all       walk on after a failure and list every kind found per seed
//             (each kind once, not shrunk)
//
// A seed builds a small synthetic competition (walkWorld.ts) and a list of
// steps (walkOps.ts): start, reset, undo, card reads, imports, changes of
// class, card, start time, status and so on, with the confirmations sent at
// some later time. After every step the checks in walkChecks.ts run. The
// same seed gives the same walk and the same result.
//
// A failure prints the seed, the check, and the shortest list of steps
// found that still fails, ready to paste into a test (see walk.test.ts).
// Exit code 1 when a walk failed. Faults listed as KNOWN in walkChecks.ts
// are counted and do not stop a walk.
//
// CI runs a short fixed walk (walk.test.ts); longer walks are run by hand.

import { OPS, stepsOf } from './walkOps.ts';
import { runChecks, snapshot, type Failure } from './walkChecks.ts';
import { closeWorld, fake, flush, openWorld, rng, type Step, type WayBack } from './walkWorld.ts';

export interface WalkResult {
  /** The first step with a failure that is not known, and what failed. */
  failure?: { index: number; step: Step; failures: Failure[] };
  /** Every kind of failure met (failure id and op), with its first step. */
  kinds: Map<string, { index: number; failure: Failure; count: number }>;
  /** Known faults met, and how often. */
  known: Map<string, number>;
  /** Per op: how many of its writing requests were accepted / refused. */
  answers: Map<string, { ok: number; refused: number }>;
}

/** Walk `steps` in the world of `seed`. `only` limits the checks; `all`
 * walks on after a failure. */
export async function walk(
  seed: number,
  steps: readonly Step[],
  opts: { only?: ReadonlySet<number>; all?: boolean } = {}
): Promise<WalkResult> {
  const result: WalkResult = { kinds: new Map(), known: new Map(), answers: new Map() };
  const rejections: unknown[] = [];
  const onRejection = (e: unknown): void => void rejections.push(e);
  process.on('unhandledRejection', onRejection);
  const w = await openWorld(seed);
  try {
    let before = snapshot(w);
    for (const [index, step] of steps.entries()) {
      fake.now += step.dt;
      fake.ints = rng(step.rnd);
      w.trace = [];
      w.stale = [];
      let wayBack: WayBack | undefined;
      let threw: unknown;
      try {
        wayBack = (await OPS[step.op]!.run(w, step)) ?? undefined;
      } catch (e) {
        threw = e;
      }
      await flush();
      const answers = result.answers.get(step.op) ?? { ok: 0, refused: 0 };
      for (const t of w.trace) {
        if (t.method !== 'GET') answers[t.status < 300 ? 'ok' : 'refused']++;
      }
      result.answers.set(step.op, answers);

      const { failures, after } = await runChecks(
        w,
        {
          step,
          before,
          rejections: rejections.splice(0),
          ...(wayBack ? { wayBack } : {}),
          ...(threw !== undefined ? { threw } : {}),
        },
        opts.only
      );
      before = after;
      for (const f of failures) {
        if (f.known !== undefined) result.known.set(f.known, (result.known.get(f.known) ?? 0) + 1);
      }
      const unknown = failures.filter((f) => f.known === undefined);
      for (const f of unknown) {
        const key = `${f.id} after ${step.op}${step.k === undefined ? '' : ':' + step.k}`;
        const kind = result.kinds.get(key);
        if (kind) kind.count++;
        else result.kinds.set(key, { index, failure: f, count: 1 });
      }
      if (unknown.length > 0 && result.failure === undefined) {
        result.failure = { index, step, failures: unknown };
        if (!opts.all) return result;
      }
    }
    return result;
  } finally {
    process.off('unhandledRejection', onRejection);
    await closeWorld(w);
  }
}

/** The shortest list of steps found that still fails with `id`: drop chunks
 * of steps, then single steps, while the walk still fails the same way. */
export async function shrink(seed: number, steps: readonly Step[], f: Failure): Promise<Step[]> {
  const only = new Set([f.check]);
  let cur = [...steps];
  /** Index of the failing step, or -1 when the walk no longer fails so. */
  const failsAt = async (cand: Step[]): Promise<number> => {
    const r = await walk(seed, cand, { only });
    return r.failure?.failures.some((x) => x.id === f.id) ? r.failure.index : -1;
  };
  for (let size = Math.max(1, cur.length >> 1); ;) {
    let dropped = false;
    for (let i = 0; i < cur.length;) {
      const cand = [...cur.slice(0, i), ...cur.slice(i + size)];
      const idx = await failsAt(cand);
      if (idx >= 0) {
        cur = cand.slice(0, idx + 1);
        dropped = true;
      } else {
        i += size;
      }
    }
    if (size === 1 && !dropped) return cur;
    if (!dropped) size = Math.max(1, size >> 1);
  }
}

const show = (s: Step): string =>
  `  { op: '${s.op}', ${s.k === undefined ? '' : `k: '${s.k}', `}a: ${s.a}, b: ${s.b}, c: ${s.c}, dt: ${s.dt}, rnd: ${s.rnd} },`;

/** A failing walk as a test to paste in. */
export function asTest(seed: number, steps: readonly Step[], f: Failure): string {
  return [
    `test('walk ${seed}: check ${f.check} ${f.id}', async () => {`,
    `  // ${f.msg.slice(0, 400).replace(/\n/g, ' ')}`,
    `  const r = await walk(${seed}, [`,
    ...steps.map((s) => '  ' + show(s)),
    `  ]);`,
    `  assert.equal(r.failure, undefined, JSON.stringify(r.failure));`,
    `});`,
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name: string, fallback: number): number => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? fallback : Number(process.argv[i + 1]);
  };
  const [first, seeds, count] = [arg('seed', 1), arg('seeds', 1), arg('steps', 300)];
  const all = process.argv.includes('--all');
  const list = process.argv.indexOf('--checks');
  const only = list === -1 ? undefined : new Set(process.argv[list + 1]!.split(',').map(Number));
  let failed = false;
  const known = new Map<string, number>();
  const answers = new Map<string, { ok: number; refused: number }>();
  for (let seed = first; seed < first + seeds; seed++) {
    const steps = stepsOf(seed, count);
    const r = await walk(seed, steps, { all, ...(only ? { only } : {}) });
    for (const [k, n] of r.known) known.set(k, (known.get(k) ?? 0) + n);
    for (const [op, a] of r.answers) {
      const sum = answers.get(op) ?? { ok: 0, refused: 0 };
      answers.set(op, { ok: sum.ok + a.ok, refused: sum.refused + a.refused });
    }
    if (r.failure === undefined) {
      console.log(`seed ${seed}: ${count} steps, no failure`);
      continue;
    }
    failed = true;
    if (all) {
      console.log(`seed ${seed}: ${r.kinds.size} kinds of failure in ${count} steps`);
      for (const [id, k] of r.kinds) {
        console.log(
          `  ${id} ×${k.count}, first at step ${k.index}: ${k.failure.msg.slice(0, 420)}`
        );
      }
      continue;
    }
    const f = r.failure.failures[0]!;
    console.log(`seed ${seed}: FAILED at step ${r.failure.index} (${r.failure.step.op})`);
    for (const x of r.failure.failures) console.log(`  check ${x.check} ${x.id}: ${x.msg}`);
    const short = await shrink(seed, steps.slice(0, r.failure.index + 1), f);
    console.log(`shrunk from ${r.failure.index + 1} to ${short.length} steps:\n`);
    console.log(asTest(seed, short, f) + '\n');
  }
  for (const [k, n] of known) console.log(`known: ${k} ×${n}`);
  console.log(
    'requests accepted/refused per op: ' +
      [...answers].map(([op, a]) => `${op} ${a.ok}/${a.refused}`).join(', ')
  );
  process.exit(failed ? 1 : 0);
}
