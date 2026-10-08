// Authored for fartola. Not ported from upstream.
//
// Station codes (CN) of the start, finish and check units. In the record
// [ptd, cn, time_hi, time_lo] the CN is the byte after the PTD that SiTime
// uses (0x0c/0x10/0x08 on SI8 and newer, 0x18/0x14/0x1c on SI6). SI5 has no CN.

// Evidence tags used in comments below: documented (SPORTident doc) = the card
// data structure doc, provided on request; MeOS behaviour = MeOS
// SportIdent.cpp; bench capture <fixture>; assumption, unverified.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { SiCard5 } from './SiCard5.ts';
import { SiCard10 } from './SiCard10.ts';
import { SiCard6 } from './SiCard6.ts';
import { fixture as si10 } from '../../../tests/fixtures/upstream/si10-typical.ts';
import { fixture as si5 } from '../../../tests/fixtures/upstream/si5-full.ts';
import { toHalfDayClock } from '../../output/ndjson.ts';

interface Decodable {
  _decodeFromStorage(bytes: (number | undefined)[]): void;
  raceResult: {
    startTime?: number | null;
    finishTime?: number | null;
    checkTime?: number | null;
    startCode?: number;
    finishCode?: number;
    checkCode?: number;
    startTouchFree?: boolean;
    finishTouchFree?: boolean;
    checkTouchFree?: boolean;
  };
}

/** Put a PTD/CN/time record at `offset`: PTD 0x01 (PM bit), time 10:00:00 PM. */
function setRecord(bytes: number[], offset: number, cn: number): void {
  bytes.splice(offset, 4, 0x01, cn, 0x0e, 0x10);
}

