// Authored for fartola. Not ported from upstream.
//
// MeOS SQL dump replay harness (D-19).
//
// Provides three functions for high-value regression testing by replaying
// real-event data:
//
//   importMeosDump(dumpPath, handle, competitionId)
//     Reads a MeOS MySQL/SQLite SQL dump from `dumpPath` and imports:
//       - oClass rows → classes table
//       - oRunner rows → competitors table (name, club, class, SI card)
//       - oCard rows  → stored as replay data for replayCardReads()
//     Returns a MeosDumpData object with the imported IDs mapping.
//
//   replayCardReads(dumpData, handle, competitionId)
//     Replays the imported card reads through insertEvent, simulating the
//     full card_read event pipeline as if the cards were read by the bridge.
//
//   validateResults(handle, competitionId, expectedResults)
//     Runs reduce() over the competition's events + competitors, then
//     compares the projection output against the caller-supplied expected
//     results. Returns { matches: number, mismatches: [...] }.
//
// Real MeOS dump test is gated on file existence (test.skip when absent)
// so CI does not fail. Jonas can provide the 4-klubbs 2026-05-20 dump.
//
// T-02.1-28 mitigation: dump fixtures are gitignored when they contain PII.
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-13-PLAN.md task 2
// - D-19 (MeOS SQL dump replay harness)

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { reduce } from '../projection/reduce.ts';
import { loadCompetitionInputs } from '../projection/loader.ts';
import { insertEvent } from '../si/eventInserter.ts';
import type { DbHandle } from '../db/index.ts';
import { eq, and } from 'drizzle-orm';
import { classes as classesTable, competitors as competitorsTable } from '../db/schema.ts';

// ---------------------------------------------------------------------------
// MeOS table shapes (what the SQL dump parser extracts)
// ---------------------------------------------------------------------------

export interface MeosClass {
  /** MeOS oClass.Id */
  meosId: number;
  /** oClass.Name */
  name: string;
}

export interface MeosRunner {
  /** MeOS oRunner.Id */
  meosId: number;
  name: string;
  club: string;
  /** oRunner.ClassId → meosId of the class */
  classId: number;
  /** oRunner.Card — SPORTident card number */
  cardNumber: number;
  /** oRunner.StartTime in seconds (relative to race start, or 0 if not set) */
  startTimeSec: number;
}

export interface MeosCardRead {
  /** Card number this read belongs to */
  cardNumber: number;
  /** Punch timestamps in seconds since midnight (half-day clock approximation) */
  punches: Array<{ code: number; secondsInHalfDay: number }>;
  /** Start punch time in seconds since midnight (null if missing) */
  startSec: number | null;
  /** Finish punch time in seconds since midnight (null if missing) */
  finishSec: number | null;
}

export interface MeosDumpData {
  classes: MeosClass[];
  runners: MeosRunner[];
  cardReads: MeosCardRead[];
  /** Maps meosClassId → fartOLa class id */
  classIdMap: Map<number, string>;
  /** Maps meosRunnerId → fartOLa competitor id */
  runnerIdMap: Map<number, string>;
}

// ---------------------------------------------------------------------------
// Expected result shape for validateResults()
// ---------------------------------------------------------------------------

export interface MeosResult {
  /** SPORTident card number (used to match to a competitor) */
  cardNumber: number;
  /** Expected projected status */
  status: 'OK' | 'MP' | 'DNF' | 'PEND' | 'DNS' | 'DQ' | 'CANCEL' | 'MAX';
  /** Expected elapsed in milliseconds (null for DNF/PEND/etc) */
  elapsedMs: number | null;
  /** Expected missing control codes (empty for OK) */
  missingCodes?: number[];
}

export interface ValidationMismatch {
  cardNumber: number;
  expected: MeosResult;
  actual: {
    status: string;
    elapsedMs: number | null;
    missingCodes: number[];
  };
}

export interface ValidationResult {
  matches: number;
  mismatches: ValidationMismatch[];
}

// ---------------------------------------------------------------------------
// SQL dump parser — extracts rows from MeOS MySQL/SQLite dump files.
//
// Handles two forms of INSERT:
//   INSERT INTO `oClass` (`Id`,`Name`,...) VALUES (1,'H21',...);
//   INSERT INTO oClass VALUES (1,'H21',...);
//
// Single-quoted string values, numeric values, NULL. Multi-row VALUES clauses
// are also supported: VALUES (1,'a',...),(2,'b',...);
// ---------------------------------------------------------------------------

