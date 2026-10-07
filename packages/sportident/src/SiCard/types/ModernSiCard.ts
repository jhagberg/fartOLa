// Ported from allestuetsmerweh/sportident.js — packages/sportident/src/SiCard/types/ModernSiCard.ts
// Upstream: https://github.com/allestuetsmerweh/sportident.js (MIT License)
// Local modifications:
//   - Storage backed by `(number|undefined)[]` (plain array), not Immutable.List.
//   - `ModernSiCardSeries` exported as a `const ... as const` literal (no enums per
//     erasableSyntaxOnly: Node 22 strip-types-native pipeline rejects runtime enums).
//   - Stripped lodash; `_.range` replaced by `Array.from({length: n}, (_, i) => i)`.
//   - Two-registry split (codex review #4): concrete subclasses
//     SiCard9/SiCard10/SIAC call `BaseSiCard.registerSi8Range` (not the legacy single
//     `registerNumberRange`), so SI5_DET messages can never instantiate a modern card.
//   - typeSpecificRead chain explicitly issues `GET_SI8` with `parameters: [0x04]` for
//     the first punch page when the card has any punches — codex review #3 enforces
//     that punches live on pages 4-7, not page 0.
//   - Added a test-only `_decodeFromStorage(bytes)` helper that splices a complete
//     storage buffer (page0..page7 concatenated, or partial) into the SiStorage and
//     resolves the raceResult; fixture replay tests use this instead of a mock
//     station.
//   - Removed upstream's stdout-warning on storage mismatch (no console writes
//     from decoders; mismatch detection moves to the multiplexer in Plan 04).
//   - Punch control code via siPunchCode(): PTD bits 6-7 are code bits 8-9 (codes > 255).
//   - Start/finish/check station codes (CN plus PTD bit 6; touch-free records read it from block 1) read into startCode/finishCode/checkCode.
//   - Block 1 (page 1) is also fetched when a start/finish/check record is touch-free
//     (PTD bit 7) and the card holder step did not read it; MeOS SportIdent.cpp:1366
//     reads it for every SI10/SI11/SIAC card.
// See packages/sportident/NOTICE.md for cumulative attribution.

import { proto } from '../../constants.ts';
import {
  SiTime,
  arr2cardNumber,
  siPunchCode,
  siStationCode,
  siTouchFree,
} from '../../siProtocol.ts';
import { type SiStorage, type SiStorageLocations, defineStorage } from '../../storage/SiStorage.ts';
import { SiArray } from '../../storage/SiArray.ts';
import { SiDict } from '../../storage/SiDict.ts';
import { SiEnum } from '../../storage/SiEnum.ts';
import { SiInt } from '../../storage/SiInt.ts';
import { SiModified } from '../../storage/SiModified.ts';
import { BaseSiCard } from '../BaseSiCard.ts';
import type { IBaseSiCardStorageFields } from '../ISiCard.ts';
import type { IPunch } from '../IRaceResultData.ts';

class ReadFinishedException {}
const punchesPerPage = 32;
const bytesPerPage = 128;
const MAX_NUM_PUNCHES = 128;

// `as const` map (no `enum` — would fail erasableSyntaxOnly).
// Values cross-verified against upstream `ModernSiCard.ts` + RESEARCH §Card Decoders.
// SiCard10, SIAC, SiCard11 all share series 0x0F upstream — disambiguation is by
// number range, not by series byte. fCard upstream is still TODO.
export const ModernSiCardSeries = {
  SiCard9: 0x01,
  SiCard8: 0x02,
  pCard: 0x04,
  tCard: 0x06,
  fCard: 0x0e,
  SiCard10: 0x0f,
  SIAC: 0x0f,
} as const;
export type ModernSiCardSeriesKey = keyof typeof ModernSiCardSeries;

export interface PotentialModernSiCardPunch {
  code: number | undefined;
  time: number | null | undefined;
}

export const getPunchOffset = (i: number): number => bytesPerPage * 4 + i * 4;

