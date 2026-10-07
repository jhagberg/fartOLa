// Authored for fartola. Not ported from upstream.
//
// Control codes above 255 on PTD punch records. A record is
// [ptd, cn, time_hi, time_lo]; CN holds code bits 0-7 and PTD bits 6-7 hold
// code bits 8-9, so control code = cn + ((ptd & 0xc0) << 2) (cf. SIReader's
// sireader2.py). `41 2C 0E 10` is control 300 (0x2C = 44, PTD 0x40 → +256),
// punched at 01:00 PM (PTD bit 0 set → 3600 + 43 200 s).
// See packages/sportident/NOTICE.md for cumulative attribution.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { SiCard6, getPunchOffset as si6PunchOffset } from './SiCard6.ts';
import { SiCard8, getPunchOffset as si8PunchOffset } from './SiCard8.ts';
import { SiCard9, getPunchOffset as si9PunchOffset } from './SiCard9.ts';
import { SiCard10 } from './SiCard10.ts';
import { SiCard11 } from './SiCard11.ts';
import { SIAC } from './SIAC.ts';
import { getPunchOffset as modernPunchOffset } from './ModernSiCard.ts';
import { fixture as si10 } from '../../../tests/fixtures/upstream/si10-typical.ts';

const CODE_300_RECORD = [0x41, 0x2c, 0x0e, 0x10];
const CODE_300_PUNCH = { code: 300, time: 3600 + 43_200 };

/** `storage` with the punch record at `offset` replaced by control 300. */
function withCode300(storage: readonly (number | undefined)[], offset: number): number[] {
  const bytes = storage.map((b) => b ?? 0xee);
  bytes.splice(offset, 4, ...CODE_300_RECORD);
  return bytes;
}

interface Decodable {
  _decodeFromStorage(bytes: (number | undefined)[]): void;
  raceResult: { punches?: { code: number; time: number | null }[] };
}

describe('punch control code: PTD bits 6-7 are code bits 8-9', () => {
  for (const [name, Card] of [
    ['SiCard10', SiCard10],
    ['SiCard11', SiCard11],
    ['SIAC', SIAC],
  ] as const) {
    test(`${name}: upstream SI10 fixture with control 300 as its first punch`, () => {
      const card: Decodable = new Card(0);
      card._decodeFromStorage(withCode300(si10.storageData, modernPunchOffset(0)));
      const punches = card.raceResult.punches ?? [];
      assert.deepStrictEqual(punches[0], CODE_300_PUNCH);
      // The other 15 punches have PTD bits 6-7 clear and decode as before.
      assert.deepStrictEqual(punches.slice(1), (si10.cardData['punches'] as unknown[]).slice(1));
    });
  }

  for (const [name, card, offset] of [
    ['SiCard6', new SiCard6(0), si6PunchOffset(0)],
    ['SiCard8', new SiCard8(0), si8PunchOffset(0)],
    ['SiCard9', new SiCard9(0), si9PunchOffset(0)],
  ] as const) {
    test(`${name}: a punch record with PTD 0x41 decodes as control 300`, () => {
      const decodable: Decodable = card;
      decodable._decodeFromStorage(withCode300(Array<number>(0x400).fill(0xee), offset));
      assert.deepStrictEqual(decodable.raceResult.punches, [CODE_300_PUNCH]);
    });
  }
});
