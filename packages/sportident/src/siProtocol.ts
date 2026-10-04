// Ported from allestuetsmerweh/sportident.js — packages/sportident/src/siProtocol.ts
// Upstream: https://github.com/allestuetsmerweh/sportident.js (MIT License)
// Local modifications:
//   - Stripped lodash (`_.isEqual` -> direct byte comparison, CRCs are always 2 bytes).
//   - No enums (upstream already enum-free here).
//   - Replaced upstream's stdout warning on CRC mismatch and bad-ETX with a structured
//     frame-error channel: `parseAll(input, {onFrameError})` accepts a typed callback;
//     `parse` itself stays pure (no console output, no callback invocation) and surfaces
//     bad CRC by returning `{message: null, remainder: <after consumed bytes>}` so that
//     `parseAll` is the single place that synthesizes the `FrameError` payload.
//   - SiTime added back in Plan 03 once `storage/*` was ported (Plan 02 left it out
//     because it depended on SiDataType). SiTime here is the storage-backed half-day
//     clock primitive consumed by the card decoders; it returns a `SiTimestamp =
//     number | null` (raw seconds-in-half-day, matching upstream's fixture shape —
//     full wall-clock reconstruction needs the event date and is Phase 1's job).
//   - SiCard11/PCard cardNumber path retained from upstream (4-byte arr2cardNumber).
// See packages/sportident/NOTICE.md for cumulative attribution.

import { proto } from './constants.ts';
import { SiInt } from './storage/SiInt.ts';
import { SiDataType, type SiStorageData } from './storage/SiDataType.ts';
import { arr2big, assertArrIsOfLengths, assertIsByteArr, prettyHex } from './utils/bytes.ts';

export const SI_TIME_CUTOFF = 43200; // Half a day in seconds.

// --- Date / cardNumber helpers ----------------------------------------------

export const arr2date = (arr: number[], asOf?: Date): Date | undefined => {
  assertIsByteArr(arr);
  assertArrIsOfLengths(arr, [3, 6, 7]);
  if ((arr[0] as number) > 99) return undefined;
  if (arr[1] === 0) return undefined;
  const maxYear = asOf ? asOf.getUTCFullYear() : new Date().getUTCFullYear();
  const getYear = (lastTwoDigits: number): number => {
    const maxLastTwo = maxYear % 100;
    const maxRest = maxYear - maxLastTwo;
    if (lastTwoDigits <= maxLastTwo) return lastTwoDigits + maxRest;
    return lastTwoDigits + maxRest - 100;
  };
  const year = getYear(arr[0] as number);
  const month = (arr[1] as number) - 1;
  const day = arr[2] as number;
  const secs = arr.length < 6 ? 0 : arr2big(arr.slice(4, 6));
  const hours = arr.length < 6 ? 0 : ((arr[3] as number) & 0x01) * 12 + Math.floor(secs / 3600);
  const minutes = arr.length < 6 ? 0 : Math.floor((secs % 3600) / 60);
  const seconds = arr.length < 6 ? 0 : secs % 60;
  const milliseconds = arr.length < 7 ? 0 : ((arr[6] as number) * 1000) / 256;
  const date = new Date(year, month, day, hours, minutes, seconds, milliseconds);
  const isValidDate =
    date.getFullYear() === year &&
    date.getMonth() === month &&
    date.getDate() === day &&
    date.getHours() === hours &&
    date.getMinutes() === minutes &&
    date.getSeconds() === seconds &&
    date.getMilliseconds() === Math.floor(milliseconds);
  if (!isValidDate) return undefined;
  return date;
};

export const date2arr = (dateTime: Date): number[] => {
  const secs =
    (dateTime.getHours() % 12) * 3600 + dateTime.getMinutes() * 60 + dateTime.getSeconds();
  return [
    dateTime.getFullYear() % 100,
    dateTime.getMonth() + 1,
    dateTime.getDate(),
    (dateTime.getDay() << 1) + Math.floor(dateTime.getHours() / 12),
    secs >> 8,
    secs & 0xff,
    Math.floor((dateTime.getMilliseconds() * 256) / 1000),
  ];
};

export const arr2cardNumber = (arr: (number | undefined)[]): number | undefined => {
  if (arr.some((byte) => byte === undefined)) return undefined;
  assertIsByteArr(arr);
  assertArrIsOfLengths(arr, [3, 4]);
  let cardnum = ((arr[1] as number) << 8) | (arr[0] as number);
  const fourthSet = arr.length === 4 && (arr[3] as number) !== 0x00;
  if (fourthSet || 4 < (arr[2] as number)) {
    cardnum |= (arr[2] as number) << 16;
  } else {
    cardnum += (arr[2] as number) * 100000;
  }
  if (arr.length === 4) {
    cardnum |= (arr[3] as number) << 24;
  }
  return cardnum;
};

