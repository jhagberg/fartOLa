// Authored for fartola. Not ported from upstream.
//
// Typed db handle factory for apps/edge. Opens a better-sqlite3 connection,
// sets the locked WAL pragmas, runs the embedded migrator (applies BOTH
// 0000_initial.sql + 0001_append_only_triggers.sql via the journal walk —
// C-H1), and returns the drizzle handle + the raw sqlite instance + a
// close() helper.
//
// Pattern S-2 (sink injection): production code calls `openDatabase(dbPath)`
// once at boot; tests pass `':memory:'` or a tmpdir-rooted path and never
// touch a shared global. No top-level side effects.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-CONTEXT.md D-10
//   (Drizzle ORM on better-sqlite3)
// - .planning/phases/01-single-laptop-training-mvp/01-PATTERNS.md §S-2
//   (sink injection for testability)
// - .planning/phases/01-single-laptop-training-mvp/01-REVIEWS.md §C-H1
//   (migrator applies BOTH migrations on cold start)
// - REQ-OPS-001 (single-binary install), REQ-OPS-002 (restart-safe)
//
// WAL pragma set is the standard better-sqlite3 + WAL recipe:
//   journal_mode=WAL — concurrent readers + a single writer, crash-safe
//   synchronous=NORMAL — fast + safe under WAL (FULL is unnecessary)
//   foreign_keys=ON — enforce the FK declarations in schema.ts
//   cache_size=-32000 — 32 MB page cache (negative = KB; positive = pages)
//   temp_store=MEMORY — keep temp tables off disk for speed

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema.ts';
import { runMigrations } from './migrate.ts';

export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

export interface DbHandle {
  db: DrizzleDb;
  sqlite: Database.Database;
  close: () => void;
}

/** Open (or create) a SQLite database at `dbPath`, configure the locked
 * WAL pragmas, run pending migrations, and return a typed handle. Pass
 * `':memory:'` in tests; pass a real path in production. */
export function openDatabase(dbPath: string): DbHandle {
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('cache_size = -32000');
  sqlite.pragma('temp_store = MEMORY');
  // Multi-reader concurrent inserts from multiple BridgeLifecycle instances
  // can race on the same SQLite file. busy_timeout lets a writer retry for
  // up to 5 s before returning SQLITE_BUSY (WAL already allows one writer +
  // concurrent readers; this covers the brief write-lock contention window).
  sqlite.pragma('busy_timeout = 5000');
  runMigrations(sqlite);
  const db = drizzle(sqlite, { schema });
  return {
    db,
    sqlite,
    close: () => sqlite.close(),
  };
}
