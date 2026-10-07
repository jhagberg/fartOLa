// Authored for fartola. Not ported from upstream.
//
// ADR-0003 update: competitors.start_time_ms is a cache of the
// start_times_set events. Only db/startTimes.ts may write it (plus the
// one-time unit conversion in db/migrate.ts, which predates the events).
// This test fails when any other source file writes the column: a Drizzle
// `.set({ … startTimeMs … })` or `.values({ … startTimeMs … })`, or SQL
// that sets or inserts start_time_ms.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(import.meta.dirname, '..');
const ALLOWED = new Set(['db/startTimes.ts', 'db/migrate.ts']);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [full] : [];
  });
}

/** Source without // and /* comments, so prose about the column never counts. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** Writes of the start-time cache found in `text`. */
export function startTimeWrites(text: string): string[] {
  const c = code(text);
  const found: string[] = [];
  for (const m of c.matchAll(/\.(set|values)\(\s*\{[^}]*\bstartTimeMs\b[^}]*\}/g)) found.push(m[0]);
  // `.set(variable)` / `.values(variable)` on the competitors table: the
  // variable's declared type must exclude startTimeMs (Omit<…, 'startTimeMs'>).
  for (const m of c.matchAll(
    /\.(?:update|insert)\(\s*competitors(?:Table)?\s*\)\s*\.(?:set|values)\(\s*([A-Za-z_]\w*)\s*\)/g
  )) {
    const decl = new RegExp(`(?:const|let)\\s+${m[1]}\\s*:([^=]+)=`).exec(c);
    if (decl === null || !/Omit<.*startTimeMs/.test(decl[1]!)) found.push(m[0]);
  }
  for (const m of c.matchAll(/\bSET\b[^;`'"]*\bstart_time_ms\s*=/gi)) found.push(m[0]);
  for (const m of c.matchAll(/INSERT\s+INTO\s+competitors\s*\([^)]*\bstart_time_ms\b/gi))
    found.push(m[0]);
  return found;
}

describe('start-time cache guard (ADR-0003)', () => {
  test('the pattern catches a Drizzle set, a Drizzle insert and raw SQL', () => {
    assert.equal(startTimeWrites('db.update(competitors).set({ startTimeMs: 1 })').length, 1);
    assert.equal(startTimeWrites('db.insert(competitors).values({ id, startTimeMs })').length, 1);
    assert.equal(startTimeWrites("prepare('UPDATE competitors SET start_time_ms = ?')").length, 1);
    assert.equal(
      startTimeWrites("prepare('INSERT INTO competitors (id, start_time_ms) VALUES (?, ?)')")
        .length,
      1
    );
    assert.equal(
      startTimeWrites('const u = {};\ndb.update(competitors).set(u).run()').length,
      1,
      '.set(variable) with no Omit type'
    );
    assert.equal(
      startTimeWrites('const u: Partial<Competitor> = {};\ndb.update(competitors).set(u).run()')
        .length,
      1
    );
    assert.equal(
      startTimeWrites(
        "const u: Omit<Partial<Competitor>, 'startTimeMs'> = {};\ndb.update(competitors).set(u).run()"
      ).length,
      0
    );
    assert.equal(
      startTimeWrites('// assigns start_time_ms = first\nconst x = r.startTimeMs;').length,
      0
    );
  });

  test('ADR-0003: only db/startTimes.ts writes competitors.start_time_ms', () => {
    const offenders = sources(SRC)
      .map((f) => [path.relative(SRC, f).split(path.sep).join('/'), f] as const)
      .filter(([rel]) => !ALLOWED.has(rel))
      .flatMap(([rel, f]) => startTimeWrites(readFileSync(f, 'utf-8')).map((w) => `${rel}: ${w}`));
    assert.deepEqual(offenders, []);
  });
});