describe('station codes of start, finish and check', () => {
  test('SI10: start 3, finish 10, check 22 are decoded next to the times', () => {
    // Record layout TD-CN-TH-TL at 0x0c / 0x10 / 0x08: documented (SPORTident doc).
    const bytes = si10.storageData.map((b) => b ?? 0xee);
    setRecord(bytes, 0x0c, 3);
    setRecord(bytes, 0x10, 10);
    setRecord(bytes, 0x08, 22);
    const card: Decodable = new SiCard10(0);
    card._decodeFromStorage(bytes);
    assert.equal(card.raceResult.startCode, 3);
    assert.equal(card.raceResult.finishCode, 10);
    assert.equal(card.raceResult.checkCode, 22);
  });

  test('SI6: the CN sits at 0x19 / 0x15 / 0x1d', () => {
    // Page 1 order pointer, finish, start, check: documented (SPORTident doc).
    const bytes = new Array<number>(0x400).fill(0xee);
    setRecord(bytes, 0x18, 13);
    setRecord(bytes, 0x14, 20);
    setRecord(bytes, 0x1c, 12);
    const card: Decodable = new SiCard6(0);
    card._decodeFromStorage(bytes);
    assert.deepEqual(
      [card.raceResult.startCode, card.raceResult.finishCode, card.raceResult.checkCode],
      [13, 20, 12]
    );
  });

  test('codes above 255 use the PTD bits: 259, 266 and 278 on SI10 and 259 on SI6', () => {
    // PTD 0x41 (bit 0 PM, bit 6 = 1 -> +256), CN 3 / 10 / 22.
    // PTD bit 6 as code bit 8: documented (SPORTident doc, "bit 7...6 control station code number high").
    const bytes = si10.storageData.map((b) => b ?? 0xee);
    bytes.splice(0x0c, 4, 0x41, 3, 0x0e, 0x10);
    bytes.splice(0x10, 4, 0x41, 10, 0x0e, 0x10);
    bytes.splice(0x08, 4, 0x41, 22, 0x0e, 0x10);
    const card: Decodable = new SiCard10(0);
    card._decodeFromStorage(bytes);
    assert.deepEqual(
      [card.raceResult.startCode, card.raceResult.finishCode, card.raceResult.checkCode],
      [259, 266, 278]
    );
    const six = new Array<number>(0x400).fill(0xee);
    six.splice(0x18, 4, 0x41, 3, 0x0e, 0x10);
    const card6: Decodable = new SiCard6(0);
    card6._decodeFromStorage(six);
    assert.equal(card6.raceResult.startCode, 259);
  });

  test('PTD bit 7 is not a code bit: 0xC1 with CN 3 and no block 1 has no code, only touch_free', () => {
    const bytes: (number | undefined)[] = si10.storageData.map((b) => b ?? 0xee);
    bytes.splice(0x10, 4, 0xc1, 3, 0x0e, 0x10);
    // Bit 7 not a code bit: documented (it is the subsecond marker); that a bit-7 record's
    // code lives in block 1: MeOS behaviour, not in the SPORTident doc.
    bytes[0xa9] = undefined; // block 1 not read
    const card: Decodable = new SiCard10(0);
    card._decodeFromStorage(bytes);
    assert.equal(card.raceResult.finishTouchFree, true);
    // Block 1 (0xa9) unread: the code is unknown rather than a wrong 3 or 771.
    assert.equal(card.raceResult.finishCode, undefined);
  });

  test('a touch-free start/finish/check takes its code from block 1 (0xa5 / 0xa9 / 0xa1)', () => {
    const bytes = new Array<number>(0x100).fill(0xee).map((_, i) => si10.storageData[i] ?? 0xee);
    // Offsets 0xa5 / 0xa9 / 0xa1 and "bit 7 -> code from block 1": MeOS behaviour (SportIdent.cpp:1929);
    // not in the SPORTident card doc. A bit-7 CHECK record's code at 0xa1 is the same MeOS
    // rule applied to check: assumption, unverified (the doc allows a subsecond only on start/finish).
    bytes.splice(0x0c, 4, 0x81, 3, 0x0e, 0x10); // start: touch-free, CN ignored
    bytes.splice(0x10, 4, 0x81, 10, 0x0e, 0x10); // finish
    bytes.splice(0x08, 4, 0x01, 2, 0x0e, 0x10); // check: contact, own CN
    bytes[0xa5] = 13;
    bytes[0xa9] = 20;
    bytes[0xa1] = 99; // ignored: check is not touch-free
    const card: Decodable = new SiCard10(0);
    card._decodeFromStorage(bytes);
    assert.deepEqual(
      [card.raceResult.startCode, card.raceResult.finishCode, card.raceResult.checkCode],
      [13, 20, 2]
    );
    assert.deepEqual(
      [
        card.raceResult.startTouchFree,
        card.raceResult.finishTouchFree,
        card.raceResult.checkTouchFree,
      ],
      [true, true, undefined]
    );
  });

  test('PTD bit 6 adds 256 to a touch-free code too: 0xC1 + block 1 = 10 gives 266, 0x81 gives 10', () => {
    // Bit 6 added after choosing the byte: MeOS behaviour (SportIdent.cpp:1932). Whether a station
    // stores bit 6 for a block-1 code is assumption, unverified (the doc says start/finish codes < 256).
    const bytes = new Array<number>(0x100).fill(0xee).map((_, i) => si10.storageData[i] ?? 0xee);
    bytes.splice(0x10, 4, 0xc1, 3, 0x0e, 0x10);
    bytes[0xa9] = 10;
    const card: Decodable = new SiCard10(0);
    card._decodeFromStorage(bytes);
    assert.equal(card.raceResult.finishCode, 266);
    bytes.splice(0x10, 4, 0x81, 3, 0x0e, 0x10);
    const card2: Decodable = new SiCard10(0);
    card2._decodeFromStorage(bytes);
    assert.equal(card2.raceResult.finishCode, 10);
  });

  test('toHalfDayClock carries touch_free only when true', () => {
    assert.equal(toHalfDayClock(100, 20, true)?.touch_free, true);
    assert.equal('touch_free' in (toHalfDayClock(100, 20, false) ?? {}), false);
  });

  test('a missing time carries no code', () => {
    // Own design (an erased/cleared record has no station): assumption, unverified on hardware.
    const bytes = si10.storageData.map((b) => b ?? 0xee);
    bytes.splice(0x0c, 4, 0x00, 0x03, 0xee, 0xee); // start empty, CN left behind
    const card: Decodable = new SiCard10(0);
    card._decodeFromStorage(bytes);
    assert.equal(card.raceResult.startCode, undefined);
  });

  test('SI5 has none', () => {
    const card: Decodable = new SiCard5(0);
    card._decodeFromStorage(si5.storageData.map((b) => b ?? 0xee));
    assert.equal(card.raceResult.startCode, undefined);
    assert.equal(card.raceResult.finishCode, undefined);
    assert.equal(card.raceResult.checkCode, undefined);
  });

  test('toHalfDayClock adds the code only when there is one', () => {
    assert.deepEqual(toHalfDayClock(100, 10), {
      seconds_in_half_day: 100,
      half_day: 0,
      weekday: null,
      code: 10,
    });
    assert.deepEqual(toHalfDayClock(100), { seconds_in_half_day: 100, half_day: 0, weekday: null });
    assert.equal(toHalfDayClock(null, 10), null);
  });
});
