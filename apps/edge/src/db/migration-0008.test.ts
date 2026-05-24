// Authored for fartola. Not ported from upstream.
//
// TDD test for migration 0008 — SI card dedup index rename.
//
// Verifies that after applying all migrations:
//   - The old UNIQUE index `idx_eventor_si_card` does NOT exist
//   - The new plain partial index `idx_eventor_si_card_lookup` DOES exist
//   - Duplicate SI card values can be inserted without UNIQUE constraint error
//
// RED phase: before migration 0008 exists this test fails because the
// unique index from migration 0002 is still active.
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-10-PLAN.md Task 1

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './index.ts';

describe('migration 0008 — eventor si_card dedup', () => {
  test('idx_eventor_si_card unique index is removed after migration 0008', () => {
    const handle = openDatabase(':memory:');
    try {
      // Query the sqlite_master for the old unique index — must not exist.
      const oldIndex = handle.sqlite
        .prepare(
          `SELECT name, "unique" FROM pragma_index_list('eventor_competitors')
           WHERE name = 'idx_eventor_si_card'`
        )
        .get() as { name: string; unique: number } | undefined;
      assert.equal(
        oldIndex,
        undefined,
        'Old unique index idx_eventor_si_card must not exist after migration 0008'
      );
    } finally {
      handle.close();
    }
  });

  test('idx_eventor_si_card_lookup plain index exists after migration 0008', () => {
    const handle = openDatabase(':memory:');
    try {
      // The new plain (non-unique) index must exist.
      const newIndex = handle.sqlite
        .prepare(
          `SELECT name, "unique" FROM pragma_index_list('eventor_competitors')
           WHERE name = 'idx_eventor_si_card_lookup'`
        )
        .get() as { name: string; unique: number } | undefined;
      assert.ok(
        newIndex !== undefined,
        'New index idx_eventor_si_card_lookup must exist after migration 0008'
      );
      assert.equal(
        newIndex!.unique,
        0,
        'idx_eventor_si_card_lookup must be a plain (non-unique) index'
      );
    } finally {
      handle.close();
    }
  });

  test('duplicate SI card values can be inserted without constraint error', () => {
    const handle = openDatabase(':memory:');
    try {
      // Insert two Eventor competitors with the same SI card number.
      // This should NOT throw a UNIQUE constraint error after migration 0008.
      handle.sqlite
        .prepare(
          `INSERT INTO eventor_clubs (club_id, name, modify_date_ms) VALUES (1, 'Test Club', 0)`
        )
        .run();
      handle.sqlite
        .prepare(
          `INSERT INTO eventor_competitors
           (person_id, family_name, given_name, si_card, modify_date_ms)
           VALUES (1001, 'Familjen', 'Alfa', 8410001, 0)`
        )
        .run();
      // This second insert with the same si_card must succeed (no UNIQUE violation).
      assert.doesNotThrow(() => {
        handle.sqlite
          .prepare(
            `INSERT INTO eventor_competitors
             (person_id, family_name, given_name, si_card, modify_date_ms)
             VALUES (1002, 'Familjen', 'Beta', 8410001, 0)`
          )
          .run();
      }, 'Inserting a duplicate SI card must not throw a UNIQUE constraint error');

      // Confirm both rows are there.
      const rows = handle.sqlite
        .prepare(`SELECT person_id FROM eventor_competitors WHERE si_card = 8410001`)
        .all() as Array<{ person_id: number }>;
      assert.equal(rows.length, 2, 'Both competitors with shared SI card must be stored');
    } finally {
      handle.close();
    }
  });
});