export const cropPunches = (allPunches: (PotentialModernSiCardPunch | undefined)[]): IPunch[] => {
  const isPunchEntryValid = (punch: PotentialModernSiCardPunch | undefined): punch is IPunch =>
    punch !== undefined &&
    punch.code !== undefined &&
    punch.time !== undefined &&
    punch.time !== null;
  const firstInvalidIndex = allPunches.findIndex((punch) => !isPunchEntryValid(punch));
  const punchesUntilInvalid =
    firstInvalidIndex === -1 ? allPunches : allPunches.slice(0, firstInvalidIndex);
  return punchesUntilInvalid.filter(isPunchEntryValid);
};

export const getCroppedString = (charCodes: (number | undefined)[]): string => {
  const isCharacterInvalid = (charCode: number | undefined): boolean =>
    charCode === undefined || charCode === 0xee;
  const firstInvalidIndex = charCodes.findIndex(isCharacterInvalid);
  const croppedCharCodes = (
    firstInvalidIndex === -1 ? charCodes : charCodes.slice(0, firstInvalidIndex)
  ) as number[];
  return croppedCharCodes.map((charCode) => String.fromCharCode(charCode)).join('');
};

export const parseCardHolderString = (
  semicolonSeparatedString: string
): { [property: string]: unknown } => {
  const c = semicolonSeparatedString.split(';');
  return {
    firstName: c.length > 1 ? c[0] : undefined,
    lastName: c.length > 2 ? c[1] : undefined,
    gender: c.length > 3 ? c[2] : undefined,
    birthday: c.length > 4 ? c[3] : undefined,
    club: c.length > 5 ? c[4] : undefined,
    email: c.length > 6 ? c[5] : undefined,
    phone: c.length > 7 ? c[6] : undefined,
    city: c.length > 8 ? c[7] : undefined,
    street: c.length > 9 ? c[8] : undefined,
    zip: c.length > 10 ? c[9] : undefined,
    country: c.length > 11 ? c[10] : undefined,
    isComplete: c.length > 11,
  };
};

export const parseCardHolder = (
  maybeCharCodes: (number | undefined)[]
): { [property: string]: unknown } => {
  const semicolonSeparatedString = getCroppedString(maybeCharCodes);
  return parseCardHolderString(semicolonSeparatedString || '');
};

export interface IModernSiCardStorageFields extends IBaseSiCardStorageFields {
  uid: number;
  cardSeries: ModernSiCardSeriesKey;
}

export const modernSiCardStorageLocations: SiStorageLocations<IModernSiCardStorageFields> = {
  uid: new SiInt([[0x03], [0x02], [0x01], [0x00]]),
  // Cast: SiEnum<T extends {[key: string]: number}> returns `keyof T | undefined`.
  // ModernSiCardSeries is narrower (keys ARE the series names), so cast the whole
  // SiEnum instance to the location's expected SiDataType<ModernSiCardSeriesKey>.
  cardSeries: new SiEnum(
    [[0x18]],
    ModernSiCardSeries as unknown as { [k: string]: number }
  ) as unknown as SiEnum<{ [k in ModernSiCardSeriesKey]: number }>,
  cardNumber: new SiModified(
    new SiArray(3, (i) => new SiInt([[0x19 + (2 - i)]])),
    (extractedValue) => arr2cardNumber(extractedValue)
  ),
  startTime: new SiTime([[0x0f], [0x0e]], 0x0c),
  finishTime: new SiTime([[0x13], [0x12]], 0x10),
  checkTime: new SiTime([[0x0b], [0x0a]], 0x08),
  // Station codes; a touch-free (PTD bit 7) record keeps its code in block 1
  // (0xa5 / 0xa9 / 0xa1), see siStationCode.
  startCode: siStationCode(0x0c, 0xa5),
  finishCode: siStationCode(0x10, 0xa9),
  checkCode: siStationCode(0x08, 0xa1),
  startTouchFree: siTouchFree(0x0c),
  finishTouchFree: siTouchFree(0x10),
  checkTouchFree: siTouchFree(0x08),
  punchCount: new SiInt([[0x16]]),
  punches: new SiModified(
    new SiArray(
      MAX_NUM_PUNCHES,
      (i) =>
        new SiDict({
          code: siPunchCode(getPunchOffset(i)),
          time: new SiTime([[getPunchOffset(i) + 3], [getPunchOffset(i) + 2]], getPunchOffset(i)),
        })
    ),
    (allPunches) => cropPunches(allPunches as (PotentialModernSiCardPunch | undefined)[])
  ),
  cardHolder: new SiModified(new SiArray(0x80, (i) => new SiInt([[0x20 + i]])), (charCodes) =>
    parseCardHolder(charCodes)
  ),
};
export const modernSiCardStorageDefinition = defineStorage(0x400, modernSiCardStorageLocations);

