// Authored for fartola. Not ported from upstream.
//
// node:test coverage for the embedded Drizzle migrator:
// - Idempotency on the same handle (REQ-EVT-004 mirror at infra layer).
// - BOTH 0000_initial + 0001_append_only_triggers apply on cold start
//   (C-H1 regression gate — if a future db:generate run loses the 0001
//   journal entry, __drizzle_migrations row count or trigger count fall
//   short and this test fails).
// - Cross-process restart-safety (REQ-OPS-002) — close handle, reopen on
//   the same dbPath, schema persists, node_id stable.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-REVIEWS.md §C-H1
// - REQ-OPS-002 (restart-safe), REQ-EVT-004 (idempotent replay shape)

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { openDatabase } from './index.ts';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.ts';
import { ensureNodeId } from './node-id.ts';
import { formatClockTime, localToEpochMs } from '../time/competitionClock.ts';
import { events } from './schema.ts';
import { loadCompetitionInputs } from '../projection/loader.ts';
import { reduce } from '../projection/reduce.ts';

interface MigrationRow {
  id: number;
  hash: string;
}

interface CountRow {
  count: number;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPECTED_MIGRATION_COUNT = 24;

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/** Bring a fresh sqlite to the state an older build left it in: run the real
 * drizzle migrator over a copy of drizzle/ whose journal is cut down (and
 * optionally edited) by `edit`. */
function migrateWithOldJournal(
  sqlite: Database.Database,
  edit: (entries: JournalEntry[]) => JournalEntry[]
): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'fartola-old-journal-'));
  try {
    cpSync(MIGRATIONS_FOLDER, dir, { recursive: true });
    const journalPath = path.join(dir, 'meta/_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: JournalEntry[];
    };
    journal.entries = edit(journal.entries);
    writeFileSync(journalPath, JSON.stringify(journal));
    migrate(drizzle(sqlite), { migrationsFolder: dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const hasTable = (sqlite: Database.Database, name: string): boolean =>
  sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name) !==
  undefined;

describe('migrator: idempotency + cold-start coverage', () => {
  test('test 1: calling runMigrations twice on the same sqlite is a no-op', () => {
    const handle = openDatabase(':memory:');
    try {
      // openDatabase already ran the migrator once. The current journal has
      // 24 entries: 0000..0007 plus 0009..0024 (0008 is intentionally absent).
      const initialCount = handle.sqlite
        .prepare<unknown[], CountRow>('SELECT count(*) as count FROM __drizzle_migrations')
        .get();
      assert.ok(initialCount);
      assert.equal(
        initialCount.count,
        EXPECTED_MIGRATION_COUNT,
        `expected ${EXPECTED_MIGRATION_COUNT} migrations applied (0000..0024, excluding 0008), got ${initialCount.count}`
      );

      // Call again — should be a no-op.
      runMigrations(handle.sqlite);
      const after = handle.sqlite
        .prepare<unknown[], CountRow>('SELECT count(*) as count FROM __drizzle_migrations')
        .get();
      assert.ok(after);
      assert.equal(after.count, EXPECTED_MIGRATION_COUNT, 'count must not change on second run');
    } finally {
      handle.close();
    }
  });

  test('test 2 (C-H1): 0000..0024 applied with distinct hashes; triggers present', () => {
    const handle = openDatabase(':memory:');
    try {
      const rows = handle.sqlite
        .prepare<unknown[], MigrationRow>(
          'SELECT id, hash FROM __drizzle_migrations ORDER BY id ASC'
        )
        .all();
      assert.equal(
        rows.length,
        EXPECTED_MIGRATION_COUNT,
        `expected ${EXPECTED_MIGRATION_COUNT} migrations, got ${rows.length}`
      );
      // All hashes pairwise distinct.
      const hashes = new Set(rows.map((r) => r.hash));
      assert.equal(hashes.size, EXPECTED_MIGRATION_COUNT, 'migration hashes must all be distinct');

      // Idempotent re-application.
      runMigrations(handle.sqlite);
      const after = handle.sqlite
        .prepare<unknown[], MigrationRow>(
          'SELECT id, hash FROM __drizzle_migrations ORDER BY id ASC'
        )
        .all();
      assert.equal(
        after.length,
        EXPECTED_MIGRATION_COUNT,
        `still ${EXPECTED_MIGRATION_COUNT} migrations after re-run`
      );

      // Triggers from 0001 (2 append-only) + 0004 (4 FTS sync) + 0006 (2 FTS update) = 8 total.
      const triggers = handle.sqlite
        .prepare<unknown[], CountRow>(
          "SELECT count(*) as count FROM sqlite_master WHERE type='trigger'"
        )
        .get();
      assert.ok(triggers);
      assert.equal(
        triggers.count,
        8,
        `expected 8 triggers (2 events + 4 FTS sync + 2 FTS update), got ${triggers.count}`
      );
    } finally {
      handle.close();
    }
  });

  test('test 3: file-based db survives close + reopen', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fartola-migrate-test-'));
    const dbPath = path.join(dir, `${crypto.randomUUID()}.db`);
    try {
      const h1 = openDatabase(dbPath);
      const beforeCount = h1.sqlite
        .prepare<unknown[], CountRow>('SELECT count(*) as count FROM __drizzle_migrations')
        .get();
      assert.equal(beforeCount?.count, EXPECTED_MIGRATION_COUNT);
      h1.close();

      const h2 = openDatabase(dbPath);
      try {
        const afterCount = h2.sqlite
          .prepare<unknown[], CountRow>('SELECT count(*) as count FROM __drizzle_migrations')
          .get();
        assert.equal(
          afterCount?.count,
          EXPECTED_MIGRATION_COUNT,
          'reopening must NOT replay migrations (idempotent on disk)'
        );
        const triggers = h2.sqlite
          .prepare<unknown[], CountRow>(
            "SELECT count(*) as count FROM sqlite_master WHERE type='trigger'"
          )
          .get();
        assert.equal(triggers?.count, 8, 'triggers persist across reopen');
      } finally {
        h2.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('test 4 (REQ-OPS-002): node_id is stable across openDatabase close/reopen cycles', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fartola-nodeid-test-'));
    const dbPath = path.join(dir, `${crypto.randomUUID()}.db`);
    try {
      const h1 = openDatabase(dbPath);
      const id1 = ensureNodeId(h1);
      h1.close();
      assert.match(id1, UUID_V4, `expected UUIDv4, got ${id1}`);

      const h2 = openDatabase(dbPath);
      try {
        const id2 = ensureNodeId(h2);
        assert.equal(id2, id1, 'node_id must be stable across restart');
      } finally {
        h2.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('test 6 (02-09 task 1): 0003 swaps UNIQUE idx_eventor_si_card for plain idx_eventor_si_card_lookup', () => {
    interface IndexRow {
      name: string;
      unique: number;
    }
    const handle = openDatabase(':memory:');
    try {
      const indexes = handle.sqlite
        .prepare<unknown[], IndexRow>(
          "SELECT name, [unique] FROM pragma_index_list('eventor_competitors')"
        )
        .all();
      const names = new Set(indexes.map((r) => r.name));
      assert.ok(
        names.has('idx_eventor_si_card_lookup'),
        `expected idx_eventor_si_card_lookup present, got: ${[...names].join(', ')}`
      );
      assert.ok(
        !names.has('idx_eventor_si_card'),
        `expected old UNIQUE idx_eventor_si_card to be DROPPED, still present in: ${[...names].join(', ')}`
      );
      const lookup = indexes.find((r) => r.name === 'idx_eventor_si_card_lookup');
      assert.equal(lookup?.unique, 0, 'idx_eventor_si_card_lookup must NOT be unique');
    } finally {
      handle.close();
    }
  });

  test('test 7 (02.1-14 Task 1): local ms-since-midnight start times become epoch on reopen', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fartola-starttime-test-'));
    const dbPath = path.join(dir, `${crypto.randomUUID()}.db`);
    const epoch = localToEpochMs('2026-10-03', 11 * 3600);
    try {
      const h1 = openDatabase(dbPath);
      // Seed rows written by the old lottning route (local ms since midnight).
      h1.sqlite.exec(`
        INSERT INTO competitions (id, name, date, created_at_ms) VALUES ('comp', 'C', '2026-10-03', 0);
        INSERT INTO classes (id, competition_id, name, first_start_ms) VALUES ('cls', 'comp', 'H21', 36000000);
        INSERT INTO competitors (id, competition_id, name, class_id, start_time_ms) VALUES
          ('a', 'comp', 'A', 'cls', 36000000),
          ('b', 'comp', 'B', 'cls', ${epoch}),
          ('c', 'comp', 'C', 'cls', NULL);
      `);
      h1.close();

      for (let i = 0; i < 2; i++) {
        // Twice: the conversion must be idempotent across restarts.
        const h = openDatabase(dbPath);
        try {
          const rows = h.sqlite
            .prepare<unknown[], { id: string; start_time_ms: number | null }>(
              'SELECT id, start_time_ms FROM competitors ORDER BY id'
            )
            .all();
          assert.deepEqual(rows, [
            { id: 'a', start_time_ms: localToEpochMs('2026-10-03', 10 * 3600) },
            { id: 'b', start_time_ms: epoch },
            { id: 'c', start_time_ms: null },
          ]);
          const cls = h.sqlite
            .prepare<unknown[], { first_start_ms: number }>('SELECT first_start_ms FROM classes')
            .get();
          assert.equal(cls?.first_start_ms, localToEpochMs('2026-10-03', 10 * 3600));
        } finally {
          h.close();
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('legacy start times past midnight (23:59 + 2 min) roll over to the next day', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fartola-starttime-test-'));
    const dbPath = path.join(dir, `${crypto.randomUUID()}.db`);
    try {
      const h1 = openDatabase(dbPath);
      // A draw from 23:59 with a 2-minute interval: 86 340 000, 86 460 000.
      h1.sqlite.exec(`
        INSERT INTO competitions (id, name, date, created_at_ms) VALUES ('comp', 'C', '2026-10-03', 0);
        INSERT INTO classes (id, competition_id, name, first_start_ms) VALUES ('cls', 'comp', 'H21', 86340000);
        INSERT INTO competitors (id, competition_id, name, class_id, start_time_ms) VALUES
          ('a', 'comp', 'A', 'cls', 86340000),
          ('b', 'comp', 'B', 'cls', 86460000);
      `);
      h1.close();

      for (let i = 0; i < 2; i++) {
        // Twice: still idempotent across restarts.
        const h = openDatabase(dbPath);
        try {
          const rows = h.sqlite
            .prepare<unknown[], { id: string; start_time_ms: number }>(
              'SELECT id, start_time_ms FROM competitors ORDER BY id'
            )
            .all();
          assert.deepEqual(rows, [
            { id: 'a', start_time_ms: localToEpochMs('2026-10-03', 23 * 3600 + 59 * 60) },
            { id: 'b', start_time_ms: localToEpochMs('2026-10-04', 60) },
          ]);
        } finally {
          h.close();
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('test 8 (02.1-14): a db stopped at 0009 gets 0010 event_codes on upgrade', () => {
    // 0010 used to carry a journal `when` older than 0009's. drizzle only
    // applies migrations newer than the newest applied created_at, so a db
    // migrated up to 0009 silently skipped 0010 and never got event_codes.
    const sqlite = new Database(':memory:');
    try {
      migrateWithOldJournal(sqlite, (entries) => entries.filter((e) => e.idx <= 9));
      assert.equal(hasTable(sqlite, 'event_codes'), false, 'precondition: stopped at 0009');

      runMigrations(sqlite);
      assert.equal(hasTable(sqlite, 'event_codes'), true, '0010 must apply after 0009');
      const count = sqlite
        .prepare<unknown[], CountRow>('SELECT count(*) as count FROM __drizzle_migrations')
        .get();
      assert.equal(count?.count, EXPECTED_MIGRATION_COUNT);

      // Fully migrated: rerunning is a no-op.
      assert.doesNotThrow(() => runMigrations(sqlite));
      assert.equal(
        sqlite
          .prepare<unknown[], CountRow>('SELECT count(*) as count FROM __drizzle_migrations')
          .get()?.count,
        EXPECTED_MIGRATION_COUNT
      );
    } finally {
      sqlite.close();
    }
  });

  test('test 9 (02.1-14): a db that applied 0010 under its old timestamp upgrades cleanly', () => {
    // A fresh db built from the old journal applied 0010 (fresh dbs apply
    // everything), but its newest created_at is 0009's, so the re-dated 0010
    // runs again on upgrade. It must be idempotent.
    const sqlite = new Database(':memory:');
    try {
      migrateWithOldJournal(sqlite, (entries) =>
        entries
          .filter((e) => e.idx <= 10)
          .map((e) => (e.idx === 10 ? { ...e, when: 1748127600000 } : e))
      );
      assert.equal(hasTable(sqlite, 'event_codes'), true, 'precondition: 0010 applied');

      assert.doesNotThrow(() => runMigrations(sqlite));
      assert.equal(hasTable(sqlite, 'event_codes'), true);
      const courseId = sqlite
        .prepare("SELECT 1 FROM pragma_table_info('classes') WHERE name = 'course_id'")
        .get();
      assert.ok(courseId, '0011 applied after the re-dated 0010');
    } finally {
      sqlite.close();
    }
  });

  test('test 10 (02.1-14 Task 14): 0014 maps ignore_start_punch to start_method', () => {
    const sqlite = new Database(':memory:');
    try {
      migrateWithOldJournal(sqlite, (entries) => entries.filter((e) => e.idx <= 13));
      sqlite.exec(`
        INSERT INTO competitions (id, name, date, created_at_ms) VALUES ('comp', 'C', '2026-10-03', 0);
        INSERT INTO classes (id, competition_id, name, ignore_start_punch) VALUES
          ('ign', 'comp', 'D10', 1),
          ('pun', 'comp', 'H10', 0);
      `);

      runMigrations(sqlite);
      const rows = sqlite
        .prepare<unknown[], { id: string; start_method: string }>(
          'SELECT id, start_method FROM classes ORDER BY id'
        )
        .all();
      assert.deepEqual(rows, [
        { id: 'ign', start_method: 'start_time' },
        { id: 'pun', start_method: 'auto' },
      ]);
      const old = sqlite
        .prepare("SELECT 1 FROM pragma_table_info('classes') WHERE name = 'ignore_start_punch'")
        .get();
      assert.equal(old, undefined, 'ignore_start_punch dropped');
    } finally {
      sqlite.close();
    }
  });

  // ADR-0017: 0018 moves stored starts from the old civil clock (and the
  // 0015 start_wall_ms override) onto the fixed-offset clock, keeping the
  // station time scoring used, and drops start_wall_ms.
  test('0018 keeps every running time: starts move onto the fixed clock', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fartola-clock-test-'));
    const dbPath = path.join(dir, `${crypto.randomUUID()}.db`);
    const SPRING = '2026-03-29'; // default offset +120 (CEST at noon)
    try {
      const old = new Database(dbPath);
      migrateWithOldJournal(old, (entries) => entries.filter((e) => e.idx <= 17));
      // a: missing start set as station time 02:00:54 in the skipped hour —
      //    epoch 01:00:54Z (reads back as civil 03:00:54) + the wall value.
      // b: an ordinary drawn start at civil 01:50 CET (00:50Z).
      // c: a start_wall_ms made stale by a later writer of start_time_ms.
      old.exec(`
        INSERT INTO competitions (id, name, date, created_at_ms, race_started_at_ms)
          VALUES ('comp', 'Natt', '${SPRING}', 0, 0);
        INSERT INTO classes (id, competition_id, name, first_start_ms)
          VALUES ('cls', 'comp', 'H21', ${Date.parse('2026-03-29T00:50:00Z')});
        INSERT INTO competitors (id, competition_id, name, class_id, card_number, start_time_ms, start_wall_ms) VALUES
          ('a', 'comp', 'A', 'cls', 1, ${Date.parse('2026-03-29T01:00:54Z')}, ${Date.parse('2026-03-29T02:00:54Z')}),
          ('b', 'comp', 'B', 'cls', 2, ${Date.parse('2026-03-29T00:50:00Z')}, NULL),
          ('c', 'comp', 'C', 'cls', 3, ${Date.parse('2026-03-29T00:50:00Z')}, ${Date.parse('2026-03-29T02:00:54Z')});
      `);
      old.close();

      for (let i = 0; i < 2; i++) {
        // Twice: the step runs once (the dropped column is its marker).
        const h = openDatabase(dbPath);
        try {
          const column = h.sqlite
            .prepare("SELECT 1 FROM pragma_table_info('competitors') WHERE name = 'start_wall_ms'")
            .get();
          assert.equal(column, undefined, 'start_wall_ms dropped');
          const start = (id: string): string => {
            const row = h.sqlite
              .prepare<[string], { ms: number }>(
                'SELECT start_time_ms AS ms FROM competitors WHERE id = ?'
              )
              .get(id)!;
            return formatClockTime(row.ms, 120);
          };
          assert.equal(start('a'), '02:00:54');
          assert.equal(start('b'), '01:50:00');
          assert.equal(start('c'), '01:50:00', 'a stale start_wall_ms does not count');
          const first = h.sqlite
            .prepare<[], { ms: number }>('SELECT first_start_ms AS ms FROM classes')
            .get()!;
          assert.equal(formatClockTime(first.ms, 120), '01:50:00');
        } finally {
          h.close();
        }
      }

      // The running times scoring gave before the migration.
      const h = openDatabase(dbPath);
      try {
        const nodeId = ensureNodeId(h);
        const read = (seq: number, card: number, finish: number, readIso: string): void => {
          const at = Date.parse(readIso);
          h.db
            .insert(events)
            .values({
              nodeId,
              localSeq: seq,
              competitionId: 'comp',
              eventType: 'card_read',
              eventTimeMs: at,
              recordedAtMs: at,
              payload: {
                event_type: 'card_read',
                card_number: card,
                card_type: 'SI10',
                start: null,
                finish: { seconds_in_half_day: finish, half_day: 0, weekday: null },
                check: null,
                clear: null,
                punch_count: 0,
                punches: [],
                card_holder: null,
              },
            })
            .run();
        };
        read(1, 1, 2 * 3600 + 30 * 60, '2026-03-29T01:35:00Z'); // finish 02:30, read 03:35 CEST
        read(2, 2, 3 * 3600 + 10 * 60, '2026-03-29T01:20:00Z'); // finish 03:10, read 03:20 CEST
        const state = reduce(loadCompetitionInputs(h, 'comp')!);
        assert.equal(state.competitors.get('a')!.elapsed_time_ms, (29 * 60 + 6) * 1000);
        assert.equal(state.competitors.get('b')!.elapsed_time_ms, 80 * 60 * 1000);
      } finally {
        h.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('test 5: ensureNodeId is idempotent within a single handle', () => {
    const handle = openDatabase(':memory:');
    try {
      const id1 = ensureNodeId(handle);
      const id2 = ensureNodeId(handle);
      assert.equal(id1, id2, 'second call must return the same UUID');
      assert.match(id1, UUID_V4);
    } finally {
      handle.close();
    }
  });
});