/** Parse a raw SQL value token into string | number | null. */
function parseValue(token: string): string | number | null {
  const t = token.trim();
  if (t === 'NULL' || t === 'null') return null;
  if (t.startsWith("'") && t.endsWith("'")) {
    // Unescape MySQL single-quote escaping ('' → ')
    return t.slice(1, -1).replace(/''/g, "'").replace(/\\'/g, "'");
  }
  const n = Number(t);
  return isNaN(n) ? t : n;
}

/** Split a VALUES row string into individual tokens, respecting quoted strings. */
function splitRow(row: string): (string | number | null)[] {
  const tokens: (string | number | null)[] = [];
  let i = 0;
  while (i < row.length) {
    const ch = row[i];
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    if (ch === ',') {
      i++;
      continue;
    }
    if (ch === "'") {
      // String token — find closing quote (handling '' and \' escapes)
      let j = i + 1;
      while (j < row.length) {
        if (row[j] === '\\' && j + 1 < row.length) {
          j += 2;
          continue;
        }
        if (row[j] === "'" && j + 1 < row.length && row[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (row[j] === "'") {
          j++;
          break;
        }
        j++;
      }
      tokens.push(parseValue(row.slice(i, j)));
      i = j;
    } else {
      // Numeric or NULL token — read until comma
      let j = i;
      while (j < row.length && row[j] !== ',') j++;
      tokens.push(parseValue(row.slice(i, j).trim()));
      i = j;
    }
  }
  return tokens;
}

/** Extract all INSERT rows for a given table from a SQL dump string.
 *  Returns an array of token arrays, one per row.
 *
 *  Strategy: scan character-by-character to find the INSERT INTO <table>
 *  statement, then find the VALUES keyword, then extract each (...) row
 *  group while respecting single-quoted strings (so ';' inside a string
 *  does not prematurely terminate the extraction). */
function extractRows(sql: string, tableName: string): (string | number | null)[][] {
  const result: (string | number | null)[][] = [];
  // Find "INSERT INTO `tableName`" or "INSERT INTO tableName" (case-insensitive)
  const tablePattern = new RegExp(`INSERT\\s+INTO\\s+[\`"]?${tableName}[\`"]?`, 'gi');
  let insertMatch: RegExpExecArray | null;
  while ((insertMatch = tablePattern.exec(sql)) !== null) {
    // From this position, find the VALUES keyword
    const afterInsert = sql.indexOf('VALUES', insertMatch.index + insertMatch[0].length);
    if (afterInsert < 0) continue;
    // Skip whitespace after VALUES
    let pos = afterInsert + 6; // length of 'VALUES'
    while (pos < sql.length && /\s/.test(sql[pos]!)) pos++;
    // Now scan the VALUES rows, respecting quoted strings.
    // Stop at a statement-terminating ';' that is NOT inside a string.
    let depth = 0;
    let inStr = false;
    let rowStart = -1;
    while (pos < sql.length) {
      const ch = sql[pos]!;
      if (inStr) {
        if (ch === '\\' && pos + 1 < sql.length) {
          pos += 2;
          continue; // skip escape sequence
        }
        if (ch === "'" && pos + 1 < sql.length && sql[pos + 1] === "'") {
          pos += 2;
          continue; // escaped single quote
        }
        if (ch === "'") inStr = false;
      } else {
        if (ch === "'") {
          inStr = true;
        } else if (ch === '(') {
          depth++;
          if (depth === 1) rowStart = pos + 1;
        } else if (ch === ')') {
          depth--;
          if (depth === 0 && rowStart >= 0) {
            const inner = sql.slice(rowStart, pos);
            result.push(splitRow(inner));
            rowStart = -1;
          }
        } else if (ch === ';' && depth === 0) {
          break; // end of INSERT statement
        }
      }
      pos++;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// oCard punch data parser — MeOS stores punch data as semicolon-separated
// text in the oCard.Punches column: "code1:sec1;code2:sec2;..."
// ---------------------------------------------------------------------------

function parseMeosPunches(punchData: string): Array<{ code: number; secondsInHalfDay: number }> {
  if (!punchData) return [];
  return punchData
    .split(';')
    .map((p) => {
      const [codeStr, secStr] = p.split(':');
      const code = parseInt(codeStr ?? '', 10);
      const sec = parseInt(secStr ?? '', 10);
      if (isNaN(code) || isNaN(sec)) return null;
      return { code, secondsInHalfDay: sec % 43200 };
    })
    .filter((p): p is { code: number; secondsInHalfDay: number } => p !== null);
}

// ---------------------------------------------------------------------------
// importMeosDump — parse a MeOS SQL dump and import into fartOLa tables.
//
// MeOS oClass columns: Id, Name, [OrderId, NumberMaps, ...]
// MeOS oRunner columns: Id, Name, Club, Class, Card, StartTime, [...]
// MeOS oCard columns: Id, [ReadId, ControlTime(start), FinishTime, Punches, ...]
//
// Column positions differ between dump versions; we use named-column INSERT
// when present, and fallback to positional (Id first, Name second).
// ---------------------------------------------------------------------------

export function importMeosDump(
  dumpPath: string,
  handle: DbHandle,
  competitionId: string
): MeosDumpData {
  const sql = readFileSync(dumpPath, 'utf-8');

  // --- Parse oClass ---
  const classRows = extractRows(sql, 'oClass');
  const meosClasses: MeosClass[] = classRows
    .map((row) => ({
      meosId: Number(row[0]),
      name: String(row[1] ?? `Class-${row[0]}`),
    }))
    .filter((c) => !isNaN(c.meosId));

  // --- Parse oRunner ---
  const runnerRows = extractRows(sql, 'oRunner');
  const meosRunners: MeosRunner[] = runnerRows
    .map((row) => ({
      meosId: Number(row[0]),
      name: String(row[1] ?? ''),
      club: String(row[2] ?? ''),
      classId: Number(row[3]),
      cardNumber: Number(row[4]),
      startTimeSec: Number(row[5] ?? 0) || 0,
    }))
    .filter((r) => !isNaN(r.meosId) && r.cardNumber > 0);

  // --- Parse oCard (punch data) ---
  const cardRows = extractRows(sql, 'oCard');
  // oCard: Id, CardNo, ReadId, ControlTime, FinishTime, CheckTime, StartTime, Punches
  // Exact layout varies; best-effort: Id=0, CardNo=1, StartTime=6, FinishTime=4, Punches=7
  const meosCardReads: MeosCardRead[] = cardRows
    .map((row) => {
      const cardNumber = Number(row[1]);
      if (isNaN(cardNumber) || cardNumber <= 0) return null;
      const startSec = row[6] != null && row[6] !== 0 ? Number(row[6]) % 43200 : null;
      const finishSec = row[4] != null && row[4] !== 0 ? Number(row[4]) % 43200 : null;
      const punchStr = typeof row[7] === 'string' ? row[7] : '';
      const punches = parseMeosPunches(punchStr);
      return { cardNumber, punches, startSec, finishSec };
    })
    .filter((c): c is MeosCardRead => c !== null);

  // --- Insert classes into fartOLa ---
  const classIdMap = new Map<number, string>();
  for (const cls of meosClasses) {
    const id = randomUUID();
    try {
      handle.db
        .insert(classesTable)
        .values({
          id,
          competitionId,
          name: cls.name,
        })
        .run();
      classIdMap.set(cls.meosId, id);
    } catch {
      // Class name already exists (uniqueIndex) — find it
      const existing = handle.db
        .select({ id: classesTable.id })
        .from(classesTable)
        .where(and(eq(classesTable.competitionId, competitionId), eq(classesTable.name, cls.name)))
        .get();
      if (existing) classIdMap.set(cls.meosId, existing.id);
    }
  }

  // --- Insert competitors into fartOLa ---
  const runnerIdMap = new Map<number, string>();
  for (const runner of meosRunners) {
    const classId = classIdMap.get(runner.classId);
    if (!classId) continue; // orphaned runner — no matching class
    const id = randomUUID();
    try {
      handle.db
        .insert(competitorsTable)
        .values({
          id,
          competitionId,
          name: runner.name,
          club: runner.club || null,
          classId,
          cardNumber: runner.cardNumber,
          consentStatus: 'explicit',
          source: 'entrylist',
        })
        .run();
      runnerIdMap.set(runner.meosId, id);
    } catch {
      // Card number already bound — skip duplicate
    }
  }

  return {
    classes: meosClasses,
    runners: meosRunners,
    cardReads: meosCardReads,
    classIdMap,
    runnerIdMap,
  };
}

// ---------------------------------------------------------------------------
// replayCardReads — insert card_read events for all imported cards.
//
// Each MeosCardRead maps to a card_read event through insertEvent, simulating
// the full pipeline as if the SI bridge read the card live. The punch times
// are stored as seconds_in_half_day (MeOS internal time format); half_day is
// set to 0 (AM) unless the punch second is ≥ 43200s (PM).
// ---------------------------------------------------------------------------

const REPLAY_NODE_ID = 'meos-replay-node';

export function replayCardReads(
  dumpData: MeosDumpData,
  handle: DbHandle,
  competitionId: string
): void {
  for (const read of dumpData.cardReads) {
    const punches = read.punches.map((p) => ({
      code: p.code,
      seconds_in_half_day: p.secondsInHalfDay % 43200,
      half_day: p.secondsInHalfDay >= 43200 ? 1 : 0,
    }));

    const start =
      read.startSec !== null
        ? {
            seconds_in_half_day: read.startSec % 43200,
            half_day: (read.startSec >= 43200 ? 1 : 0) as 0 | 1,
            weekday: null,
          }
        : null;

    const finish =
      read.finishSec !== null
        ? {
            seconds_in_half_day: read.finishSec % 43200,
            half_day: (read.finishSec >= 43200 ? 1 : 0) as 0 | 1,
            weekday: null,
          }
        : null;

    // Event timestamp: use finish time as a proxy, or a fixed epoch if missing.
    const eventTimeMs = read.finishSec !== null ? read.finishSec * 1000 : Date.now();

    insertEvent(
      handle,
      REPLAY_NODE_ID,
      'card_read',
      eventTimeMs,
      {
        event_type: 'card_read',
        card_number: read.cardNumber,
        card_type: 'SI',
        start,
        finish,
        check: null,
        clear: null,
        punch_count: punches.length,
        punches: punches.map((p) => ({
          code: p.code,
          seconds_in_half_day: p.seconds_in_half_day,
          half_day: p.half_day as 0 | 1,
          weekday: null,
        })),
        card_holder: null,
      },
      competitionId
    );
  }
}

// ---------------------------------------------------------------------------
// validateResults — compare fartOLa projection against expected MeOS results.
//
// Runs reduce() over the events + competitors for the given competition, then
// checks each expected result against the projection. Returns matches + a
// mismatch list for diagnostics.
// ---------------------------------------------------------------------------

export function validateResults(
  handle: DbHandle,
  competitionId: string,
  expectedResults: MeosResult[]
): ValidationResult {
  const input = loadCompetitionInputs(handle, competitionId);
  if (!input) {
    return {
      matches: 0,
      mismatches: expectedResults.map((expected) => ({
        cardNumber: expected.cardNumber,
        expected,
        actual: { status: 'PEND', elapsedMs: null, missingCodes: [] },
      })),
    };
  }
  const state = reduce(input);

  // Build card_number → competitor_id map from the competitor views
  const cardToView = new Map<number, import('../projection/types.ts').CompetitorView>();
  for (const view of state.competitors.values()) {
    if (view.card_number !== null) cardToView.set(view.card_number, view);
  }

  let matches = 0;
  const mismatches: ValidationMismatch[] = [];

  for (const expected of expectedResults) {
    const view = cardToView.get(expected.cardNumber);
    const actual = {
      status: view?.status ?? 'PEND',
      elapsedMs: view?.elapsed_time_ms ?? null,
      missingCodes: view?.missing_codes ?? [],
    };

    // Status and elapsed match (within 1s tolerance for rounding)
    const statusMatch = actual.status === expected.status;
    const elapsedMatch =
      expected.elapsedMs === null
        ? actual.elapsedMs === null
        : actual.elapsedMs !== null && Math.abs(actual.elapsedMs - expected.elapsedMs) <= 1000;
    const codesMatch =
      !expected.missingCodes ||
      JSON.stringify(actual.missingCodes.sort()) === JSON.stringify(expected.missingCodes.sort());

    if (statusMatch && elapsedMatch && codesMatch) {
      matches++;
    } else {
      mismatches.push({ cardNumber: expected.cardNumber, expected, actual });
    }
  }

  return { matches, mismatches };
}
