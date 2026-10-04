// Authored for fartola. Not ported from upstream.
//
// Embedded Drizzle migrator for the apps/edge bridge. Runs at every cold
// start; idempotent. drizzle-orm's migrator walks meta/_journal.json
// numerically and applies every listed migration whose hash is not yet
// recorded in the __drizzle_migrations table, so this single function
// applies BOTH 0000_initial.sql AND 0001_append_only_triggers.sql on a
// fresh database. On second + subsequent calls it is a no-op.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-CONTEXT.md
//   "Claude's Discretion" — embedded migrator at bridge startup so
//   `npm install -g fartola && fartola` Just Works on an empty data dir.
// - .planning/phases/01-single-laptop-training-mvp/01-RESEARCH.md
//   §"Pattern 2: Embedded migrator at bridge cold start" (verbatim).
// - .planning/phases/01-single-laptop-training-mvp/01-REVIEWS.md §C-H1
//   (migrate.test.ts asserts BOTH 0000 + 0001 apply on cold start —
//    the regression gate for "drizzle-kit regenerates 0000, forgets 0001").
// - REQ-OPS-001 (single-binary install), REQ-OPS-002 (restart-safe).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import * as schema from './schema.ts';
import { localToEpochMs } from '../time/competitionClock.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the bundled drizzle/ folder. Resolved relative to this
 * file via import.meta.url so the embedded migrator works regardless of how
 * the binary is launched (pnpm dev, tsx, node dist/, npm install -g, etc.).
 * Exported so tests can assert the resolution + so a future build step can
 * verify the folder is present in the published tarball. */
export const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../drizzle');

/** Run all pending Drizzle migrations on the given better-sqlite3 instance.
 * Idempotent — subsequent calls on the same db are a no-op. */
export function runMigrations(sqlite: Database.Database): void {
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: MIGRATIONS_FOLDER });
  migrateStartTimesToEpoch(sqlite);
}

/** 1970-01-02 in epoch ms. Any start time below it was written by the old
 * lottning flow as local ms since midnight (02.1-14 Task 1). */
const LOCAL_MS_LIMIT = 86_400_000;

/** Data migration: convert legacy local ms-since-midnight start times
 * (competitors.start_time_ms, classes.first_start_ms) to epoch ms using the
 * competition's date in COMPETITION_TZ. Runs in JS rather than a .sql file
 * because SQLite cannot do time-zone/DST conversion, and it is idempotent by
 * construction: converted values are far above LOCAL_MS_LIMIT. */
function migrateStartTimesToEpoch(sqlite: Database.Database): void {
  const convert = (table: 'competitors' | 'classes', column: string): void => {
    const rows = sqlite
      .prepare<[number], { id: string; ms: number; date: string }>(
        `SELECT t.id AS id, t.${column} AS ms, c.date AS date FROM ${table} t
         JOIN competitions c ON c.id = t.competition_id
         WHERE t.${column} IS NOT NULL AND t.${column} < ?`
      )
      .all(LOCAL_MS_LIMIT);
    const update = sqlite.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`);
    for (const r of rows) update.run(localToEpochMs(r.date, r.ms / 1000), r.id);
  };
  sqlite.transaction(() => {
    convert('competitors', 'start_time_ms');
    convert('classes', 'first_start_ms');
  })();
}
