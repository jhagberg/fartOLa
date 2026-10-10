// Authored for fartola. Not ported from upstream.
//
// node:test coverage for scheduleDailyRetention. Covers:
//   - test 1 (REQ-PRIV-002 happy path): 35-day-old competition → scrub
//     anonymises name + nulls club + sets scrubbed_at_ms; card_number,
//     consent_status, consent_at_ms all UNCHANGED.
//   - test 2: 25-day-old competition (within retention window) → 0 scrubs.
//   - test 3: idempotency — already-scrubbed rows are not re-scrubbed; a
//     second runNow returns count 0.
//   - test 4: cross-competition isolation — scrubbing competition A
//     doesn't touch competition B (different date).
//   - test 5: events table is UNTOUCHED — append-only invariant survives.
//     Documents the card_holder PII tradeoff (research A7 — operator-aware).
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-17-PLAN.md task 2
// - REQ-PRIV-002

import { describe, test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { eq, count } from 'drizzle-orm';

import { openDatabase, type DbHandle } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import { competitions, classes, competitors, events, hiredCards } from '../db/schema.ts';
import { insertEvent } from '../si/eventInserter.ts';
import { scheduleDailyRetention, formatLocalDate } from './retention.ts';

interface Ctx {
  handle: DbHandle;
  nodeId: string;
}

function setupCtx(): Ctx {
  const handle = openDatabase(':memory:');
  const nodeId = ensureNodeId(handle);
  return { handle, nodeId };
}

function teardownCtx(ctx: Ctx): void {
  try {
    ctx.handle.close();
  } catch {
    /* best-effort */
  }
}

/** Seed a competition + class + one competitor on the given date.
 * The returned competitor row is unscrubbed (consent_status='explicit',
 * consent_at_ms set to a known sentinel for traceability checks). */
function seedCompetition(
  ctx: Ctx,
  opts: { id: string; date: string; competitorName: string; club: string; cardNumber: number }
): { competitorId: string } {
  const now = Date.now();
  ctx.handle.db
    .insert(competitions)
    .values({ id: opts.id, name: `Comp ${opts.id}`, date: opts.date, createdAtMs: now })
    .run();
  const classId = `class-${opts.id}`;
  ctx.handle.db.insert(classes).values({ id: classId, competitionId: opts.id, name: 'H21' }).run();
  const competitorId = `competitor-${opts.id}`;
  ctx.handle.db
    .insert(competitors)
    .values({
      id: competitorId,
      competitionId: opts.id,
      name: opts.competitorName,
      club: opts.club,
      classId,
      cardNumber: opts.cardNumber,
      consentAtMs: 1_715_700_000_000, // sentinel — must survive scrub
      consentStatus: 'explicit',
      scrubbedAtMs: null,
    })
    .run();
  return { competitorId };
}

/** Seed a hired_cards row directly. Plan 02-06 D-HB-1 — compound PK
 * (competition_id, card_number); contact_* are scrub targets, marked_at_ms /
 * returned_at_ms / card_number are PRESERVED. */
function seedHiredCard(
  ctx: Ctx,
  opts: {
    competitionId: string;
    cardNumber: number;
    contactName?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    note?: string | null;
    markedAtMs?: number;
    returnedAtMs?: number | null;
  }
): void {
  ctx.handle.db
    .insert(hiredCards)
    .values({
      competitionId: opts.competitionId,
      cardNumber: opts.cardNumber,
      markedAtMs: opts.markedAtMs ?? 1_700_000_000_000,
      returnedAtMs: opts.returnedAtMs ?? null,
      contactName: opts.contactName ?? null,
      contactPhone: opts.contactPhone ?? null,
      contactEmail: opts.contactEmail ?? null,
      note: opts.note ?? null,
    })
    .run();
}

describe('scheduleDailyRetention', () => {
  let ctx: Ctx;
  // Pin "now" to 2026-05-15 12:00 UTC for deterministic cutoff_date math.
  const FIXED_NOW = new Date('2026-05-15T12:00:00.000Z').getTime();

  beforeEach(() => {
    ctx = setupCtx();
  });

  afterEach(() => {
    teardownCtx(ctx);
  });

  test('test 1 (REQ-PRIV-002): 35-day-old competition is scrubbed — name + club nulled, card_number + consent_at_ms preserved', async () => {
    // Competition dated 2026-04-10 → 35 days before 2026-05-15.
    const { competitorId } = seedCompetition(ctx, {
      id: 'comp-old',
      date: '2026-04-10',
      competitorName: 'Anna Andersson',
      club: 'StorTuna IF',
      cardNumber: 7501853,
    });
    ctx.handle.db
      .update(competitors)
      .set({ birthYear: 1980 })
      .where(eq(competitors.id, competitorId))
      .run();
    const retention = scheduleDailyRetention(ctx.handle, {
      retentionDays: 30,
      testClock: { now: () => FIXED_NOW },
    });
    try {
      const r = await retention.runNow();
      assert.equal(r.scrubbed_count, 1);
      // cutoff_date = 2026-05-15 minus 30 days = 2026-04-15.
      assert.equal(r.cutoff_date, '2026-04-15');

      const row = ctx.handle.db
        .select()
        .from(competitors)
        .where(eq(competitors.id, competitorId))
        .get();
      assert.ok(row);
      assert.equal(row.name, 'Anonymiserad');
      assert.equal(row.club, null);
      assert.equal(row.birthYear, null);
      assert.equal(row.scrubbedAtMs, FIXED_NOW);

      // PRESERVED fields (RESEARCH A7 + research.md §6).
      assert.equal(row.cardNumber, 7501853, 'card_number is a hardware ID, not PII');
      assert.equal(row.consentStatus, 'explicit', 'consent_status must persist');
      assert.equal(row.consentAtMs, 1_715_700_000_000, 'consent_at_ms must persist as audit trail');
    } finally {
      retention.stop();
    }
  });

  test('test 2: 25-day-old competition is NOT scrubbed (within retention window)', async () => {
    // Competition dated 2026-04-20 → 25 days before 2026-05-15 → still in window.
    const { competitorId } = seedCompetition(ctx, {
      id: 'comp-recent',
      date: '2026-04-20',
      competitorName: 'Bo Berg',
      club: 'OK Linné',
      cardNumber: 1428824,
    });
    const retention = scheduleDailyRetention(ctx.handle, {
      retentionDays: 30,
      testClock: { now: () => FIXED_NOW },
    });
    try {
      const r = await retention.runNow();
      assert.equal(r.scrubbed_count, 0);

      const row = ctx.handle.db
        .select()
        .from(competitors)
        .where(eq(competitors.id, competitorId))
        .get();
      assert.ok(row);
      // Unchanged.
      assert.equal(row.name, 'Bo Berg');
      assert.equal(row.club, 'OK Linné');
      assert.equal(row.scrubbedAtMs, null);
    } finally {
      retention.stop();
    }
  });

  test('test 3: already-scrubbed rows are not re-scrubbed (idempotent)', async () => {
    seedCompetition(ctx, {
      id: 'comp-old-2',
      date: '2026-03-01',
      competitorName: 'Cia Carlsson',
      club: 'IFK Lidingö',
      cardNumber: 248215,
    });
    const retention = scheduleDailyRetention(ctx.handle, {
      retentionDays: 30,
      testClock: { now: () => FIXED_NOW },
    });
    try {
      const first = await retention.runNow();
      assert.equal(first.scrubbed_count, 1, 'first run scrubs the one old row');

      const second = await retention.runNow();
      assert.equal(second.scrubbed_count, 0, 'second run finds nothing to scrub');
    } finally {
      retention.stop();
    }
  });

  test('test 4: cross-competition isolation — scrubbing A leaves B alone', async () => {
    const { competitorId: oldId } = seedCompetition(ctx, {
      id: 'comp-A-old',
      date: '2026-04-01',
      competitorName: 'Anna A',
      club: 'Club A',
      cardNumber: 100,
    });
    const { competitorId: newId } = seedCompetition(ctx, {
      id: 'comp-B-new',
      date: '2026-05-10',
      competitorName: 'Bo B',
      club: 'Club B',
      cardNumber: 200,
    });
    const retention = scheduleDailyRetention(ctx.handle, {
      retentionDays: 30,
      testClock: { now: () => FIXED_NOW },
    });
    try {
      const r = await retention.runNow();
      assert.equal(r.scrubbed_count, 1, 'only the old competition is scrubbed');

      const oldRow = ctx.handle.db
        .select()
        .from(competitors)
        .where(eq(competitors.id, oldId))
        .get();
      const newRow = ctx.handle.db
        .select()
        .from(competitors)
        .where(eq(competitors.id, newId))
        .get();
      assert.equal(oldRow?.name, 'Anonymiserad');
      assert.equal(oldRow?.club, null);
      assert.equal(newRow?.name, 'Bo B');
      assert.equal(newRow?.club, 'Club B');
    } finally {
      retention.stop();
    }
  });

  test('test 5: events table is UNTOUCHED by retention scrub (REQ-EVT-002 append-only)', async () => {
    const { competitorId } = seedCompetition(ctx, {
      id: 'comp-E',
      date: '2026-04-01',
      competitorName: 'Eva Eriksson',
      club: 'Eskilstuna OK',
      cardNumber: 1428824,
    });
    // Insert a card_bound event referencing the competitor. The bind payload
    // carries competitor_id + card_number only — not the name string — so
    // the event row's payload survives the scrub without exposing PII.
    insertEvent(
      ctx.handle,
      ctx.nodeId,
      'card_bound',
      Date.now(),
      {
        event_type: 'card_bound',
        competitor_id: competitorId,
        card_number: 1428824,
        walkup: false,
        consent_at_ms: 1_715_700_000_000,
      },
      'comp-E'
    );

    // Count events before retention runs.
    const beforeRow = ctx.handle.db.select({ c: count() }).from(events).get();
    const beforeCount = beforeRow?.c ?? 0;
    assert.equal(beforeCount, 1, 'precondition: one event row exists');

    const retention = scheduleDailyRetention(ctx.handle, {
      retentionDays: 30,
      testClock: { now: () => FIXED_NOW },
    });
    try {
      const r = await retention.runNow();
      assert.equal(r.scrubbed_count, 1);
    } finally {
      retention.stop();
    }

    // Events table count + content unchanged. (REQ-EVT-002 append-only.)
    const afterRow = ctx.handle.db.select({ c: count() }).from(events).get();
    assert.equal(afterRow?.c ?? 0, beforeCount, 'events row count must be unchanged');

    // The card_bound payload's competitor_id still resolves — competitor row
    // exists, just with anonymised PII.
    const eventRow = ctx.handle.db.select().from(events).get();
    assert.ok(eventRow);
    const payload = eventRow.payload as { event_type: string; competitor_id: string };
    assert.equal(payload.event_type, 'card_bound');
    assert.equal(payload.competitor_id, competitorId);
  });

  test('test 6 (WR-001): transient failure at midnight retries runOnce after 1h, not the next midnight', async () => {
    // Seed an old competition so a successful runOnce produces a scrub.
    seedCompetition(ctx, {
      id: 'comp-retry',
      date: '2026-03-01',
      competitorName: 'Retry Person',
      club: 'Retry IK',
      cardNumber: 999,
    });

    // Pin local clock at 2026-05-15 23:30 — 30 min to local midnight.
    const startNow = new Date(2026, 4, 15, 23, 30, 0, 0).getTime();
    let currentNow = startNow;
    const fixedClock = { now: (): number => currentNow };

    // Stub handle.db.update to throw on the first call only. Subsequent
    // calls forward to the real drizzle update chain.
    let updateCalls = 0;
    const originalUpdate = ctx.handle.db.update.bind(ctx.handle.db);
    ctx.handle.db.update = ((table: Parameters<typeof originalUpdate>[0]) => {
      updateCalls += 1;
      if (updateCalls === 1) {
        // Return a chain whose terminal .run() throws synchronously.
        const thrower = (): never => {
          throw new Error('simulated transient SQLite lock');
        };
        return {
          set: () => ({ where: () => ({ run: thrower }) }),
        } as unknown as ReturnType<typeof originalUpdate>;
      }
      return originalUpdate(table);
    }) as typeof ctx.handle.db.update;

    mock.timers.enable({ apis: ['setTimeout'] });
    const retention = scheduleDailyRetention(ctx.handle, {
      retentionDays: 30,
      testClock: fixedClock,
    });
    try {
      // Advance 30 min → local midnight. runOnce throws; retry arms 1h timer.
      currentNow += 30 * 60 * 1000;
      mock.timers.tick(30 * 60 * 1000);
      // Drain microtasks so the catch handler installs the retry timer.
      for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
      // First attempt: the thrower stub fires once on the competitors UPDATE
      // and throws — runOnce aborts before reaching the hired_cards UPDATE.
      assert.equal(updateCalls, 1, 'first attempt fired at midnight');

      // Advance 1h. The retry must invoke runOnce again (not skip a day).
      // Post-Plan-02-06: a successful runOnce makes TWO update calls
      // (competitors + hired_cards), so the cumulative counter is 1 + 2 = 3.
      currentNow += 60 * 60 * 1000;
      mock.timers.tick(60 * 60 * 1000);
      for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
      assert.equal(
        updateCalls,
        3,
        'retry ran runOnce after 1h (calls competitors + hired_cards UPDATEs); not after 24h'
      );

      // The second attempt actually scrubbed the seeded row.
      const row = ctx.handle.db
        .select()
        .from(competitors)
        .where(eq(competitors.id, 'competitor-comp-retry'))
        .get();
      assert.equal(row?.name, 'Anonymiserad', 'retry actually scrubbed the row');
    } finally {
      // Order: stop scheduler (clears pending timers) BEFORE mock.reset to
      // avoid leaking the post-success next-midnight setTimeout.
      retention.stop();
      mock.timers.reset();
      ctx.handle.db.update = originalUpdate;
    }
  });

  // ---------------------------------------------------------------------
  // Plan 02-06 — hired_cards.contact_* scrub extension (D-HB-1, REQ-PRIV-002)
  // ---------------------------------------------------------------------

  test('test P206-1: 35-day-old competition with hired_cards row → contact_phone nulled, marked_at_ms preserved', async () => {
    seedCompetition(ctx, {
      id: 'comp-old-hc',
      date: '2026-04-10',
      competitorName: 'Hired Holger',
      club: 'HC Klubb',
      cardNumber: 99,
    });
    seedHiredCard(ctx, {
      competitionId: 'comp-old-hc',
      cardNumber: 88888,
      contactName: 'Holger Holgersson',
      contactPhone: '0701234567',
      contactEmail: 'holger@example.com',
      note: 'Hyrbricka för kvällen',
      markedAtMs: 1_715_000_000_000,
    });
    const retention = scheduleDailyRetention(ctx.handle, {
      retentionDays: 30,
      testClock: { now: () => FIXED_NOW },
    });
    try {
      const r = await retention.runNow();
      // scrubbed_count includes the competitor row + the hired_cards row.
      assert.equal(r.scrubbed_count, 2);
      assert.equal(r.cutoff_date, '2026-04-15');

      const hc = ctx.handle.db
        .select()
        .from(hiredCards)
        .where(eq(hiredCards.cardNumber, 88888))
        .get();
      assert.ok(hc);
      // Scrubbed contact_*.
      assert.equal(hc.contactName, null);
      assert.equal(hc.contactPhone, null);
      assert.equal(hc.contactEmail, null);
      assert.equal(hc.note, null);
      // PRESERVED audit trail.
      assert.equal(hc.cardNumber, 88888, 'card_number is a hardware ID, not PII');
      assert.equal(hc.markedAtMs, 1_715_000_000_000, 'marked_at_ms must persist as audit trail');
      assert.equal(hc.competitionId, 'comp-old-hc');
    } finally {
      retention.stop();
    }
  });

  test('test P206-2: 25-day-old competition with hired_cards row → no scrub, contact_phone unchanged', async () => {
    seedCompetition(ctx, {
      id: 'comp-recent-hc',
      date: '2026-04-20',
      competitorName: 'Recent Renter',
      club: 'RR Klubb',
      cardNumber: 100,
    });
    seedHiredCard(ctx, {
      competitionId: 'comp-recent-hc',
      cardNumber: 12345,
      contactName: 'Renter Recent',
      contactPhone: '0709876543',
      contactEmail: 'renter@example.com',
      note: 'Within window',
    });
    const retention = scheduleDailyRetention(ctx.handle, {
      retentionDays: 30,
      testClock: { now: () => FIXED_NOW },
    });
    try {
      const r = await retention.runNow();
      // The 25-day-old competition is INSIDE the retention window — neither
      // its competitor nor its hired_cards row scrubs.
      assert.equal(r.scrubbed_count, 0);

      const hc = ctx.handle.db
        .select()
        .from(hiredCards)
        .where(eq(hiredCards.cardNumber, 12345))
        .get();
      assert.ok(hc);
      assert.equal(hc.contactName, 'Renter Recent');
      assert.equal(hc.contactPhone, '0709876543');
      assert.equal(hc.contactEmail, 'renter@example.com');
      assert.equal(hc.note, 'Within window');
    } finally {
      retention.stop();
    }
  });

  test('test P206-3: hired_cards scrub is idempotent — second runNow does not bump changes counter', async () => {
    seedCompetition(ctx, {
      id: 'comp-idempotent-hc',
      date: '2026-03-01',
      competitorName: 'Idempotent Ida',
      club: 'II Klubb',
      cardNumber: 101,
    });
    seedHiredCard(ctx, {
      competitionId: 'comp-idempotent-hc',
      cardNumber: 22222,
      contactName: 'Ida Idsson',
      contactPhone: '0701112233',
    });
    const retention = scheduleDailyRetention(ctx.handle, {
      retentionDays: 30,
      testClock: { now: () => FIXED_NOW },
    });
    try {
      const first = await retention.runNow();
      // First run: scrubs the competitor row + the hired_cards row.
      assert.equal(first.scrubbed_count, 2, 'first run scrubs both');

      const second = await retention.runNow();
      // Second run: nothing to scrub (competitors via scrubbed_at_ms guard;
      // hired_cards via the contact_* IS NOT NULL guard).
      assert.equal(second.scrubbed_count, 0, 'second run finds nothing to scrub');
    } finally {
      retention.stop();
    }
  });

  test('test P206-4: combined scrubbed_count returns competitors + hired_cards counts', async () => {
    // Two old competitions, each with a competitor + a hired card → 4 scrubs.
    seedCompetition(ctx, {
      id: 'comp-combo-A',
      date: '2026-04-01',
      competitorName: 'Combo A',
      club: 'Combo Klubb A',
      cardNumber: 200,
    });
    seedHiredCard(ctx, {
      competitionId: 'comp-combo-A',
      cardNumber: 30001,
      contactPhone: '0701000001',
    });
    seedCompetition(ctx, {
      id: 'comp-combo-B',
      date: '2026-04-02',
      competitorName: 'Combo B',
      club: 'Combo Klubb B',
      cardNumber: 201,
    });
    seedHiredCard(ctx, {
      competitionId: 'comp-combo-B',
      cardNumber: 30002,
      contactEmail: 'b@example.com',
    });
    const retention = scheduleDailyRetention(ctx.handle, {
      retentionDays: 30,
      testClock: { now: () => FIXED_NOW },
    });
    try {
      const r = await retention.runNow();
      assert.equal(r.scrubbed_count, 4, 'two competitors + two hired_cards rows');
      assert.equal(r.cutoff_date, '2026-04-15');
    } finally {
      retention.stop();
    }
  });

  test('test P206-5: hired_cards with ALL contact_* NULL are skipped (no spurious update)', async () => {
    // The competition is old, but the hired_cards row has no contact info.
    // Per the WHERE clause, that row should NOT be UPDATEd (changes counter
    // must not increase for it).
    seedCompetition(ctx, {
      id: 'comp-null-hc',
      date: '2026-03-15',
      competitorName: 'Null Nilsson',
      club: 'NN Klubb',
      cardNumber: 300,
    });
    // hired_cards row with no PII to scrub (e.g. rental never had contact info
    // captured — operator forgot to fill it).
    seedHiredCard(ctx, {
      competitionId: 'comp-null-hc',
      cardNumber: 44444,
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      note: null,
    });
    const retention = scheduleDailyRetention(ctx.handle, {
      retentionDays: 30,
      testClock: { now: () => FIXED_NOW },
    });
    try {
      const r = await retention.runNow();
      // Only the competitor row scrubs; the all-null hired_cards row skips.
      assert.equal(r.scrubbed_count, 1);

      const hc = ctx.handle.db
        .select()
        .from(hiredCards)
        .where(eq(hiredCards.cardNumber, 44444))
        .get();
      assert.ok(hc);
      // Row still exists with NULLs preserved verbatim.
      assert.equal(hc.contactName, null);
      assert.equal(hc.contactPhone, null);
      assert.equal(hc.contactEmail, null);
      assert.equal(hc.note, null);
    } finally {
      retention.stop();
    }
  });

  test('test P206-6: testClock injection — runOnce uses opts.testClock.now reference, not literal Date.now', async () => {
    // Pick a fixed clock value far in the future so the cutoff date computed
    // from it is unambiguously distinguishable from Date.now() at test time.
    const FUTURE = 9_999_999_999_999; // year ~2286
    seedCompetition(ctx, {
      id: 'comp-future-clock',
      date: '2026-05-15',
      competitorName: 'Future Frida',
      club: 'FF Klubb',
      cardNumber: 400,
    });
    seedHiredCard(ctx, {
      competitionId: 'comp-future-clock',
      cardNumber: 55555,
      contactPhone: '0701234500',
    });
    const retention = scheduleDailyRetention(ctx.handle, {
      retentionDays: 30,
      testClock: { now: () => FUTURE },
    });
    try {
      const r = await retention.runNow();
      // From the FUTURE clock's perspective, the competition (2026-05-15)
      // is ancient — both competitor + hired_cards row scrub.
      assert.equal(r.scrubbed_count, 2);
      // cutoff_date derived from FUTURE - 30 days; must be in year 2286.
      // (More important: must NOT be in 2026, which is what literal Date.now
      // would return.)
      assert.ok(
        r.cutoff_date.startsWith('228'),
        `cutoff_date should reflect the injected clock (got: ${r.cutoff_date})`
      );

      // Confirm the hired_cards row was actually scrubbed (the testClock
      // reference flowed through to the hired_cards UPDATE's WHERE clause).
      const hc = ctx.handle.db
        .select()
        .from(hiredCards)
        .where(eq(hiredCards.cardNumber, 55555))
        .get();
      assert.equal(hc?.contactPhone, null);
    } finally {
      retention.stop();
    }
  });

  test('test 7 (WR-002): formatLocalDate returns the LOCAL calendar date, not the UTC date', () => {
    // Dates constructed via LOCAL components — formatter must return the
    // same components even when toISOString() would shift the day.
    const localMidnightPlus30 = new Date(2026, 4, 16, 0, 30, 0, 0);
    assert.equal(formatLocalDate(localMidnightPlus30), '2026-05-16');

    // Zero-padding sanity check.
    const earlyJan = new Date(2026, 0, 5, 0, 0, 0, 0);
    assert.equal(formatLocalDate(earlyJan), '2026-01-05');

    // In any east-of-UTC TZ (Stockholm is +1/+2), local-midnight's UTC day
    // is the PREVIOUS calendar day. Original bug used that UTC day for the
    // retention cutoff; verify the fix returns the local day.
    const localMidnight = new Date(2026, 4, 16, 0, 0, 0, 0);
    const offsetMin = localMidnight.getTimezoneOffset();
    if (offsetMin < 0) {
      const utcDay = localMidnight.toISOString().slice(0, 10);
      assert.notEqual(utcDay, '2026-05-16', 'precondition: UTC day differs in east-of-UTC TZs');
    }
    assert.equal(formatLocalDate(localMidnight), '2026-05-16');
  });
});