export const cardNumber2arr = (cardNumber: number | undefined): (number | undefined)[] => {
  if (cardNumber === undefined) return [undefined, undefined, undefined, undefined];
  const arr2 =
    cardNumber < 500000 ? Math.floor(cardNumber / 100000) & 0xff : (cardNumber >> 16) & 0xff;
  const newCardNumber = cardNumber < 500000 ? cardNumber - arr2 * 100000 : cardNumber;
  return [newCardNumber & 0xff, (newCardNumber >> 8) & 0xff, arr2, (newCardNumber >> 24) & 0xff];
};

// --- Message types ----------------------------------------------------------

export interface SiMessageWithMode {
  mode: number;
}

export interface SiMessageWithoutMode {
  mode?: undefined;
  command: number;
  parameters: number[];
}

export type SiMessage = SiMessageWithMode | SiMessageWithoutMode;

export const prettyMessage = (message: SiMessage): string => {
  if (message.mode !== undefined) {
    return `Mode: ${prettyHex([message.mode])} (${message.mode})\n`;
  }
  const prettyCommand = `Command: ${prettyHex([message.command])} (${message.command})\n`;
  const prettyParameters = `Parameters: ${prettyHex(message.parameters)} (${JSON.stringify(message.parameters)})`;
  return `${prettyCommand}${prettyParameters}`;
};

// --- CRC16 (RESEARCH §"CRC16-CCITT 0x8005 Parameters") ----------------------

export const CRC16 = (str: number[]): [number, number] => {
  const CRC_POLYNOM = 0x8005;
  const CRC_BITF = 0x8000;
  // Inputs < 3 bytes: return bytes as-is (or 0x00 padding).
  if (str.length < 3) {
    return [
      1 <= str.length ? (str[0] as number) : 0x00,
      2 <= str.length ? (str[1] as number) : 0x00,
    ];
  }
  // Pad to even length with 0x00 bytes.
  const s = str.length % 2 === 0 ? str.concat([0x00, 0x00]) : str.concat([0x00]);
  // Init CRC from first two bytes (non-standard).
  let crc = (s[0] as number) * 0x100 + (s[1] as number);
  for (let i = 2; i < s.length; i += 2) {
    const c = s.slice(i, i + 2);
    let val = (c[0] as number) * 0x100 + (c[1] as number);
    for (let j = 0; j < 16; j++) {
      if ((crc & CRC_BITF) !== 0) {
        crc = crc << 1;
        if ((val & CRC_BITF) !== 0) crc += 1;
        crc = crc ^ CRC_POLYNOM;
      } else {
        crc = crc << 1;
        if ((val & CRC_BITF) !== 0) crc += 1;
      }
      val = val << 1;
    }
    crc = crc & 0xffff;
  }
  return [crc >> 8, crc & 0xff]; // MSB-first
};

// --- Frame error channel (codex review #1, HIGH) ----------------------------

/**
 * Structured frame-error payload. Replaces upstream's stdout warn-line so callers
 * downstream (Plan 04 multiplexer, Plan 05 NDJSON bridge) can route the failure
 * without intercepting stdout/stderr.
 */
export type FrameErrorCode =
  'crc_mismatch' | 'bad_etx' | 'bad_stx' | 'truncated' | 'buffer_overflow';

export interface FrameError {
  error_code: FrameErrorCode;
  /** The bytes that were consumed / dropped while detecting the error. */
  raw_bytes: number[];
  /** How many bytes parseAll advanced past while handling this error. */
  bytes_consumed: number;
  /** Present when `error_code === 'crc_mismatch'`. */
  expected_crc?: [number, number];
  /** Present when `error_code === 'crc_mismatch'`. */
  actual_crc?: [number, number];
}

export interface ParseAllOptions {
  onFrameError?: (err: FrameError) => void;
}

// --- parse / parseAll / render ----------------------------------------------

/**
 * `null` rather than `undefined` matches upstream's shape (and lets call sites
 * use a `null` short-circuit). We export `SiMessage | null` so callers can
 * destructure `const {message, remainder} = parse(buf)` exactly.
 */
