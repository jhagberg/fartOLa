// Ported from allestuetsmerweh/sportident.js — packages/sportident/src/SiCard/types/SiCard6.ts
// Upstream: https://github.com/allestuetsmerweh/sportident.js (MIT License)
// Local modifications:
//   - Registers on its own SI6_DET-only registry (BaseSiCard.registerSi6Range),
//     like SiCard5/SI8 cards (codex review #4: no cross-capture).
//   - GET_SI6 response framing matches the hardware-verified GET_SI8 handling
//     in ModernSiCard: [cmd, len, addr_hi, addr_lo, block, ...128 data], so the
//     data starts at slice(5).
//   - Card holder page (block 1) is not read: upstream marks it untested on
//     real devices, and readout doesn't need it. One round trip fewer.
//   - Stripped lodash; no console warnings (decoders are pure).
//   - Test-only `_decodeFromStorage(bytes)` like the other card types.
//   - Punch control code via siPunchCode(): PTD bits 6-7 are code bits 8-9 (codes > 255).
//   - Start/finish/check station codes (CN byte next to each PTD, plus PTD bits 6-7 as code bits 8-9, so codes above 255) read into startCode/finishCode/checkCode.
// See packages/sportident/NOTICE.md for cumulative attribution.

import { proto } from '../../constants.ts';
import { SiTime, arr2cardNumber, siPunchCode } from '../../siProtocol.ts';
import { type SiStorage, type SiStorageLocations, defineStorage } from '../../storage/SiStorage.ts';
import { SiArray } from '../../storage/SiArray.ts';
import { SiDict } from '../../storage/SiDict.ts';
import { SiInt } from '../../storage/SiInt.ts';
import { SiModified } from '../../storage/SiModified.ts';
import { BaseSiCard } from '../BaseSiCard.ts';
import type { IBaseSiCardStorageFields } from '../ISiCard.ts';
import type { IPunch } from '../IRaceResultData.ts';

const punchesPerPage = 32;
const bytesPerPage = 128;
const MAX_NUM_PUNCHES = 64;

interface PotentialSiCard6Punch {
  code: number | undefined;
  time: number | null | undefined;
}

/** Punches live in blocks 6 and 7, 4 bytes each: [ptd, code, time_hi, time_lo]. */
export const getPunchOffset = (i: number): number => bytesPerPage * 6 + i * 4;

export const cropPunches = (allPunches: (PotentialSiCard6Punch | undefined)[]): IPunch[] => {
  const isPunchEntryValid = (punch: PotentialSiCard6Punch | undefined): punch is IPunch =>
    punch !== undefined &&
    punch.code !== undefined &&
    punch.time !== undefined &&
    punch.time !== null;
  const firstInvalidIndex = allPunches.findIndex((punch) => !isPunchEntryValid(punch));
  const punchesUntilInvalid =
    firstInvalidIndex === -1 ? allPunches : allPunches.slice(0, firstInvalidIndex);
  return punchesUntilInvalid.filter(isPunchEntryValid);
};

export type ISiCard6StorageFields = IBaseSiCardStorageFields;

export const siCard6StorageLocations: SiStorageLocations<ISiCard6StorageFields> = {
  cardNumber: new SiModified(
    new SiArray(3, (i) => new SiInt([[0x0b + (2 - i)]])),
    (extractedValue) => arr2cardNumber(extractedValue)
  ),
  startTime: new SiTime([[0x1b], [0x1a]], 0x18),
  finishTime: new SiTime([[0x17], [0x16]], 0x14),
  checkTime: new SiTime([[0x1f], [0x1e]], 0x1c),
  startCode: siPunchCode(0x18),
  finishCode: siPunchCode(0x14),
  checkCode: siPunchCode(0x1c),
  clearTime: new SiTime([[0x23], [0x22]], 0x20),
  punchCount: new SiInt([[0x12]]),
  punches: new SiModified(
    new SiArray(
      MAX_NUM_PUNCHES,
      (i) =>
        new SiDict({
          code: siPunchCode(getPunchOffset(i)),
          time: new SiTime([[getPunchOffset(i) + 3], [getPunchOffset(i) + 2]], getPunchOffset(i)),
        })
    ),
    (allPunches) => cropPunches(allPunches as (PotentialSiCard6Punch | undefined)[])
  ),
  cardHolder: new SiDict({}),
};
export const siCard6StorageDefinition = defineStorage(0x400, siCard6StorageLocations);

