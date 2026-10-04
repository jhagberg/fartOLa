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

import { SiMainStation, NdjsonEmitter, BaseSiCard } from '@fartola/sportident';
import type { ISerialTransport } from '@fartola/sportident';

import { buildCardReadPayload } from './cardReadPayload.ts';

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
  await new Promise((r) => setTimeout(r, 80));
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
    assert.deepEqual(payload.card_holder, ndjson['card_holder']);
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
    assert.equal(payload.card_holder, null);
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
    assert.deepEqual(payload.finish, { seconds_in_half_day: 591, half_day: 1, weekday: null });
    const halves = payload.punches.map((p) => p.half_day);
    assert.equal(halves[0], 0, 'first punch 11:29 is AM');
    assert.equal(halves[halves.length - 1], 1, 'last punch 12:09 is PM');
  });
});
