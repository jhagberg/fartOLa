// Authored for fartola. Not ported from upstream.
//
// Tests for readBackupMemory — BSF8 check-unit backup readout protocol.
// All tests use synthetic byte fixtures; no real hardware required.
//
// Covers:
//   1) parseBackupBlock: 2 known card numbers extracted from a 128-byte block
//   2) parseBackupBlock: all-zero block returns empty array
//   3) parseBackupBlock: partial block (last record truncated) returns only complete records
//   4) parseMemPointer: extracts memory pointer from synthetic GET_SYS_VAL response
//   5) parseOverflowFlag: detects overflow bit from synthetic response
//   6) readBackupMemory: calls GET_SYS_VAL once, then GET_BACKUP in 128-byte chunks
//   7) readBackupMemory: memPointer > MAX_ITERATIONS * BLOCK_SIZE → overflow=true
//
// T-02.1-11 (STRIDE DoS threat): loop cap at MAX_ITERATIONS prevents infinite
// loops on malformed memory pointers.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { proto } from '../constants.ts';
import {
  parseBackupBlock,
  parseMemPointer,
  parseOverflowFlag,
  readBackupMemory,
  BLOCK_SIZE,
  MAX_ITERATIONS,
  type BackupRecord,
} from './readBackup.ts';
import type { ISiStation } from './ISiStation.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a 128-byte backup block with REC_LEN=8 stride.
 * Each entry in `records` is [cardNumber, secondsInHalfDay, halfDay].
 * Remaining slots are zeroed. */
function makeBlock(
  records: Array<{ cardNumber: number; secondsInHalfDay?: number; halfDay?: number }>
): Uint8Array {
  const block = new Uint8Array(128);
  const recLen = proto.REC_LEN; // 8
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (!rec) continue;
    const offset = i * recLen;
    if (offset + recLen > 128) break;
    // Card number at bytes BC_CN..BC_CN+3 (big-endian uint32).
    // proto.BC_CN = 3, so bytes 3..6 within the record.
    const cn = rec.cardNumber;
    block[offset + proto.BC_CN + 0] = (cn >>> 24) & 0xff;
    block[offset + proto.BC_CN + 1] = (cn >>> 16) & 0xff;
    block[offset + proto.BC_CN + 2] = (cn >>> 8) & 0xff;
    block[offset + proto.BC_CN + 3] = cn & 0xff;
    // Time at bytes BC_TIME..BC_TIME+2 (offset 8 within record, but record is 8 bytes,
    // so BC_TIME (8) is beyond one record — store time in bytes 0..2 of the record).
    // Per spec: bytes 0..2 = time (halfDay at bit 0 of byte 2, seconds in bytes 0..1).
    const secs = rec.secondsInHalfDay ?? 0;
    const hd = rec.halfDay ?? 0;
    block[offset + 0] = (secs >>> 8) & 0xff;
    block[offset + 1] = secs & 0xff;
    block[offset + 2] = hd & 0x01;
  }
  return block;
}

/** Synthesise a minimal GET_SYS_VAL response parameters array (128 bytes of
 * config data). The memory pointer lives at offset 0x1C..0x1F (big-endian
 * uint32); the overflow flag is bit 0 of byte 0x1B. */
function makeSysValParams(memPointer: number, overflow = false): number[] {
  const params = new Array<number>(128).fill(0);
  // Memory pointer at bytes 0x1C..0x1F (big-endian).
  params[0x1c] = (memPointer >>> 24) & 0xff;
  params[0x1d] = (memPointer >>> 16) & 0xff;
  params[0x1e] = (memPointer >>> 8) & 0xff;
  params[0x1f] = memPointer & 0xff;
  // Overflow flag: bit 0 of byte 0x1B.
  if (overflow) params[0x1b] = 0x01;
  return params;
}

/** Build a raw frame as a number[] that SiMainStation.sendMessage returns.
 * Returns [[...params]] (single response frame, params only). */
function makeSysValResponse(memPointer: number, overflow = false): number[][] {
  return [makeSysValParams(memPointer, overflow)];
}

/** Build a GET_BACKUP response: a 128-byte block wrapped as params. */
function makeBackupResponse(block: Uint8Array): number[][] {
  return [Array.from(block)];
}

// ---------------------------------------------------------------------------
// Mock station
// ---------------------------------------------------------------------------

interface MockCall {
  command: number;
  parameters: number[];
}

/** Minimal ISiStation mock: returns pre-programmed responses in order.
 * Throws if called more times than responses are available. */
function makeMockStation(responses: number[][][]): {
  station: ISiStation;
  calls: MockCall[];
} {
  const calls: MockCall[] = [];
  let idx = 0;
  const station: ISiStation = {
    sendMessage(message) {
      calls.push({ command: message.command, parameters: message.parameters ?? [] });
      const resp = responses[idx++];
      if (resp === undefined) {
        return Promise.reject(new Error(`MockStation: no response for call #${idx}`));
      }
      return Promise.resolve(resp);
    },
  };
  return { station, calls };
}

// ---------------------------------------------------------------------------
// Test 1: parseBackupBlock — 2 known card numbers
// ---------------------------------------------------------------------------

