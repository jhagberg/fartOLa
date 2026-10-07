// Authored for fartola. Not ported from upstream.
//
// MeOS SQL dump replay harness tests.
//
// Synthetic fixture: 2 classes, 5 runners, known punch sequences. Validates
// that importMeosDump + replayCardReads + validateResults form a working
// pipeline end-to-end.
//
// Real MeOS dump test (4-klubbs 2026-05-20) is gated on file existence:
// test.skip(!existsSync(dumpPath)) so CI does not fail when the dump is
// not present (T-02.1-28: dump may contain PII, gitignored).
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-13-PLAN.md task 2

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { openDatabase } from '../db/index.ts';
import type { DbHandle } from '../db/index.ts';
import {
  competitions,
  controls as controlsTable,
  courses as coursesTable,
  courseControls as courseControlsTable,
} from '../db/schema.ts';
import { importMeosDump, replayCardReads, validateResults } from './meosReplay.ts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface Ctx {
  handle: DbHandle;
  tmpDir: string;
  competitionId: string;
}

async function boot(): Promise<Ctx> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'meos-replay-'));
  const handle = openDatabase(':memory:');
  const competitionId = randomUUID();
  handle.db
    .insert(competitions)
    .values({
      id: competitionId,
      name: 'Test MeOS Replay Competition',
      date: '2026-05-24',
      receiptTemplate: 'classic',
      autoPrint: false,
      createdAtMs: Date.now(),
      // Set race_started_at_ms to 0 (epoch) so all replayed card reads score
      // through the reducer's race-phase gate. Without this, the reducer treats
      // all card reads as pre-race identity scans (status stays PEND).
      raceStartedAtMs: 0,
    })
    .run();
  return { handle, tmpDir, competitionId };
}

function cleanup(ctx: Ctx): void {
  ctx.handle.close();
  rmSync(ctx.tmpDir, { recursive: true, force: true });
}

