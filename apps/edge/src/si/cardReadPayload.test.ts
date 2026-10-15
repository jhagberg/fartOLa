// Authored for fartola. Not ported from upstream.
//
// node:test coverage for `buildCardReadPayload`. The helper builds the
// events.payload column body from a Phase 0 BaseSiCard instance; codex
// review C-H2 requires the produced shape mirror NdjsonEmitter.card_read
// byte-for-byte (start/finish/check/clear top-level + card_holder +
// punch_count + punches[]).
//
// Test strategy: drive the SI10 Jonas bench fixture through SiMainStation via
// a tiny inline PlaybackTransport (same pattern as
// packages/sportident/src/integration/benchReplay.test.ts). Capture the
// BaseSiCard instance that arrives on `cardRead`. Run it through BOTH
// `buildCardReadPayload(card)` AND `NdjsonEmitter.card_read({ card })`,
// then compare field-by-field to prove the two paths agree.
//
// Tests:
//   1. round-trip vs the captured SI10 fixture's expected.json card_read row
//      — every field (start/finish/check/clear/punches/card_holder/...)
//      matches the bench truth.
//   2. C-H2 regression gate — payload.finish is non-null with a finite
//      seconds_in_half_day and half_day ∈ {0,1}.
//   3. payload.start is non-null (symmetric gate).
//   4. null pass-through: a synthetic BaseSiCard with no finishTime yields
//      payload.finish === null (proves DNF marking will work at plan 07).
//   5. punches[] deep-equals NdjsonEmitter.card_read's punches[] (both paths
//      pass through the same toHalfDayClock helper from @fartola/sportident).
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-06-PLAN.md task 1
// - .planning/phases/01-single-laptop-training-mvp/01-REVIEWS.md §C-H2

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { EventEmitter } from 'node:events';

import {
  SiMainStation,
  NdjsonEmitter,
  BaseSiCard,
  SiCard10,
  SIAC,
  render,
} from '@fartola/sportident';
import type { ISerialTransport } from '@fartola/sportident';

import type { Event, Competitor, Class } from '../db/types.ts';
import { reduce, type CourseWithControlCodes } from '../projection/reduce.ts';
import { localToEpochMs } from '../time/competitionClock.ts';
import { buildCardReadPayload } from './cardReadPayload.ts';
import { holderName } from './cardHolderHints.ts';

// Resolve the fixture directory relative to THIS test file (mirror the
// benchReplay test convention — cwd-relative paths break under pnpm's per-
// package cwd).
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(
  HERE,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'sportident',
  'tests',
  'fixtures',
  'jonas'
);

interface Step {
  dir: 'out' | 'in';
  bytes: number[];
}