export interface SiMessageParseResult {
  message: SiMessage | null;
  remainder: number[];
  /**
   * Set when `parse` consumed bytes that constituted a complete frame but the
   * frame failed validation (currently: CRC mismatch). `parseAll` inspects this
   * to synthesize the typed `FrameError` payload. Internal field — not part of
   * the stable public shape callers should rely on.
   */
  badFrame?: {
    code: 'crc_mismatch' | 'bad_etx';
    rawBytes: number[];
    bytesConsumed: number;
    expectedCrc?: [number, number];
    actualCrc?: [number, number];
  };
}

/**
 * Parse a single message from the head of `inputData`.
 *
 * Behaviors:
 * - Bare ACK/NAK/WAKEUP single bytes → `{message: {mode}, remainder: rest}`.
 * - Happy-path frame `[STX, CMD, LEN, ...DATA, crc_hi, crc_lo, ETX]` → `{message, remainder}`.
 * - Truncated frame (any prefix shorter than complete) → `{message: null, remainder: inputData}`
 *   (FULL input returned so the multiplexer can buffer-and-retry on next chunk).
 * - Bad STX (leading byte not STX/ACK/NAK/WAKEUP) → drop that one byte, return remainder
 *   (caller `parseAll` re-runs from the new head).
 * - Bad ETX → drop one byte, return remainder, `badFrame.code = 'bad_etx'`.
 * - Bad CRC → consume the full frame, return remainder past it, `badFrame.code = 'crc_mismatch'`
 *   with computed expected/actual CRCs and the raw frame bytes.
 *
 * `parse` is PURE — never invokes a callback, never writes to stdout/stderr.
 */
export const parse = (inputData: number[]): SiMessageParseResult => {
  const failAndProceed = (numBytes: number): SiMessageParseResult => ({
    message: null,
    remainder: inputData.slice(numBytes),
  });
  const specialModeAndProceed = (mode: number, numBytes: number): SiMessageParseResult => ({
    message: { mode },
    remainder: inputData.slice(numBytes),
  });

  if (inputData.length <= 0) return failAndProceed(0);
  if (inputData[0] === proto.WAKEUP) return specialModeAndProceed(proto.WAKEUP, 1);
  if (inputData[0] === proto.ACK) return specialModeAndProceed(proto.ACK, 1);
  if (inputData[0] === proto.NAK) return specialModeAndProceed(proto.NAK, 1);
  if (inputData[0] !== proto.STX) {
    // Skip a single garbage byte. Upstream emits a warn-line here; we stay
    // silent — `parseAll` is the single place that can surface bad-byte errors.
    return failAndProceed(1);
  }
  if (inputData.length <= 1) return failAndProceed(0);
  const command = inputData[1] as number;
  if (inputData.length <= 2) return failAndProceed(0);
  const numParameters = inputData[2] as number;
  if (inputData.length <= 2 + numParameters) return failAndProceed(0);
  const parameters = inputData.slice(3, 3 + numParameters);
  if (inputData.length <= 4 + numParameters) return failAndProceed(0);
  if (inputData.length <= 5 + numParameters) return failAndProceed(0);
  if (inputData[5 + numParameters] !== proto.ETX) {
    // Bad ETX: drop one byte and surface as a structured bad_etx via badFrame.
    // (Upstream emits a warn-line here.)
    return {
      message: null,
      remainder: inputData.slice(1),
      badFrame: {
        code: 'bad_etx',
        rawBytes: inputData.slice(0, 1),
        bytesConsumed: 1,
      },
    };
  }
  const expectedCRC = CRC16(inputData.slice(1, 3 + numParameters));
  const actualCRCArr = inputData.slice(3 + numParameters, 5 + numParameters);
  const actualCRC: [number, number] = [actualCRCArr[0] as number, actualCRCArr[1] as number];
  // Lodash strip: CRCs are always exactly 2 bytes, so direct comparison suffices.
  if (actualCRC[0] !== expectedCRC[0] || actualCRC[1] !== expectedCRC[1]) {
    const consumed = 6 + numParameters;
    return {
      message: null,
      remainder: inputData.slice(consumed),
      badFrame: {
        code: 'crc_mismatch',
        rawBytes: inputData.slice(0, consumed),
        bytesConsumed: consumed,
        expectedCrc: expectedCRC,
        actualCrc: actualCRC,
      },
    };
  }
  return {
    message: { command, parameters },
    remainder: inputData.slice(6 + numParameters),
  };
};

export interface SiMessagesParseResult {
  messages: SiMessage[];
  remainder: number[];
}

