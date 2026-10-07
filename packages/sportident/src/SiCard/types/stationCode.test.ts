// Authored for fartola. Not ported from upstream.
//
// Station codes (CN) of the start, finish and check units. In the record
// [ptd, cn, time_hi, time_lo] the CN is the byte after the PTD that SiTime
// uses (0x0c/0x10/0x08 on SI8 and newer, 0x18/0x14/0x1c on SI6). SI5 has no CN.

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
  };
}

/** Put a PTD/CN/time record at `offset`: PTD 0x01 (PM bit), time 10:00:00 PM. */
function setRecord(bytes: number[], offset: number, cn: number): void {
  bytes.splice(offset, 4, 0x01, cn, 0x0e, 0x10);
}

describe('station codes of start, finish and check', () => {
  test('SI10: start 3, finish 10, check 22 are decoded next to the times', () => {
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

  test('a missing time carries no code', () => {
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
