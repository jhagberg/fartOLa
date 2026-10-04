// Authored for fartola. Not ported from upstream.
//
// node:test coverage for ingestEntryList. Covers:
//   - test 1: 2 classes + 3 competitors with 1 missing class → 2 competitors
//     created, missing class recorded.
//   - test 2: duplicate card_number → silently skipped (D-11 partial unique
//     index handled gracefully).
//   - test 3 (C-M4): every imported competitor row has
//     consent_status='pending_first_read' AND consent_at_ms=null. The
//     consentAtMs parameter passed to the function is IGNORED for EntryList
//     imports per the locked contract.
//   - test 4: EntryList against a competition with NO classes throws (the
//     entrylist_without_courses path the from-wizard endpoint catches).
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-05-PLAN.md task 2
// - .planning/phases/01-single-laptop-training-mvp/01-REVIEWS.md §C-M4

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';

import { openDatabase } from '../db/index.ts';
import type { DbHandle } from '../db/index.ts';
import { classes, competitions, competitors, clubs } from '../db/schema.ts';
import { ingestEntryList } from './entryImport.ts';
import type { ParsedEntryList } from '../xml/parse.ts';

interface Ctx {
  handle: DbHandle;
  competitionId: string;
  h21Id: string;
  d21Id: string;
}

function bootCtx(opts: { seedClasses?: boolean } = {}): Ctx {
  const handle = openDatabase(':memory:');
  const competitionId = crypto.randomUUID();
  handle.db
    .insert(competitions)
    .values({
      id: competitionId,
      name: 'Entry Test',
      date: '2026-05-14',
      receiptTemplate: 'classic',
      autoPrint: false,
      createdAtMs: Date.now(),
    })
    .run();
  let h21Id = '';
  let d21Id = '';
  if (opts.seedClasses !== false) {
    h21Id = crypto.randomUUID();
    d21Id = crypto.randomUUID();
    handle.db
      .insert(classes)
      .values([
        { id: h21Id, competitionId, name: 'H21', shortName: null },
        { id: d21Id, competitionId, name: 'D21', shortName: null },
      ])
      .run();
  }
  return { handle, competitionId, h21Id, d21Id };
}

const SAMPLE: ParsedEntryList = {
  kind: 'EntryList',
  event_name: 'StorTuna Tisdag',
  competitors: [
    { name: 'Anna Andersson', club: 'StorTuna OK', class_name: 'H21', card_number: 7501853 },
    { name: 'Bo Berg', club: 'StorTuna OK', class_name: 'H21', card_number: null },
    { name: 'Cia Carlsson', club: null, class_name: 'D21', card_number: 1428824 },
  ],
};