export class ModernSiCard extends BaseSiCard {
  static maxNumPunches = MAX_NUM_PUNCHES;

  public storage: SiStorage<IModernSiCardStorageFields>;
  public punchCount?: number;
  public cardSeries?: ModernSiCardSeriesKey;
  public uid?: number;
  protected block1Read = false;

  constructor(cardNumber: number) {
    super(cardNumber);
    this.storage = modernSiCardStorageDefinition();
  }

  // Modern card pages — RESEARCH §Card Decoders / Modern card layout.
  // Page 0 = header/metadata. Page 1 = cardholder. Pages 4-7 = punches
  // (32 punches/page). Codex review #3: punches start at page 4, NOT page 0.
  // Sequence is strictly forward; SiSendTask (Plan 04) serializes the GET_SI8
  // calls.
  typeSpecificGetPage(pageNumber: number): Promise<number[]> {
    if (!this.mainStation) {
      return Promise.reject(new Error('No main station'));
    }
    return this.mainStation
      .sendMessage({ command: proto.cmd.GET_SI8, parameters: [pageNumber] }, 1)
      .then((data: number[][]) => {
        const frame = data[0];
        if (frame === undefined) {
          throw new Error(`No response for GET_SI8 page ${pageNumber}`);
        }
        // Skip 5-byte response header: [cmd, len, addr_hi, addr_lo, page_no].
        // Page payload is 128 bytes. (Real-wire bench transcript 2026-05-13:
        // GET_SI8 response carries [addr_hi, addr_lo, page_no, ...128 data] in
        // `parameters`; the multiplexer prepends [cmd, len] = 5 header bytes
        // total. Previous slice(3) was correct only for synthetic fixtures
        // that omit the 2-byte station address.)
        return frame.slice(5);
      });
  }

  typeSpecificRead(): Promise<void> {
    return this.typeSpecificReadBasic()
      .then(() => this.typeSpecificReadCardHolder())
      .then(() => this.typeSpecificReadTouchFreeBlock())
      .then(() => this.typeSpecificReadPunches())
      .then(() => this.populateRaceResult());
  }

  typeSpecificReadBasic(): Promise<void> {
    return this.typeSpecificGetPage(0).then((page0) => {
      this.storage.splice(bytesPerPage * 0, bytesPerPage, ...page0);
    });
  }

  typeSpecificReadCardHolder(): Promise<void> {
    const cardHolderSoFar = this.storage.get('cardHolder');
    if (cardHolderSoFar && (cardHolderSoFar.value as { isComplete?: boolean }).isComplete) {
      return Promise.resolve();
    }
    return this.readBlock1();
  }

  protected readBlock1(): Promise<void> {
    return this.typeSpecificGetPage(1).then((page1) => {
      this.storage.splice(bytesPerPage * 1, bytesPerPage, ...page1);
      this.block1Read = true;
    });
  }

  /** True when a start, finish or check record in page 0 is touch-free (PTD
   * bit 7) and block 1, which holds its station code, has not been read. An
   * erased record (0xEE) has bit 7 set too, hence the time check. */
  protected needsBlock1(): boolean {
    if (this.block1Read) return false;
    return (['start', 'finish', 'check'] as const).some(
      (name) =>
        this.storage.get(`${name}TouchFree`)?.value === true &&
        this.storage.get(`${name}Time`)?.value != null
    );
  }

  typeSpecificReadTouchFreeBlock(): Promise<void> {
    if (!this.needsBlock1()) return Promise.resolve();
    return this.readBlock1();
  }

