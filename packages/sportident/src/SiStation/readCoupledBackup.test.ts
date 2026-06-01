// Authored for fartola. Not ported from upstream.
//
// Tests for readCoupledBackupMemory — reading the backup memory of a BSFx
// check unit that is INDUCTIVELY COUPLED on top of a BSMx master ("mini
// reader"), per SPORTident PC Programmer's Guide v5 §2.5.
//
// All tests use a programmable mock station; no real hardware required.
//
// The coupling sequence under test:
//   1) SET_MS(0xF0) with P_MS_REMOTE (0x53) — switch master to transparent
//      mode so subsequent commands are forwarded to the coupled station.
//   2) GET_SYS_VAL + GET_BACKUP loop (forwarded to the coupled station).
//   3) SET_MS(0xF0) with P_MS_DIRECT (0x4D) — restore master mode (finally).
//
// §2.5 mandates a retry loop on NAK because the first forwarded instruction
// starts the inductive sync and frequently fails. We model a dropped-NAK as a
// per-attempt timeout (the multiplexer silently drops bare NAK frames, so a
// forwarded command that the coupled station NAKs simply doesn't resolve and
// the short per-attempt timeout fires) — the retry helper treats both
// timeout and rejection uniformly as "retry".

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { proto } from '../constants.ts';
import { readCoupledBackupMemory, parseBackupBlock, type BackupRecord } from './readBackup.ts';
import type { ISiStation } from './ISiStation.ts';
import type { SiMessage } from '../siProtocol.ts';

// ---------------------------------------------------------------------------
// Fixtures (mirror readBackup.test.ts helpers)
// ---------------------------------------------------------------------------

function makeBlock(records: Array<{ cardNumber: number }>): Uint8Array {
  const block = new Uint8Array(128);
  const recLen = proto.REC_LEN;
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (!rec) continue;
    const offset = i * recLen;
    if (offset + recLen > 128) break;
    const cn = rec.cardNumber;
    block[offset + proto.BC_CN + 0] = (cn >>> 24) & 0xff;
    block[offset + proto.BC_CN + 1] = (cn >>> 16) & 0xff;
    block[offset + proto.BC_CN + 2] = (cn >>> 8) & 0xff;
    block[offset + proto.BC_CN + 3] = cn & 0xff;
  }
  return block;
}

function makeSysValParams(memPointer: number, overflow = false): number[] {
  const params = new Array<number>(128).fill(0);
  params[0x1c] = (memPointer >>> 24) & 0xff;
  params[0x1d] = (memPointer >>> 16) & 0xff;
  params[0x1e] = (memPointer >>> 8) & 0xff;
  params[0x1f] = memPointer & 0xff;
  if (overflow) params[0x1b] = 0x01;
  return params;
}

// ---------------------------------------------------------------------------
// Programmable mock station
// ---------------------------------------------------------------------------

interface MockCall {
  command: number;
  parameters: number[];
}

/** A scripted response: either a frame to resolve, or a sentinel to reject
 * (simulating a dropped-NAK → per-attempt timeout). */
type Scripted = { kind: 'frame'; frame: number[] } | { kind: 'reject'; message: string };

/**
 * Mock that dispatches by command using per-command response queues. Each
 * call to a command consumes the next scripted response for that command;
 * when a command's queue is exhausted the LAST scripted response repeats
 * (so GET_BACKUP can be scripted once and reused across blocks).
 */
function makeMockStation(script: { [command: number]: Scripted[] }): {
  station: ISiStation;
  calls: MockCall[];
} {
  const calls: MockCall[] = [];
  const cursors = new Map<number, number>();
  const station: ISiStation = {
    sendMessage(message: SiMessage): Promise<number[][]> {
      if (!('command' in message)) {
        return Promise.reject(new Error('MockStation: expected a command-style SiMessage'));
      }
      calls.push({ command: message.command, parameters: message.parameters });
      const queue = script[message.command];
      if (!queue || queue.length === 0) {
        return Promise.reject(
          new Error(`MockStation: no script for command 0x${message.command.toString(16)}`)
        );
      }
      const idx = cursors.get(message.command) ?? 0;
      const entry = queue[Math.min(idx, queue.length - 1)]!;
      cursors.set(message.command, idx + 1);
      if (entry.kind === 'reject') return Promise.reject(new Error(entry.message));
      return Promise.resolve([entry.frame]);
    },
  };
  return { station, calls };
}