describe('ingestEntryList', () => {
  test('test 1: 3 competitors → 3 created when all classes exist', () => {
    const ctx = bootCtx();
    try {
      const result = ingestEntryList(ctx.handle, ctx.competitionId, SAMPLE, Date.now());
      assert.equal(result.competitors_created, 3);
      assert.deepEqual(result.classes_missing, []);
      const rows = ctx.handle.db
        .select()
        .from(competitors)
        .where(eq(competitors.competitionId, ctx.competitionId))
        .all();
      assert.equal(rows.length, 3);
      // Verify class assignments.
      const anna = rows.find((r) => r.name === 'Anna Andersson');
      assert.ok(anna);
      assert.equal(anna.classId, ctx.h21Id);
      assert.equal(anna.cardNumber, 7501853);
      const cia = rows.find((r) => r.name === 'Cia Carlsson');
      assert.ok(cia);
      assert.equal(cia.classId, ctx.d21Id);
      assert.equal(cia.club, null);
      // Clubs upserted.
      const clubRows = ctx.handle.db.select().from(clubs).all();
      const clubNames = clubRows.map((r) => r.name).sort();
      assert.deepEqual(clubNames, ['StorTuna OK']);
    } finally {
      ctx.handle.close();
    }
  });

  test('test 2: missing class names recorded, partial import succeeds', () => {
    const ctx = bootCtx();
    try {
      const withMissing: ParsedEntryList = {
        ...SAMPLE,
        competitors: [
          ...SAMPLE.competitors,
          { name: 'Dan Doe', club: null, class_name: 'NOSUCH', card_number: 999 },
        ],
      };
      const result = ingestEntryList(ctx.handle, ctx.competitionId, withMissing, Date.now());
      assert.equal(result.competitors_created, 3);
      assert.deepEqual(result.classes_missing, ['NOSUCH']);
      const rows = ctx.handle.db
        .select()
        .from(competitors)
        .where(eq(competitors.competitionId, ctx.competitionId))
        .all();
      assert.equal(rows.length, 3);
      // Dan not in DB.
      const dan = rows.find((r) => r.name === 'Dan Doe');
      assert.equal(dan, undefined);
    } finally {
      ctx.handle.close();
    }
  });

  test('test 3: duplicate card_number silently skipped', () => {
    const ctx = bootCtx();
    try {
      // First import.
      ingestEntryList(ctx.handle, ctx.competitionId, SAMPLE, Date.now());
      // Second import: same card 7501853 again.
      const dup: ParsedEntryList = {
        kind: 'EntryList',
        event_name: 'dup',
        competitors: [{ name: 'Anna Twin', club: 'X', class_name: 'H21', card_number: 7501853 }],
      };
      const result = ingestEntryList(ctx.handle, ctx.competitionId, dup, Date.now());
      assert.equal(result.competitors_created, 0);
      // Still 3 rows total.
      const rows = ctx.handle.db
        .select()
        .from(competitors)
        .where(eq(competitors.competitionId, ctx.competitionId))
        .all();
      assert.equal(rows.length, 3);
    } finally {
      ctx.handle.close();
    }
  });

  test('test 4 (C-M4): consent_status="pending_first_read" AND consent_at_ms=null on every row; consentAtMs param ignored', () => {
    const ctx = bootCtx();
    try {
      // Pass a non-null consentAtMs to prove it's ignored.
      ingestEntryList(ctx.handle, ctx.competitionId, SAMPLE, 999999);
      const rows = ctx.handle.db
        .select()
        .from(competitors)
        .where(eq(competitors.competitionId, ctx.competitionId))
        .all();
      assert.equal(rows.length, 3);
      for (const row of rows) {
        assert.equal(
          row.consentStatus,
          'pending_first_read',
          `competitor ${row.name} consent_status should be pending_first_read, got ${row.consentStatus}`
        );
        assert.equal(
          row.consentAtMs,
          null,
          `competitor ${row.name} consent_at_ms should be null, got ${row.consentAtMs}`
        );
      }
    } finally {
      ctx.handle.close();
    }
  });

  test('test 5 (entrylist_without_courses): no classes seeded → throws', () => {
    const ctx = bootCtx({ seedClasses: false });
    try {
      assert.throws(
        () => ingestEntryList(ctx.handle, ctx.competitionId, SAMPLE, Date.now()),
        /upload CourseData first/
      );
      // No rows committed (transaction rolled back).
      const rows = ctx.handle.db
        .select()
        .from(competitors)
        .where(eq(competitors.competitionId, ctx.competitionId))
        .all();
      assert.equal(rows.length, 0);
    } finally {
      ctx.handle.close();
    }
  });

  test('test 6 (02.1-14 Task 6): skipped rows are reported with row + reason', () => {
    const ctx = bootCtx();
    try {
      const data: ParsedEntryList = {
        kind: 'EntryList',
        event_name: 'skips',
        competitors: [
          { name: 'Anna Andersson', club: 'X', class_name: 'H21', card_number: 7501853 },
          { name: 'Dag Ek', club: 'X', class_name: 'H99', card_number: 1 },
          { name: 'Eva Ek', club: 'X', class_name: 'H21', card_number: 7501853 },
          { name: 'Fia Fors', club: null, class_name: 'D21', card_number: null },
        ],
      };
      const result = ingestEntryList(ctx.handle, ctx.competitionId, data, Date.now());
      assert.equal(result.competitors_created, 2);
      assert.deepEqual(result.skipped, [
        { row: 2, name: 'Dag Ek', class: 'H99', card: 1, reason: 'unknown_class' },
        { row: 3, name: 'Eva Ek', class: 'H21', card: 7501853, reason: 'duplicate_card' },
      ]);
      assert.equal(result.competitors_skipped_duplicate, 1);
      assert.equal(result.competitors_skipped_unknown_class, 1);
    } finally {
      ctx.handle.close();
    }
  });
});