export class SiCard6 extends BaseSiCard {
  static maxNumPunches = MAX_NUM_PUNCHES;

  public storage: SiStorage<ISiCard6StorageFields>;
  public punchCount?: number;

  constructor(cardNumber: number) {
    super(cardNumber);
    this.storage = siCard6StorageDefinition();
  }

  private getBlock(block: number): Promise<number[]> {
    if (!this.mainStation) return Promise.reject(new Error('No main station'));
    return this.mainStation
      .sendMessage({ command: proto.cmd.GET_SI6, parameters: [block] }, 1)
      .then((data: number[][]) => {
        const frame = data[0];
        if (frame === undefined) throw new Error(`No response for GET_SI6 block ${block}`);
        if (frame[4] !== block) {
          throw new Error(`GET_SI6 returned block ${frame[4]} (expected ${block})`);
        }
        return frame.slice(5);
      });
  }

  async typeSpecificRead(): Promise<void> {
    this.storage.splice(0, bytesPerPage, ...(await this.getBlock(0)));
    const punchCount = this.storage.get('punchCount')?.value ?? 0;
    if (punchCount > 0) {
      this.storage.splice(bytesPerPage * 6, bytesPerPage, ...(await this.getBlock(6)));
    }
    if (punchCount > punchesPerPage) {
      this.storage.splice(bytesPerPage * 7, bytesPerPage, ...(await this.getBlock(7)));
    }
    this.populateRaceResult();
  }

  /** Test-only: splice storage bytes and populate raceResult, no station. */
  _decodeFromStorage(storageBytes: (number | undefined)[]): void {
    const limit = Math.min(storageBytes.length, 0x400);
    for (let i = 0; i < limit; i++) {
      this.storage.splice(i, 1, storageBytes[i] as number);
    }
    this.populateRaceResult();
  }

  protected populateRaceResult(): void {
    const cn = this.storage.get('cardNumber')?.value;
    if (cn !== undefined) this.raceResult.cardNumber = cn;
    const startTime = this.storage.get('startTime')?.value;
    if (startTime !== undefined) this.raceResult.startTime = startTime;
    const startCode = this.storage.get('startCode')?.value;
    if (startTime != null && startCode !== undefined) this.raceResult.startCode = startCode;
    const finishTime = this.storage.get('finishTime')?.value;
    if (finishTime !== undefined) this.raceResult.finishTime = finishTime;
    const finishCode = this.storage.get('finishCode')?.value;
    if (finishTime != null && finishCode !== undefined) this.raceResult.finishCode = finishCode;
    const checkTime = this.storage.get('checkTime')?.value;
    if (checkTime !== undefined) this.raceResult.checkTime = checkTime;
    const checkCode = this.storage.get('checkCode')?.value;
    if (checkTime != null && checkCode !== undefined) this.raceResult.checkCode = checkCode;
    const clearTime = this.storage.get('clearTime')?.value;
    if (clearTime !== undefined) this.raceResult.clearTime = clearTime;
    const punches = this.storage.get('punches')?.value;
    if (punches !== undefined) this.raceResult.punches = punches as IPunch[];
    const punchCount = this.storage.get('punchCount')?.value;
    if (punchCount !== undefined) this.punchCount = punchCount;
  }
}

BaseSiCard.registerSi6Range(500_000, 1_000_000, SiCard6);
BaseSiCard.registerSi6Range(2_003_000, 2_004_000, SiCard6);
