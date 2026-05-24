// Authored for fartola. Not ported from upstream.
//
// BSF8 check-unit backup memory readout protocol.
//
// Implements readBackupMemory: reads the check-unit's backup memory by
// issuing GET_SYS_VAL to get the memory pointer, then looping GET_BACKUP
// in 128-byte blocks until the pointer is consumed.
//
// Source: pcprog5.pdf §3 + BSx7_8_readbackup.txt (backup record layout).
// Re-authored against the public spec — not ported from any prior code.
//
// T-02.1-11 (STRIDE DoS threat — loop cap): MAX_ITERATIONS = 512 caps the
// loop to prevent an infinite loop on a malformed memory pointer from the
// hardware.
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-06-PLAN.md task 1
// - REQ-OPS-004

import { proto } from '../constants.ts';
import type { ISiStation } from './ISiStation.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Size of each GET_BACKUP response block in bytes. */
export const BLOCK_SIZE = 128;

/** Hard cap on GET_BACKUP iterations (T-02.1-11 DoS mitigation).
 * BSF8 has max 32 KB backup memory → 256 blocks; we cap at 2× for safety. */
export const MAX_ITERATIONS = 512;

// Offsets into the GET_SYS_VAL response parameters (128-byte config blob).
//
// Byte 0x1B: bit 0 = overflow flag (memory wrapped around and old records
//   were overwritten).
// Bytes 0x1C..0x1F: big-endian uint32 current write pointer (number of bytes
//   written to backup memory since last erase).
const OVERFLOW_FLAG_OFFSET = 0x1b;
const MEM_POINTER_OFFSET = 0x1c; // 4 bytes big-endian

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single record read from the check-unit's backup memory. */
export interface BackupRecord {
  /** SI card number (non-zero; zero-card records are skipped). */
  cardNumber: number;
  /** Punch timestamp as a half-day clock value, or null if time bytes are
   * absent or zero. */
  punchTime: { secondsInHalfDay: number; halfDay: number } | null;
}

// ---------------------------------------------------------------------------
// Pure parsing helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Parse a GET_BACKUP response block into BackupRecord[].
 *
 * Each record occupies `recLen` bytes within the block at a fixed stride.
 * Card number: big-endian uint32 at bytes BC_CN..BC_CN+3 within the record
 *   (proto.BC_CN = 3).
 * Time: bytes 0..1 = secondsInHalfDay (big-endian uint16);
 *       byte 2 bit 0 = halfDay flag.
 * Records with cardNumber === 0 are empty slots and are skipped.
 * If the block is shorter than one complete record the result is empty.
 *
 * @param block  Raw bytes from the GET_BACKUP response.
 * @param recLen Bytes per record (default proto.REC_LEN = 8).
 */
export function parseBackupBlock(block: Uint8Array, recLen: number): BackupRecord[] {
  const records: BackupRecord[] = [];
  const count = Math.floor(block.length / recLen);
  for (let i = 0; i < count; i++) {
    const offset = i * recLen;
    const cnOffset = offset + proto.BC_CN;
    // Guard: ensure all 4 card-number bytes are within bounds.
    if (cnOffset + 3 >= block.length) break;
    const cardNumber =
      ((block[cnOffset]! << 24) |
        (block[cnOffset + 1]! << 16) |
        (block[cnOffset + 2]! << 8) |
        block[cnOffset + 3]!) >>>
      0; // >>> 0 ensures unsigned 32-bit
    if (cardNumber === 0) continue; // empty slot

    // Time: bytes 0..2 within the record.
    const secondsInHalfDay = ((block[offset]! << 8) | block[offset + 1]!) >>> 0;
    const halfDay = block[offset + 2]! & 0x01;
    const punchTime =
      secondsInHalfDay === 0 && halfDay === 0 ? null : { secondsInHalfDay, halfDay };

    records.push({ cardNumber, punchTime });
  }
  return records;
}

/**
 * Extract the current memory write pointer from a GET_SYS_VAL response.
 * The pointer is a big-endian uint32 at bytes 0x1C..0x1F of the params array.
 */
export function parseMemPointer(sysValParams: number[]): number {
  const b0 = sysValParams[MEM_POINTER_OFFSET] ?? 0;
  const b1 = sysValParams[MEM_POINTER_OFFSET + 1] ?? 0;
  const b2 = sysValParams[MEM_POINTER_OFFSET + 2] ?? 0;
  const b3 = sysValParams[MEM_POINTER_OFFSET + 3] ?? 0;
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}

/**
 * Extract the overflow flag from a GET_SYS_VAL response.
 * Returns true if bit 0 of byte 0x1B is set (memory wrapped around).
 */
export function parseOverflowFlag(sysValParams: number[]): boolean {
  return ((sysValParams[OVERFLOW_FLAG_OFFSET] ?? 0) & 0x01) !== 0;
}

// ---------------------------------------------------------------------------
// Main readout function
// ---------------------------------------------------------------------------

/**
 * Read all backup records from the check-unit's backup memory.
 *
 * Protocol:
 *   1. Send GET_SYS_VAL(0, 128) — returns 128-byte config blob with the
 *      current memory pointer and overflow flag.
 *   2. Compute how many 128-byte blocks to read: ceil(memPointer / BLOCK_SIZE).
 *   3. Loop GET_BACKUP(blockIndex, BLOCK_SIZE) for each block.
 *   4. Cap at MAX_ITERATIONS blocks (T-02.1-11 DoS mitigation). If the loop
 *      hits the cap, set overflow=true in the result.
 *
 * @param station  Any ISiStation (SiMainStation or test double).
 * @returns Object with parsed records and flags.
 */
export async function readBackupMemory(station: ISiStation): Promise<{
  records: BackupRecord[];
  overflow: boolean;
}> {
  // Step 1: GET_SYS_VAL — returns the 128-byte config blob.
  // Parameters: start offset 0, length 128.
  const sysValResponses = await station.sendMessage(
    { command: proto.cmd.GET_SYS_VAL, parameters: [0x00, 0x00, 0x80] },
    1
  );
  const sysValParams = sysValResponses[0] ?? [];

  const memPointer = parseMemPointer(sysValParams);
  const hwOverflow = parseOverflowFlag(sysValParams);

  if (memPointer === 0) {
    // Empty backup memory.
    return { records: [], overflow: hwOverflow };
  }

  // Step 2: Calculate block count.
  const blocksNeeded = Math.ceil(memPointer / BLOCK_SIZE);
  const loopCapped = blocksNeeded > MAX_ITERATIONS;
  const blockCount = loopCapped ? MAX_ITERATIONS : blocksNeeded;

  // Step 3: Loop GET_BACKUP.
  const allRecords: BackupRecord[] = [];
  for (let i = 0; i < blockCount; i++) {
    const byteOffset = i * BLOCK_SIZE;
    // GET_BACKUP parameters: 3-byte address (big-endian) + 1-byte length.
    const addrHi = (byteOffset >>> 16) & 0xff;
    const addrMid = (byteOffset >>> 8) & 0xff;
    const addrLo = byteOffset & 0xff;
    const backupResponses = await station.sendMessage(
      {
        command: proto.cmd.GET_BACKUP,
        parameters: [addrHi, addrMid, addrLo, BLOCK_SIZE],
      },
      1
    );
    const blockParams = backupResponses[0] ?? [];
    const block = new Uint8Array(blockParams);
    const records = parseBackupBlock(block, proto.REC_LEN);
    allRecords.push(...records);
  }

  return { records: allRecords, overflow: hwOverflow || loopCapped };
}