/**
 * Drain `inputData` into zero-or-more `SiMessage`s plus a leftover remainder.
 *
 * - Bad-CRC frames invoke `opts.onFrameError` exactly once per occurrence with a
 *   typed `FrameError` payload (`error_code: 'crc_mismatch'`, expected/actual CRCs,
 *   raw bytes, bytes_consumed). Omitting the callback is permitted and produces
 *   no side effects (silent drop) — matches the documented behavior.
 * - Bad-ETX frames likewise invoke the callback with `error_code: 'bad_etx'`.
 * - Stray garbage bytes (non-STX/ACK/NAK/WAKEUP) are silently skipped; no
 *   callback fires for those, matching the plan's "ONLY when the entire
 *   remainder is consumed without finding a valid STX" wording (Phase 0
 *   currently never triggers that path since stray bytes just advance past).
 *
 * NEVER writes to stdout/stderr from this module.
 */
export const parseAll = (
  inputData: number[],
  opts: ParseAllOptions = {}
): SiMessagesParseResult => {
  let currentRemainder = inputData;
  const messages: SiMessage[] = [];
  let remainderWasShrinking = true;
  while (remainderWasShrinking) {
    const result = parse(currentRemainder);
    remainderWasShrinking = result.remainder.length < currentRemainder.length;
    if (result.badFrame && opts.onFrameError) {
      const bf = result.badFrame;
      const err: FrameError = {
        error_code: bf.code,
        raw_bytes: bf.rawBytes,
        bytes_consumed: bf.bytesConsumed,
      };
      if (bf.expectedCrc) err.expected_crc = bf.expectedCrc;
      if (bf.actualCrc) err.actual_crc = bf.actualCrc;
      opts.onFrameError(err);
    }
    if (result.message) {
      messages.push(result.message);
    }
    currentRemainder = result.remainder;
  }
  return { messages, remainder: currentRemainder };
};

export const render = (message: SiMessage): number[] => {
  const renderCommand = (m: SiMessageWithoutMode): number[] => {
    const commandString = [m.command, m.parameters.length, ...m.parameters];
    const crc = CRC16(commandString);
    return [proto.STX, ...commandString, ...crc, proto.ETX];
  };
  if (message.mode === undefined) return renderCommand(message);
  const renderFunctionsByMode: { [key: number]: () => number[] } = {
    [proto.WAKEUP]: () => [proto.WAKEUP],
    [proto.NAK]: () => [proto.NAK],
    [proto.ACK]: () => [proto.ACK],
  };
  const renderFunction = renderFunctionsByMode[message.mode];
  if (renderFunction === undefined) {
    throw new Error(`Cannot render with mode ${prettyHex([message.mode])}`);
  }
  return renderFunction();
};

// --- SiTime / SiTimestamp ---------------------------------------------------
// SiTime models the half-day clock primitive on every SI card (seconds since
// midnight or midday, 0..43199). Cards with a PTD byte (SI6, SI8+) also say
// AM or PM; given that byte, SiTime returns seconds since midnight instead. `null` represents `proto.NO_TIME` (0xEEEE)
// which means "no punch yet". Wall-clock reconstruction needs the event date
// and is Phase 1's job — Phase 0 emits raw seconds.
//
// Ported from upstream `siProtocol.ts` L335-399. Read-only (no update path);
// no lodash; constructor accepts the same `[[lo],[hi]]` byte-part shape upstream
// uses so the card decoder storage locations port verbatim.

export type SiTimestamp = number | null;

export class SiTime extends SiDataType<SiTimestamp> {
  private readonly intField: SiInt | undefined;
  private readonly ptdField: SiInt | undefined;
  public intParts: [[number], [number]] | undefined;

  /**
   * `ptdOffset` is the PTD byte of the punch record on cards that have one
   * (SI6, SI8 and later; not SI5). Its bit 0 is the PM flag, so a PM time
   * comes back as seconds since midnight (43200..86399) — which
   * `toHalfDayClock` then splits into `half_day: 1`.
   */
  constructor(intParts: [[number], [number]] | undefined, ptdOffset?: number) {
    super();
    this.intParts = intParts;
    this.intField = intParts === undefined ? undefined : new SiInt(intParts);
    this.ptdField = ptdOffset === undefined ? undefined : new SiInt([[ptdOffset]]);
  }

  typeSpecificExtractFromData(data: SiStorageData): SiTimestamp | undefined {
    if (this.intField === undefined) return null;
    const timeInt = this.intField.typeSpecificExtractFromData(data);
    if (timeInt === proto.NO_TIME) return null;
    if (timeInt === undefined || timeInt > SI_TIME_CUTOFF) return undefined;
    const ptd = this.ptdField?.typeSpecificExtractFromData(data);
    return ptd !== undefined && (ptd & 0x01) === 1 ? timeInt + SI_TIME_CUTOFF : timeInt;
  }
}