  typeSpecificReadPunches(): Promise<void> {
    const punchCount = this.storage.get('punchCount')?.value ?? 0;
    if (punchCount <= punchesPerPage * 0) {
      return Promise.resolve();
    }
    return this.typeSpecificGetPage(0x04)
      .then((page4) => {
        this.storage.splice(bytesPerPage * 4, bytesPerPage, ...page4);
        if ((this.storage.get('punchCount')?.value ?? 0) <= punchesPerPage * 1) {
          throw new ReadFinishedException();
        }
        return this.typeSpecificGetPage(0x05);
      })
      .then((page5) => {
        this.storage.splice(bytesPerPage * 5, bytesPerPage, ...page5);
        if ((this.storage.get('punchCount')?.value ?? 0) <= punchesPerPage * 2) {
          throw new ReadFinishedException();
        }
        return this.typeSpecificGetPage(0x06);
      })
      .then((page6) => {
        this.storage.splice(bytesPerPage * 6, bytesPerPage, ...page6);
        if ((this.storage.get('punchCount')?.value ?? 0) <= punchesPerPage * 3) {
          throw new ReadFinishedException();
        }
        return this.typeSpecificGetPage(0x07);
      })
      .then((page7) => {
        this.storage.splice(bytesPerPage * 7, bytesPerPage, ...page7);
        throw new ReadFinishedException();
      })
      .catch((exc: unknown) => {
        if (exc instanceof ReadFinishedException) return;
        throw exc;
      });
  }

  /** Test-only: splice raw storage bytes (page 0..page 7 concatenated, or any
   * prefix) into the SiStorage buffer and populate the raceResult. Bypasses
   * the mainStation so fixture replay doesn't need a mock transport. */
  _decodeFromStorage(storageBytes: (number | undefined)[]): void {
    // Splice in chunks so an undefined-tail (e.g. tests that only ship page 0)
    // doesn't blow size limits.
    const limit = Math.min(storageBytes.length, 0x400);
    for (let i = 0; i < limit; i++) {
      // Use a 1-element splice (replaces one byte in-place); preserves length.
      this.storage.splice(i, 1, storageBytes[i] as number);
    }
    this.populateRaceResult();
  }

  protected populateRaceResult(): void {
    const cn = this.storage.get('cardNumber')?.value;
    if (cn !== undefined) {
      this.raceResult.cardNumber = cn;
    }
    const startTime = this.storage.get('startTime')?.value;
    if (startTime !== undefined) this.raceResult.startTime = startTime;
    const startCode = this.storage.get('startCode')?.value;
    if (startTime != null && startCode !== undefined) this.raceResult.startCode = startCode;
    if (this.storage.get('startTouchFree')?.value === true && startTime != null)
      this.raceResult.startTouchFree = true;
    const finishTime = this.storage.get('finishTime')?.value;
    if (finishTime !== undefined) this.raceResult.finishTime = finishTime;
    const finishCode = this.storage.get('finishCode')?.value;
    if (finishTime != null && finishCode !== undefined) this.raceResult.finishCode = finishCode;
    if (this.storage.get('finishTouchFree')?.value === true && finishTime != null)
      this.raceResult.finishTouchFree = true;
    const checkTime = this.storage.get('checkTime')?.value;
    if (checkTime !== undefined) this.raceResult.checkTime = checkTime;
    const checkCode = this.storage.get('checkCode')?.value;
    if (checkTime != null && checkCode !== undefined) this.raceResult.checkCode = checkCode;
    if (this.storage.get('checkTouchFree')?.value === true && checkTime != null)
      this.raceResult.checkTouchFree = true;
    const punches = this.storage.get('punches')?.value;
    if (punches !== undefined) this.raceResult.punches = punches as IPunch[];
    const cardHolder = this.storage.get('cardHolder')?.value;
    if (cardHolder !== undefined) {
      this.raceResult.cardHolder = cardHolder as { [k: string]: unknown };
    }
    const punchCount = this.storage.get('punchCount')?.value;
    if (punchCount !== undefined) this.punchCount = punchCount;
    const cardSeries = this.storage.get('cardSeries')?.value;
    if (cardSeries !== undefined) this.cardSeries = cardSeries;
    const uid = this.storage.get('uid')?.value;
    if (uid !== undefined) this.uid = uid;
  }
}
