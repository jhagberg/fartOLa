// Authored for fartola. Not ported from upstream.
//
// Serial radio input against a fake transport and an in-memory database.
// Synthetic card numbers only.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { eq } from 'drizzle-orm';
import { CRC16 } from '@fartola/sportident';
import type { ISerialTransport } from '@fartola/sportident';

import { openDatabase } from '../../db/index.ts';
import type { DbHandle } from '../../db/index.ts';
import { events } from '../../db/schema.ts';
import { localToEpochMs } from '../../time/competitionClock.ts';
import { buildRadioStatus } from '../roc/status.ts';
import { createRadioSerialInput } from './input.ts';

const COMP = 'comp-1';
const DATE = '2026-10-04';
const NOON = localToEpochMs(DATE, 12 * 3600);

function setup(): DbHandle {
  const handle = openDatabase(':memory:');
  handle.sqlite
    .prepare(
      `INSERT INTO competitions (id, name, date, receipt_template, auto_print, created_at_ms)
       VALUES (?, 'C1', ?, 'classic', 0, 0)`
    )
    .run(COMP, DATE);
  return handle;
}

class FakeTransport extends EventEmitter implements ISerialTransport {
  sent: number[][] = [];
  closed = false;
  failOpen = false;
  open(): Promise<void> {
    return this.failOpen ? Promise.reject(new Error('no such port')) : Promise.resolve();
  }
  send(bytes: number[]): Promise<void> {
    this.sent.push(bytes);
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

// One autosend record, as a station sends it: control 78, card 8 123 456,
// 11:59:50 (am, 43190 s), 1/256 s = 64, backup address 0x208.
const FRAME_78 = [
  0x02, 0xd3, 0x0d, 0x00, 0x4e, 0x00, 0x7b, 0xf4, 0x40, 0x00, 0xa8, 0xb6, 0x40, 0x00, 0x02, 0x08,
];

function frame78(): number[] {
  const [hi, lo] = CRC16(FRAME_78.slice(1));
  return [...FRAME_78, hi, lo, 0x03];
}

function radioEvents(handle: DbHandle) {
  return handle.db
    .select()
    .from(events)
    .where(eq(events.eventType, 'radio_punch'))
    .all()
    .map((e) => ({
      competitionId: e.competitionId,
      eventTimeMs: e.eventTimeMs,
      p: e.payload as Record<string, unknown>,
    }));
}

function input(
  handle: DbHandle,
  opts: { active?: string | null; transports?: FakeTransport[]; backoffMs?: number[] } = {}
) {
  const transports = opts.transports ?? [new FakeTransport()];
  const opened: FakeTransport[] = [];
  const inserted: string[] = [];
  const i = createRadioSerialInput({
    handle,
    nodeId: 'node-A',
    path: '/dev/ttyUSB7',
    getActiveCompetitionId: () => (opts.active === undefined ? COMP : opts.active),
    onInserted: (id) => inserted.push(id),
    now: () => NOON,
    openTransport: () => {
      const t = transports[Math.min(opened.length, transports.length - 1)]!;
      opened.push(t);
      return t;
    },
    ...(opts.backoffMs ? { backoffMs: opts.backoffMs } : {}),
  });
  return { i, transports, opened, inserted };
}

describe('serial radio input', () => {
  test('a record becomes a radio punch on the active competition', async () => {
    const handle = setup();
    const { i, transports, inserted } = input(handle);
    await i.start();
    transports[0]!.emit('data', frame78());

    const rows = radioEvents(handle);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.competitionId, COMP);
    // 11:59:50 on the competition date, 10 s before it was received.
    assert.equal(rows[0]!.eventTimeMs, NOON - 10_000);
    assert.deepEqual(rows[0]!.p, {
      event_type: 'radio_punch',
      source: 'serial',
      idempotency_key: 'serial:78:8123456:11:59:50',
      card_number: 8123456,
      control_code: 78,
      time_of_day: '11:59:50',
      received_at_ms: NOON,
      date_mismatch: false,
      subsec_256: 64,
      weekday: 0,
      station_mem_address: 0x208,
      port: '/dev/ttyUSB7',
    });
    assert.deepEqual(inserted, [COMP]);
    assert.deepEqual(transports[0]!.sent, [], 'the input never writes to the port');
    const s = i.status();
    assert.equal(s.connected, true);
    assert.equal(s.punches, 1);
    assert.equal(s.last_punch_at, NOON);
    await i.stop();
  });

  test('the same punch heard twice is stored once', async () => {
    const handle = setup();
    const { i, transports, inserted } = input(handle);
    await i.start();
    const f = frame78();
    transports[0]!.emit('data', [...f, ...f]);
    assert.equal(radioEvents(handle).length, 1);
    assert.equal(i.status().duplicates, 1);
    assert.deepEqual(inserted, [COMP]);
    await i.stop();
  });

  test('no active competition: nothing stored, and the status says so', async () => {
    const handle = setup();
    const { i, transports, inserted } = input(handle, { active: null });
    await i.start();
    transports[0]!.emit('data', frame78());
    assert.equal(radioEvents(handle).length, 0);
    assert.equal(i.status().no_competition, 1);
    assert.deepEqual(inserted, []);
    await i.stop();
  });

  test('the radio status counts a serial punch like a ROC punch', async () => {
    const handle = setup();
    const { i, transports } = input(handle);
    await i.start();
    transports[0]!.emit('data', frame78());
    const status = buildRadioStatus(handle, COMP, NOON, null, [i.status()]);
    const c78 = status?.controls.find((c) => c.control_code === 78);
    assert.equal(c78?.received, 1);
    assert.equal(c78?.last_heard_ms, NOON);
    assert.equal(status?.serial[0]?.path, '/dev/ttyUSB7');
    await i.stop();
  });

  test('a port that will not open is retried; a closed port is reopened', async () => {
    const handle = setup();
    const bad = new FakeTransport();
    bad.failOpen = true;
    const good = new FakeTransport();
    const again = new FakeTransport();
    const { i, opened } = input(handle, { transports: [bad, good, again], backoffMs: [5] });
    await i.start();
    assert.equal(i.status().connected, false);
    assert.match(i.status().last_error ?? '', /no such port/);

    await new Promise((r) => setTimeout(r, 30));
    assert.equal(opened.length, 2);
    assert.equal(i.status().connected, true);
    assert.equal(i.status().last_error, null);

    good.emit('close');
    assert.equal(i.status().connected, false);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(opened.length, 3);
    assert.equal(i.status().connected, true);

    await i.stop();
    assert.equal(again.closed, true);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(opened.length, 3, 'no reconnect after stop');
  });
});