/** Build a minimal MeOS SQL dump fixture with the given classes and runners. */
function buildMeosDump(
  classes: Array<{ id: number; name: string }>,
  runners: Array<{
    id: number;
    name: string;
    club: string;
    classId: number;
    card: number;
    startTimeSec: number;
  }>,
  cards: Array<{
    id: number;
    cardNo: number;
    startSec: number | null;
    finishSec: number | null;
    /** Punches as "code:sec;code:sec" format */
    punches: string;
  }>
): string {
  const classRows = classes.map((c) => `(${c.id},'${c.name}',0)`).join(',\n');
  const runnerRows = runners
    .map((r) => `(${r.id},'${r.name}','${r.club}',${r.classId},${r.card},${r.startTimeSec},0,'')`)
    .join(',\n');
  const cardRows = cards
    .map((c) => `(${c.id},${c.cardNo},0,0,${c.finishSec ?? 0},0,${c.startSec ?? 0},'${c.punches}')`)
    .join(',\n');

  return [
    '-- MeOS SQL dump fixture',
    '',
    `INSERT INTO \`oClass\` (\`Id\`,\`Name\`,\`OrderId\`) VALUES`,
    classRows + ';',
    '',
    `INSERT INTO \`oRunner\` (\`Id\`,\`Name\`,\`Club\`,\`Class\`,\`Card\`,\`StartTime\`,\`Status\`,\`Bib\`) VALUES`,
    runnerRows + ';',
    '',
    `INSERT INTO \`oCard\` (\`Id\`,\`CardNo\`,\`ReadId\`,\`ControlTime\`,\`FinishTime\`,\`CheckTime\`,\`StartTime\`,\`Punches\`) VALUES`,
    cardRows + ';',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Synthetic fixture tests
// ---------------------------------------------------------------------------

describe('meosReplay — importMeosDump', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(() => cleanup(ctx));

  test('imports classes from oClass table', () => {
    const dump = buildMeosDump(
      [
        { id: 1, name: 'H21' },
        { id: 2, name: 'D21' },
      ],
      [],
      []
    );
    const dumpFile = join(ctx.tmpDir, 'dump.sql');
    writeFileSync(dumpFile, dump);

    const data = importMeosDump(dumpFile, ctx.handle, ctx.competitionId);
    assert.equal(data.classes.length, 2);
    assert.equal(data.classes[0]!.name, 'H21');
    assert.equal(data.classes[1]!.name, 'D21');
    assert.equal(data.classIdMap.size, 2);
    // Both classes should have fartOLa IDs
    assert.ok(data.classIdMap.get(1));
    assert.ok(data.classIdMap.get(2));
  });

  test('imports runners from oRunner table with card numbers', () => {
    const dump = buildMeosDump(
      [{ id: 1, name: 'H21' }],
      [
        {
          id: 1,
          name: 'Anna Svensson',
          club: 'OK Räven',
          classId: 1,
          card: 12345,
          startTimeSec: 36600,
        },
        {
          id: 2,
          name: 'Bo Karlsson',
          club: 'FK Mora',
          classId: 1,
          card: 67890,
          startTimeSec: 36660,
        },
      ],
      []
    );
    const dumpFile = join(ctx.tmpDir, 'dump.sql');
    writeFileSync(dumpFile, dump);

    const data = importMeosDump(dumpFile, ctx.handle, ctx.competitionId);
    assert.equal(data.runners.length, 2);
    assert.equal(data.runners[0]!.name, 'Anna Svensson');
    assert.equal(data.runners[0]!.cardNumber, 12345);
    assert.equal(data.runners[1]!.name, 'Bo Karlsson');
    assert.equal(data.runnerIdMap.size, 2);
  });

  test('imports card reads from oCard table', () => {
    const dump = buildMeosDump(
      [{ id: 1, name: 'H21' }],
      [{ id: 1, name: 'Anna', club: 'OK', classId: 1, card: 12345, startTimeSec: 36600 }],
      [
        {
          id: 1,
          cardNo: 12345,
          startSec: 36600, // 10:10:00
          finishSec: 37200, // 10:20:00 (10 min elapsed)
          punches: '31:36660;32:36720;33:36780;34:36840',
        },
      ]
    );
    const dumpFile = join(ctx.tmpDir, 'dump.sql');
    writeFileSync(dumpFile, dump);

    const data = importMeosDump(dumpFile, ctx.handle, ctx.competitionId);
    assert.equal(data.cardReads.length, 1);
    const read = data.cardReads[0]!;
    assert.equal(read.cardNumber, 12345);
    assert.equal(read.punches.length, 4);
    assert.equal(read.punches[0]!.code, 31);
    assert.equal(read.startSec, 36600);
    assert.equal(read.finishSec, 37200);
  });
});

describe('meosReplay — replayCardReads + validateResults', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await boot();
  });
  afterEach(() => cleanup(ctx));

  test('synthetic pipeline: 2 runners, known results — all match', () => {
    // Course: controls 31, 32, 33, 34 → 4 controls
    // Anna: finishes OK (all 4 controls, start+finish present)
    // Bo: finishes MP (only 3 controls — missing 33)
    const dump = buildMeosDump(
      [{ id: 1, name: 'H21' }],
      [
        { id: 1, name: 'Anna', club: 'OK', classId: 1, card: 1001, startTimeSec: 36000 },
        { id: 2, name: 'Bo', club: 'OK', classId: 1, card: 1002, startTimeSec: 36000 },
      ],
      [
        {
          id: 1,
          cardNo: 1001,
          startSec: 36000, // 10:00:00
          finishSec: 36600, // 10:10:00 (600s = 10 min)
          punches: '31:36060;32:36120;33:36180;34:36240',
        },
        {
          id: 2,
          cardNo: 1002,
          startSec: 36000, // 10:00:00
          finishSec: 36600, // 10:10:00
          punches: '31:36060;32:36120;34:36240', // missing 33
        },
      ]
    );
    const dumpFile = join(ctx.tmpDir, 'dump.sql');
    writeFileSync(dumpFile, dump);

    const data = importMeosDump(dumpFile, ctx.handle, ctx.competitionId);

    // Add course + controls to fartOLa for the projection to use (needed for
    // OK/MP detection). We must insert the course after class import.
    const { handle, competitionId } = ctx;
    const classId = data.classIdMap.get(1)!;
    assert.ok(classId, 'Class 1 should be in classIdMap');

    const courseId = randomUUID();
    handle.db
      .insert(coursesTable)
      .values({
        id: courseId,
        competitionId,
        name: 'H21-course',
        classId,
      })
      .run();

    // Insert 4 control codes
    const controlCodes = [31, 32, 33, 34];
    for (let i = 0; i < controlCodes.length; i++) {
      const controlId = randomUUID();
      handle.db
        .insert(controlsTable)
        .values({
          id: controlId,
          competitionId,
          code: controlCodes[i]!,
        })
        .run();
      handle.db
        .insert(courseControlsTable)
        .values({
          id: randomUUID(),
          courseId,
          controlId,
          orderIdx: i,
        })
        .run();
    }

    // Replay card reads as events
    replayCardReads(data, handle, competitionId);

    // Validate results
    // Bo has MP + elapsed because he HAS a finish punch (just wrong controls).
    // detectStatus: finish present → elapsed computed; missing control 33 → MP.
    const result = validateResults(handle, competitionId, [
      { cardNumber: 1001, status: 'OK', elapsedMs: 600_000 },
      { cardNumber: 1002, status: 'MP', elapsedMs: 600_000, missingCodes: [33] },
    ]);

    assert.equal(
      result.mismatches.length,
      0,
      `Unexpected mismatches: ${JSON.stringify(result.mismatches)}`
    );
    assert.equal(result.matches, 2);
  });

  test('validateResults handles unknown card (PEND)', () => {
    const dump = buildMeosDump(
      [{ id: 1, name: 'H21' }],
      [{ id: 1, name: 'Anna', club: 'OK', classId: 1, card: 1001, startTimeSec: 36000 }],
      [] // no card reads
    );
    const dumpFile = join(ctx.tmpDir, 'dump.sql');
    writeFileSync(dumpFile, dump);

    const data = importMeosDump(dumpFile, ctx.handle, ctx.competitionId);
    replayCardReads(data, ctx.handle, ctx.competitionId);

    const result = validateResults(ctx.handle, ctx.competitionId, [
      { cardNumber: 1001, status: 'PEND', elapsedMs: null },
    ]);

    assert.equal(result.matches, 1);
    assert.equal(result.mismatches.length, 0);
  });

  test('validateResults returns mismatches for wrong status', () => {
    const dump = buildMeosDump(
      [{ id: 1, name: 'H21' }],
      [{ id: 1, name: 'Anna', club: 'OK', classId: 1, card: 1001, startTimeSec: 36000 }],
      [
        {
          id: 1,
          cardNo: 1001,
          startSec: 36000,
          finishSec: null, // no finish → DNF
          punches: '31:36060;32:36120',
        },
      ]
    );
    const dumpFile = join(ctx.tmpDir, 'dump.sql');
    writeFileSync(dumpFile, dump);

    const data = importMeosDump(dumpFile, ctx.handle, ctx.competitionId);
    replayCardReads(data, ctx.handle, ctx.competitionId);

    // Expect OK but actual is DNF (no finish punch)
    const result = validateResults(ctx.handle, ctx.competitionId, [
      { cardNumber: 1001, status: 'OK', elapsedMs: 600_000 },
    ]);

    assert.equal(result.matches, 0);
    assert.equal(result.mismatches.length, 1);
    assert.equal(result.mismatches[0]!.actual.status, 'DNF');
  });
});