/** No-op sleep so retry tests don't actually wait. */
const noSleep = (): Promise<void> => Promise.resolve();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('coupled backup', () => {
  test('Test 1: brackets the read with SET_MS(0x53) then SET_MS(0x4D)', async () => {
    const memPointer = 128; // one block
    const block = makeBlock([{ cardNumber: 1428824 }, { cardNumber: 7501853 }]);
    const { station, calls } = makeMockStation({
      [proto.cmd.SET_MS]: [{ kind: 'frame', frame: [0x4d] }],
      [proto.cmd.GET_SYS_VAL]: [{ kind: 'frame', frame: makeSysValParams(memPointer) }],
      [proto.cmd.GET_BACKUP]: [{ kind: 'frame', frame: Array.from(block) }],
    });

    const result = await readCoupledBackupMemory(station, { sleep: noSleep });

    // First wire command must be SET_MS with the REMOTE (0x53) parameter.
    assert.equal(calls[0]!.command, proto.cmd.SET_MS);
    assert.equal(calls[0]!.parameters[0], proto.P_MS_REMOTE);
    // Last wire command must be SET_MS with the DIRECT (0x4D) parameter.
    const last = calls[calls.length - 1]!;
    assert.equal(last.command, proto.cmd.SET_MS);
    assert.equal(last.parameters[0], proto.P_MS_DIRECT);
    // Cards came back.
    const cns = result.records.map((r: BackupRecord) => r.cardNumber);
    assert.ok(cns.includes(1428824));
    assert.ok(cns.includes(7501853));
  });

  test('Test 2: retries a forwarded command on transient failure (NAK/timeout)', async () => {
    const memPointer = 128;
    const block = makeBlock([{ cardNumber: 248215 }]);
    const { station, calls } = makeMockStation({
      [proto.cmd.SET_MS]: [{ kind: 'frame', frame: [0x4d] }],
      // First GET_SYS_VAL attempt fails (inductive sync not yet established),
      // second succeeds — exactly the §2.5 scenario.
      [proto.cmd.GET_SYS_VAL]: [
        { kind: 'reject', message: 'simulated NAK/timeout' },
        { kind: 'frame', frame: makeSysValParams(memPointer) },
      ],
      [proto.cmd.GET_BACKUP]: [{ kind: 'frame', frame: Array.from(block) }],
    });

    const result = await readCoupledBackupMemory(station, { sleep: noSleep });

    const sysValCalls = calls.filter((c) => c.command === proto.cmd.GET_SYS_VAL);
    assert.equal(sysValCalls.length, 2, 'should retry GET_SYS_VAL once');
    assert.equal(result.records[0]!.cardNumber, 248215);
  });

  test('Test 3: throws after exhausting retries, but still restores direct mode', async () => {
    const { station, calls } = makeMockStation({
      [proto.cmd.SET_MS]: [{ kind: 'frame', frame: [0x4d] }],
      [proto.cmd.GET_SYS_VAL]: [{ kind: 'reject', message: 'always fails' }],
      [proto.cmd.GET_BACKUP]: [{ kind: 'frame', frame: [] }],
    });

    await assert.rejects(
      readCoupledBackupMemory(station, { sleep: noSleep, maxRetries: 3 }),
      /coupled|transparent|backup/i
    );

    // The finally block must have restored direct mode despite the throw.
    const last = calls[calls.length - 1]!;
    assert.equal(last.command, proto.cmd.SET_MS);
    assert.equal(last.parameters[0], proto.P_MS_DIRECT);
    // Exactly maxRetries GET_SYS_VAL attempts.
    assert.equal(calls.filter((c) => c.command === proto.cmd.GET_SYS_VAL).length, 3);
  });

  test('Test 4: empty coupled memory (pointer 0) returns no records, still restores', async () => {
    const { station, calls } = makeMockStation({
      [proto.cmd.SET_MS]: [{ kind: 'frame', frame: [0x4d] }],
      [proto.cmd.GET_SYS_VAL]: [{ kind: 'frame', frame: makeSysValParams(0) }],
      [proto.cmd.GET_BACKUP]: [{ kind: 'frame', frame: [] }],
    });

    const result = await readCoupledBackupMemory(station, { sleep: noSleep });
    assert.equal(result.records.length, 0);
    // No GET_BACKUP should have been sent (pointer 0 short-circuits).
    assert.equal(calls.filter((c) => c.command === proto.cmd.GET_BACKUP).length, 0);
    // Direct mode restored.
    const last = calls[calls.length - 1]!;
    assert.equal(last.parameters[0], proto.P_MS_DIRECT);
  });

  test('Test 5: parseBackupBlock still works on a coupled-read block (sanity)', () => {
    const block = makeBlock([{ cardNumber: 999001 }]);
    const records = parseBackupBlock(block, proto.REC_LEN);
    assert.equal(records[0]!.cardNumber, 999001);
  });
});