describe('backup', () => {
  test('Test 1: parseBackupBlock extracts 2 known card numbers', () => {
    const block = makeBlock([
      { cardNumber: 1428824, secondsInHalfDay: 36000, halfDay: 0 },
      { cardNumber: 7501853, secondsInHalfDay: 36060, halfDay: 0 },
    ]);
    const records = parseBackupBlock(block, proto.REC_LEN);
    assert.equal(records.length, 2);
    assert.equal(records[0]!.cardNumber, 1428824);
    assert.equal(records[1]!.cardNumber, 7501853);
    assert.ok(records[0]!.punchTime !== null);
    assert.equal(records[0]!.punchTime!.secondsInHalfDay, 36000);
    assert.equal(records[0]!.punchTime!.halfDay, 0);
  });

  // -------------------------------------------------------------------------
  // Test 2: parseBackupBlock — all-zero block → empty array
  // -------------------------------------------------------------------------

  test('Test 2: parseBackupBlock with all-zero block returns empty array', () => {
    const block = new Uint8Array(128);
    const records = parseBackupBlock(block, proto.REC_LEN);
    assert.equal(records.length, 0);
  });

  // -------------------------------------------------------------------------
  // Test 3: parseBackupBlock — partial block (truncated last record)
  // -------------------------------------------------------------------------

  test('Test 3: parseBackupBlock skips truncated last record', () => {
    // Build a block where exactly 1 complete record fits, last bytes truncated.
    const block = makeBlock([{ cardNumber: 248215 }]);
    // Truncate to just 10 bytes — only 1 complete record at REC_LEN=8 fits.
    const partial = block.slice(0, 10);
    const records = parseBackupBlock(partial, proto.REC_LEN);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.cardNumber, 248215);
  });

  // -------------------------------------------------------------------------
  // Test 4: parseMemPointer extracts memory pointer from GET_SYS_VAL response
  // -------------------------------------------------------------------------

  test('Test 4: parseMemPointer extracts memory pointer', () => {
    const params = makeSysValParams(0x00001234);
    const ptr = parseMemPointer(params);
    assert.equal(ptr, 0x1234);
  });

  // -------------------------------------------------------------------------
  // Test 5: parseOverflowFlag detects overflow bit
  // -------------------------------------------------------------------------

  test('Test 5: parseOverflowFlag detects overflow bit', () => {
    const paramsOverflow = makeSysValParams(100, true);
    const paramsNormal = makeSysValParams(100, false);
    assert.equal(parseOverflowFlag(paramsOverflow), true);
    assert.equal(parseOverflowFlag(paramsNormal), false);
  });

  // -------------------------------------------------------------------------
  // Test 6: readBackupMemory — calls GET_SYS_VAL once, then GET_BACKUP chunks
  // -------------------------------------------------------------------------

  test('Test 6: readBackupMemory calls GET_SYS_VAL once then GET_BACKUP chunks', async () => {
    // memPointer = 256 → 2 full blocks of 128 bytes.
    const memPointer = 256;

    const block1 = makeBlock([{ cardNumber: 1428824 }, { cardNumber: 7501853 }]);
    const block2 = makeBlock([{ cardNumber: 248215 }]);

    const { station, calls } = makeMockStation([
      makeSysValResponse(memPointer), // GET_SYS_VAL
      makeBackupResponse(block1), // GET_BACKUP block 0
      makeBackupResponse(block2), // GET_BACKUP block 1
    ]);

    const result = await readBackupMemory(station);
    assert.equal(result.overflow, false);
    // First call must be GET_SYS_VAL.
    assert.equal(calls[0]!.command, proto.cmd.GET_SYS_VAL);
    // Subsequent calls must be GET_BACKUP.
    assert.equal(calls[1]!.command, proto.cmd.GET_BACKUP);
    assert.equal(calls[2]!.command, proto.cmd.GET_BACKUP);
    // Three records total.
    const cardNumbers = result.records.map((r: BackupRecord) => r.cardNumber);
    assert.ok(cardNumbers.includes(1428824));
    assert.ok(cardNumbers.includes(7501853));
    assert.ok(cardNumbers.includes(248215));
  });

  // -------------------------------------------------------------------------
  // Test 7: readBackupMemory — memPointer > MAX cap → overflow=true
  // -------------------------------------------------------------------------

  test('Test 7: readBackupMemory caps loop at MAX_ITERATIONS and sets overflow=true', async () => {
    // memPointer far exceeds MAX_ITERATIONS * BLOCK_SIZE.
    const memPointer = (MAX_ITERATIONS + 10) * BLOCK_SIZE;

    // Provide MAX_ITERATIONS + 1 responses: 1 GET_SYS_VAL + MAX_ITERATIONS blocks.
    const block = makeBlock([{ cardNumber: 12345 }]);
    const responses: number[][][] = [
      makeSysValResponse(memPointer),
      ...Array.from({ length: MAX_ITERATIONS }, () => makeBackupResponse(block)),
    ];

    const { station } = makeMockStation(responses);
    const result = await readBackupMemory(station);
    assert.equal(result.overflow, true);
    // We got records from MAX_ITERATIONS blocks, each containing 1 record.
    assert.equal(result.records.length, MAX_ITERATIONS);
  });
});