// ---------------------------------------------------------------------------
// Real MeOS dump test — gated on file existence (PII-bearing dumps gitignored)
// ---------------------------------------------------------------------------

describe('meosReplay — real MeOS dump (4-klubbs 2026-05-20)', () => {
  // Dump path: Jonas provides the 4-klubbs dump at this location.
  // The file is gitignored per T-02.1-28 (may contain PII).
  const DUMP_PATH = join(
    import.meta.dirname ?? process.cwd(),
    '..',
    '..',
    '..',
    'test-fixtures',
    'meos-4klubbs-2026-05-20.sql'
  );

  test(
    'real dump imports and validates without crash',
    { skip: !existsSync(DUMP_PATH) },
    async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'meos-real-'));
      const handle = openDatabase(':memory:');
      const competitionId = randomUUID();
      try {
        handle.db
          .insert(competitions)
          .values({
            id: competitionId,
            name: '4-klubbs 2026-05-20 (MeOS replay)',
            date: '2026-05-20',
            receiptTemplate: 'classic',
            autoPrint: false,
            createdAtMs: Date.now(),
            raceStartedAtMs: 0,
          })
          .run();

        const data = importMeosDump(DUMP_PATH, handle, competitionId);
        assert.ok(data.classes.length > 0, 'Should import at least one class');
        assert.ok(data.runners.length > 0, 'Should import at least one runner');

        replayCardReads(data, handle, competitionId);

        // Smoke validation: at least some runners should have PEND status
        // (no expected results known ahead of time for real dump)
        const result = validateResults(handle, competitionId, []);
        assert.equal(result.matches, 0); // no expected → no matches
        assert.equal(result.mismatches.length, 0); // no expected → no mismatches
      } finally {
        handle.close();
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  );
});