function hexEncode(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

function parseTranscript(raw: string): Step[] {
  const steps: Step[] = [];
  for (const lineRaw of raw.split('\n')) {
    const line = lineRaw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const m = /^(out|in)\s+([0-9A-Fa-f \t]+)$/.exec(line);
    if (!m) throw new Error(`bad transcript line: ${JSON.stringify(line)}`);
    const dir = m[1] as 'out' | 'in';
    const bytes = m[2]!
      .split(/\s+/)
      .filter((s) => s.length > 0)
      .map((s) => parseInt(s, 16));
    steps.push({ dir, bytes });
  }
  return steps;
}

/**
 * Reply for a GET_SI8 page-1 or page-3 request that a transcript does not
 * contain. Bench captures made before block-1 and block-3 support
 * (siac-jonas-001: touch-free finish, blocks 1 and 3 never read) are frozen
 * truth, so they stay strict; these extra requests are answered with an
 * erased page (all 0xEE, "no data"). Undefined for any other request.
 * The erased page 3 makes the reserve records read and empty (null).
 */
function legacyErasedPageReply(sent: number[]): number[] | undefined {
  for (const page of [0x01, 0x03]) {
    const request = [0xff, ...render({ command: 0xef, parameters: [page] })];
    if (hexEncode(sent) !== hexEncode(request)) continue;
    return render({
      command: 0xef,
      parameters: [0x00, 0x0a, page, ...new Array<number>(128).fill(0xee)],
    });
  }
  return undefined;
}

class PlaybackTransport extends EventEmitter implements ISerialTransport {
  private cursor = 0;
  private err: string | null = null;
  private readonly steps: Step[];
  constructor(steps: Step[]) {
    super();
    this.steps = steps;
  }
  open(): Promise<void> {
    return Promise.resolve();
  }
  send(bytes: number[]): Promise<void> {
    if (this.err) return Promise.reject(new Error(this.err));
    // Pre-CR-003 fixtures don't include the bare-ACK; swallow it when the
    // transcript doesn't expect one at the cursor.
    if (bytes.length === 1 && bytes[0] === 0x06) {
      const step = this.steps[this.cursor];
      if (
        step === undefined ||
        step.dir !== 'out' ||
        step.bytes.length !== 1 ||
        step.bytes[0] !== 0x06
      ) {
        return Promise.resolve();
      }
    }
    const step = this.steps[this.cursor];
    const legacy = legacyErasedPageReply(bytes);
    if (
      legacy !== undefined &&
      (step === undefined || hexEncode(step.bytes) !== hexEncode(bytes))
    ) {
      setImmediate(() => this.emit('data', legacy));
      return Promise.resolve();
    }
    if (!step || step.dir !== 'out') {
      this.err = `out mismatch at cursor=${this.cursor} (sent ${hexEncode(bytes)})`;
      return Promise.reject(new Error(this.err));
    }
    if (hexEncode(step.bytes) !== hexEncode(bytes)) {
      this.err = `out byte mismatch at step ${this.cursor}`;
      return Promise.reject(new Error(this.err));
    }
    this.cursor++;
    while (this.cursor < this.steps.length && this.steps[this.cursor]!.dir === 'in') {
      const chunk = this.steps[this.cursor]!.bytes;
      this.cursor++;
      setImmediate(() => this.emit('data', chunk));
    }
    return Promise.resolve();
  }
  close(): Promise<void> {
    setImmediate(() => this.emit('close'));
    return Promise.resolve();
  }
  pumpRemaining(perTickMs: number = 5): Promise<void> {
    return new Promise<void>((resolve) => {
      const tick = (): void => {
        const step = this.steps[this.cursor];
        if (!step || step.dir === 'out') return resolve();
        this.cursor++;
        setImmediate(() => this.emit('data', step.bytes));
        setTimeout(tick, perTickMs);
      };
      setTimeout(tick, perTickMs);
    });
  }
  getError(): string | null {
    return this.err;
  }
}

/** Drive a transcript through SiMainStation and resolve with the first
 * cardRead'd BaseSiCard. Returns null if the fixture never emits cardRead. */
async function captureFirstCardRead(basename: string): Promise<BaseSiCard | null> {
  const raw = fs.readFileSync(`${basename}.bytes.hex`, 'utf8');
  const steps = parseTranscript(raw);
  const transport = new PlaybackTransport(steps);
  const station = new SiMainStation(transport);
  let captured: BaseSiCard | null = null;
  station.on('cardRead', (card: BaseSiCard) => {
    if (captured === null) captured = card;
  });
  await transport.open();
  await station.readCards();
  await transport.pumpRemaining();
  // Wait for the read itself rather than a fixed 80 ms, which was too short
  // when the whole edge suite runs in parallel.
  for (let waited = 0; captured === null && waited < 3000; waited += 20) {
    await new Promise((r) => setTimeout(r, 20));
  }
  await station.close();
  return captured;
}

describe('buildCardReadPayload — SI10 Jonas fixture round-trip', () => {
  test('test 1: round-trip vs NdjsonEmitter output is byte-equal on every field', async () => {
    const basename = path.join(FIXTURE_DIR, 'si10-jonas-001');
    const card = await captureFirstCardRead(basename);
    assert.ok(card, 'SI10 fixture must produce a cardRead event');

    const payload = buildCardReadPayload(card);

    // Compare against NdjsonEmitter.card_read by capturing its emission.
    const capturedLines: string[] = [];
    const emitter = new NdjsonEmitter({
      device_path: '/dev/replay',
      out: (line) => capturedLines.push(line),
    });
    emitter.card_read({ card });
    assert.equal(capturedLines.length, 1);
    const ndjson = JSON.parse(capturedLines[0]!) as Record<string, unknown>;

    // Every payload field MUST equal the NdjsonEmitter's emission.
    // (The emitter additionally carries _base() fields the column body omits:
    // schema_version, event, ts_ms, device_path — those are NDJSON-stream
    // specific and NOT part of the events.payload column.)
    assert.deepEqual(payload.card_type, ndjson['card_type']);
    assert.deepEqual(payload.card_number, ndjson['card_number']);
    assert.deepEqual(payload.start, ndjson['start']);
    assert.deepEqual(payload.finish, ndjson['finish']);
    assert.deepEqual(payload.check, ndjson['check']);
    assert.deepEqual(payload.clear, ndjson['clear']);
    assert.deepEqual(payload.punch_count, ndjson['punch_count']);
    assert.deepEqual(payload.punches, ndjson['punches']);
    // ADR-0019: the NDJSON output may show the card holder; the event never does.
    assert.equal('card_holder' in payload, false);
    if (payload.card_series_byte !== undefined) {
      assert.deepEqual(payload.card_series_byte, ndjson['card_series_byte']);
    }
    if (payload.uid !== undefined) {
      assert.deepEqual(payload.uid, ndjson['uid']);
    }
  });

  test('test 2 (C-H2 — finish is non-null on SI10 fixture)', async () => {
    const basename = path.join(FIXTURE_DIR, 'si10-jonas-001');
    const card = await captureFirstCardRead(basename);
    assert.ok(card);
    const payload = buildCardReadPayload(card);
    assert.notEqual(payload.finish, null, 'SI10 fixture has a non-null finishTime');
    assert.ok(payload.finish, 'narrowing');
    assert.ok(
      Number.isFinite(payload.finish.seconds_in_half_day),
      'finish.seconds_in_half_day must be a finite number'
    );
    assert.ok(
      payload.finish.half_day === 0 || payload.finish.half_day === 1,
      'finish.half_day must be 0 or 1'
    );
  });

  test('test 3: start is non-null on SI10 fixture (symmetric C-H2 gate)', async () => {
    const basename = path.join(FIXTURE_DIR, 'si10-jonas-001');
    const card = await captureFirstCardRead(basename);
    assert.ok(card);
    const payload = buildCardReadPayload(card);
    assert.notEqual(payload.start, null);
    assert.ok(payload.start);
    assert.ok(Number.isFinite(payload.start.seconds_in_half_day));
    assert.ok(payload.start.half_day === 0 || payload.start.half_day === 1);
  });

  test('test 4: no-finish edge case — synthetic card with finishTime undefined yields payload.finish === null', () => {
    // Construct a minimal BaseSiCard-shaped object — buildCardReadPayload only
    // reads card.cardNumber + card.cardSeriesByte + card.raceResult.* + the
    // optional punchCount/uid fields. A bare object cast is sufficient for the
    // helper's surface; no SiCard5/10/etc decode required.
    const card = {
      cardNumber: 7501853,
      raceResult: {
        cardNumber: 7501853,
        // startTime / finishTime / checkTime / clearTime all omitted.
        punches: [],
      },
    } as unknown as BaseSiCard;
    const payload = buildCardReadPayload(card);
    assert.equal(payload.finish, null);
    assert.equal(payload.start, null);
    assert.equal(payload.check, null);
    assert.equal(payload.clear, null);
    assert.equal(payload.punch_count, 0);
  });

  test('a card with holder data programmed: the event holds none of it (ADR-0019)', () => {
    const card = {
      cardNumber: 8_000_001,
      raceResult: {
        cardNumber: 8_000_001,
        punches: [],
        cardHolder: {
          firstName: 'Anna',
          lastName: 'Testsson',
          street: 'Provgatan 1',
          email: 'anna@example.test',
          phone: '0700000000',
          dateOfBirth: '1990-01-01',
        },
      },
    } as unknown as BaseSiCard;
    const stored = JSON.stringify(buildCardReadPayload(card));
    for (const text of ['Anna', 'Testsson', 'Provgatan', 'example.test', '0700000000', '1990']) {
      assert.ok(!stored.includes(text), `${text} in ${stored}`);
    }
    assert.equal(holderName(card.raceResult.cardHolder), 'Anna Testsson');
    assert.equal(holderName({ first_name: ' Old ', last_name: 'Read' }), 'Old Read');
    assert.equal(holderName({ country_code: 752 }), null);
  });

  test('test 5: punches[] deep-equals NdjsonEmitter.card_read output', async () => {
    const basename = path.join(FIXTURE_DIR, 'si10-jonas-001');
    const card = await captureFirstCardRead(basename);
    assert.ok(card);

    const payload = buildCardReadPayload(card);
    const capturedLines: string[] = [];
    const emitter = new NdjsonEmitter({
      device_path: '/dev/replay',
      out: (line) => capturedLines.push(line),
    });
    emitter.card_read({ card });
    const ndjson = JSON.parse(capturedLines[0]!) as { punches: unknown };
    assert.deepEqual(payload.punches, ndjson.punches);
    assert.ok(payload.punches.length > 0, 'SI10 fixture has 2 punches');
  });

  test('02.1-14 Task 3: SIAC read across noon carries the PM bit into half_day', async () => {
    const card = await captureFirstCardRead(path.join(FIXTURE_DIR, 'siac-jonas-001'));
    assert.ok(card);
    const payload = buildCardReadPayload(card);
    assert.equal(payload.card_type, 'SIAC');
    assert.deepEqual(payload.finish, {
      seconds_in_half_day: 591,
      half_day: 1,
      weekday: null,
      // PTD bit 7: the finish has a subsecond and its CN holds no code. A SIAC
      // keeps it in block 1 only from firmware 4.0, and this capture never
      // read block 3 (firmware unknown), so there is no code.
      // CN of that bit-7 record is TSS: 117/256 s (SPORTident doc; bench capture siac-jonas-001).
      subsec_256: 117,
    });
    const halves = payload.punches.map((p) => p.half_day);
    assert.equal(halves[0], 0, 'first punch 11:29 is AM');
    assert.equal(halves[halves.length - 1], 1, 'last punch 12:09 is PM');
  });

  test('subsec_256 on start/finish only: a bit-7 check record keeps CN as no fraction', () => {
    const mem = new Array<number>(0x400).fill(0xee);
    mem.splice(0x0c, 4, 0x81, 64, 0x0e, 0x10); // start, bit 7: CN = 64/256 s
    mem.splice(0x10, 4, 0x81, 0, 0x0e, 0x10); // finish, fraction 0 is a fraction
    mem.splice(0x08, 4, 0x81, 99, 0x0e, 0x10); // check, bit 7: CN is NOT a fraction
    const card = new SiCard10(0);
    card._decodeFromStorage(mem);
    const payload = buildCardReadPayload(card);
    assert.equal(payload.start?.subsec_256, 64);
    assert.equal(payload.finish?.subsec_256, 0);
    assert.ok(payload.check);
    assert.equal('subsec_256' in payload.check, false);
  });
});

// SIAC reserve records (block 3): the first start/finish punch after a clear.
// Observation only; the projection must not use them.
describe('SIAC reserve records in the card_read payload', () => {
  // 0x1d8 start_r, 0x1dc finish_r; [ptd, cn, th, tl]; times 10:00:00 (36000 =
  // 0x8ca0) and 10:10:00 (36600 = 0x8ef8) as the main start, finish.
  function siacImage(withReserve: boolean): number[] {
    const mem = new Array<number>(0x400).fill(0xee);
    const holder = ';;;;;;;;;;;';
    for (let i = 0; i < holder.length; i++) mem[0x20 + i] = holder.charCodeAt(i);
    mem[0x16] = 0;
    [mem[0x1c2], mem[0x1c3]] = [4, 0];
    mem.splice(0x0c, 4, 0x00, 1, 0x8c, 0xa0);
    mem.splice(0x10, 4, 0x00, 2, 0x8e, 0xf8);
    mem[0xa5] = 1;
    mem[0xa9] = 2;
    // reserve: start 09:59:50, finish 10:05:00 (36300 = 0x8dcc), finish with a subsecond
    if (withReserve) {
      mem.splice(0x1d8, 4, 0x00, 1, 0x8c, 0x96);
      mem.splice(0x1dc, 4, 0x80, 99, 0x8d, 0xcc);
    }
    return mem;
  }
  const decode = (withReserve: boolean): SIAC => {
    const card = new SIAC(8_500_001);
    card._decodeFromStorage(siacImage(withReserve));
    return card;
  };

  test('start_first / finish_first reach the payload and the NDJSON line alike', () => {
    const card = decode(true);
    const payload = buildCardReadPayload(card);
    assert.deepEqual(payload.start_first, {
      seconds_in_half_day: 35_990,
      half_day: 0,
      weekday: null,
      code: 1,
    });
    // PTD bit 7: CN is the subsecond and the code is unknown
    assert.deepEqual(payload.finish_first, {
      seconds_in_half_day: 36_300,
      half_day: 0,
      weekday: null,
      subsec_256: 99,
    });
    assert.equal(payload.start?.seconds_in_half_day, 36_000);
    const lines: string[] = [];
    new NdjsonEmitter({ device_path: '/dev/x', out: (l) => lines.push(l) }).card_read({ card });
    const nd = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.deepEqual(nd.start_first, payload.start_first);
    assert.deepEqual(nd.finish_first, payload.finish_first);
  });

  test('battery_date reaches the payload and the NDJSON line alike; absent when unknown', () => {
    const card = new SIAC(8_500_001);
    const mem = siacImage(false);
    mem.splice(0x1bc, 3, 24, 5, 15);
    card._decodeFromStorage(mem);
    const payload = buildCardReadPayload(card);
    assert.equal(payload.battery_date, '2024-05-15');
    const lines: string[] = [];
    new NdjsonEmitter({ device_path: '/dev/x', out: (l) => lines.push(l) }).card_read({ card });
    assert.equal((JSON.parse(lines[0]!) as Record<string, unknown>).battery_date, '2024-05-15');
    assert.equal('battery_date' in buildCardReadPayload(decode(false)), false);
  });

  // Acceptance case 3 (ADR-0019): an empty reserve and an unread block 3 are
  // both "first punch unknown", but never the same thing in the event.
  test('an empty reserve record is null, in the payload and the NDJSON line alike', () => {
    const card = decode(false);
    const payload = buildCardReadPayload(card);
    assert.equal(payload.start_first, null);
    assert.equal(payload.finish_first, null);
    const lines: string[] = [];
    new NdjsonEmitter({ device_path: '/dev/x', out: (l) => lines.push(l) }).card_read({ card });
    const nd = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.equal(nd.start_first, null);
    assert.equal(nd.finish_first, null);
  });

  test('block 3 not read: the keys are absent, in the payload and the NDJSON line alike', () => {
    const card = new SIAC(8_500_001);
    card._decodeFromStorage(siacImage(true).slice(0, 0x180)); // blocks 0-2 only
    const payload = buildCardReadPayload(card);
    assert.equal(payload.finish?.seconds_in_half_day, 36_600);
    assert.equal('start_first' in payload, false);
    assert.equal('finish_first' in payload, false);
    const lines: string[] = [];
    new NdjsonEmitter({ device_path: '/dev/x', out: (l) => lines.push(l) }).card_read({ card });
    const nd = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.equal('start_first' in nd, false);
    assert.equal('finish_first' in nd, false);
  });

  test('the projection gives identical results with a reserve, an empty one and an unread block 3', () => {
    const DAY = '2026-10-03';
    const unread = new SIAC(8_500_001);
    unread._decodeFromStorage(siacImage(true).slice(0, 0x180));
    const mk = (card: SIAC): Event =>
      ({
        nodeId: 'n',
        localSeq: 1,
        competitionId: 'comp-1',
        eventType: 'card_read',
        eventTimeMs: localToEpochMs(DAY, 37_000),
        recordedAtMs: localToEpochMs(DAY, 37_000),
        payload: buildCardReadPayload(card),
      }) as Event;
    const withFields = mk(decode(true));
    const empty = mk(decode(false));
    const notRead = mk(unread);
    assert.ok((withFields.payload as { finish_first?: unknown }).finish_first);
    assert.equal((empty.payload as { finish_first?: unknown }).finish_first, null);
    assert.equal('finish_first' in notRead.payload, false);
    const run = (e: Event) =>
      reduce({
        competition_id: 'comp-1',
        clock_offset_min: 120,
        events: [e],
        competitors: [
          {
            id: 'a',
            competitionId: 'comp-1',
            name: 'A',
            club: null,
            classId: 'cls',
            cardNumber: (withFields.payload as { card_number: number }).card_number,
            consentAtMs: null,
            consentStatus: 'explicit',
            scrubbedAtMs: null,
            source: 'walkup',
            startTimeMs: null,
          } as Competitor,
        ],
        classes: [
          {
            id: 'cls',
            competitionId: 'comp-1',
            name: 'H',
            shortName: null,
            firstStartMs: null,
            startIntervalSec: null,
            maxTimeSec: null,
          } as Class,
        ],
        courses: [
          {
            id: 'c',
            competitionId: 'comp-1',
            name: 'C',
            classId: 'cls',
            lengthM: null,
            climbM: null,
            control_codes: [],
          } as CourseWithControlCodes,
        ],
      });
    const [a, b, c] = [withFields, empty, notRead].map(run);
    assert.equal(a!.competitors.get('a')?.elapsed_time_ms, 600_000);
    // The read history keeps the reserves as read (ADR-0019 step 2): null for
    // empty, absent for not read. All else is equal.
    const history = (r: typeof a) => r!.competitors.get('a')!.card_read_history[0]!;
    assert.ok(history(a).finish_first);
    assert.equal(history(b).finish_first, null);
    assert.equal('finish_first' in history(c), false);
    for (const r of [a, b]) {
      delete history(r).start_first;
      delete history(r).finish_first;
    }
    assert.deepEqual(a, c);
    assert.deepEqual(b, c);
  });
});
