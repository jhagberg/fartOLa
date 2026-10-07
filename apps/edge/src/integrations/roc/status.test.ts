// Authored for fartola. Not ported from upstream.
//
// buildRadioStatus over the event log: start/finish/check, DST nights.
// Synthetic data only.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { openDatabase } from '../../db/index.ts';
import type { DbHandle } from '../../db/index.ts';
import { insertEvent } from '../../si/eventInserter.ts';
import { localToEpochMs } from '../../time/competitionClock.ts';
import { createRocPoller } from './poller.ts';
import { buildRadioStatus } from './status.ts';

const COMP = 'comp-1';

function setup(date: string, controls: string | null = null): DbHandle {
  const handle = openDatabase(':memory:');
  handle.sqlite
    .prepare(
      `INSERT INTO competitions (id, name, date, receipt_template, auto_print, created_at_ms,
         roc_competition_id, roc_enabled, roc_start_id, roc_controls)
       VALUES (?, 'C1', ?, 'classic', 0, 0, '2380', 1, 1, ?)`
    )
    .run(COMP, date, controls);
  return handle;
}

const clock = (sec: number) => ({
  half_day: (sec >= 43200 ? 1 : 0) as 0 | 1,
  seconds_in_half_day: sec % 43200,
  weekday: null,
});

/** A card read at `readAtMs` with the given times of day (seconds). */
function cardRead(
  handle: DbHandle,
  card: number,
  readAtMs: number,
  t: { start?: number; finish?: number; check?: number; punches?: Array<[number, number]> }
): void {
  insertEvent(
    handle,
    'node-A',
    'card_read',
    readAtMs,
    {
      event_type: 'card_read',
      card_number: card,
      card_type: 'SI10',
      start: t.start === undefined ? null : clock(t.start),
      finish: t.finish === undefined ? null : clock(t.finish),
      check: t.check === undefined ? null : clock(t.check),
      clear: null,
      punch_count: t.punches?.length ?? 0,
      punches: (t.punches ?? []).map(([code, sec]) => ({ code, ...clock(sec) })),
      card_holder: null,
    },
    COMP
  );
}

async function deliver(handle: DbHandle, receivedAtMs: number, rows: string[]): Promise<void> {
  const fetchImpl = (async () => new Response(rows.join('\r\n'))) as unknown as typeof fetch;
  await createRocPoller({
    handle,
    nodeId: 'node-A',
    fetchImpl,
    now: () => receivedAtMs,
  }).pollOnce(COMP);
}

const SIX = [1, 2, 3, 4, 5, 6];
const hms = (sec: number) =>
  [Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), sec % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');

describe('buildRadioStatus — start, finish and check', () => {
  const DATE = '2026-10-04';
  const now = localToEpochMs(DATE, 11 * 3600);

  test('a listed finish with card finishes but no radio is silent', () => {
    const handle = setup(DATE, '2');
    for (const n of SIX)
      cardRead(handle, 9_000_000 + n, now - 60_000, { finish: 10 * 3600 + 3000 + n });
    const c = buildRadioStatus(handle, COMP, now, null)!.controls.find(
      (x) => x.control_code === 2
    )!;
    assert.equal(c.state, 'silent');
    assert.equal(c.window_card_punches, 6);
    assert.equal(c.window_matched, 0);
  });

  test('finish coverage: radio finishes (code 2) match the card finishes', async () => {
    const handle = setup(DATE);
    for (const n of SIX)
      cardRead(handle, 9_000_000 + n, now - 60_000, { finish: 10 * 3600 + 3000 + n });
    await deliver(
      handle,
      now - 30_000,
      SIX.slice(0, 4).map((n) => `${n};2;${9_000_000 + n};${DATE} ${hms(10 * 3600 + 3000 + n)}`)
    );
    const c = buildRadioStatus(handle, COMP, now, null)!.controls.find(
      (x) => x.control_code === 2
    )!;
    assert.equal(c.window_card_punches, 6);
    assert.equal(c.window_matched, 4);
    assert.equal(c.state, 'few');
  });

  test('SIAC check punches (code 3) not forwarded while ordinary ones are', async () => {
    const handle = setup(DATE);
    const rows: string[] = [];
    for (const n of SIX) {
      cardRead(handle, 9_000_000 + n, now - 60_000, { check: 10 * 3600 + 3000 + n });
      cardRead(handle, 8_000_000 + n, now - 60_000, { check: 10 * 3600 + 3100 + n });
      rows.push(`${n};3;${9_000_000 + n};${DATE} ${hms(10 * 3600 + 3000 + n)}`);
    }
    await deliver(handle, now - 30_000, rows);
    const c = buildRadioStatus(handle, COMP, now, null)!.controls.find(
      (x) => x.control_code === 3
    )!;
    assert.equal(c.other_matched, 6);
    assert.equal(c.siac_matched, 0);
    assert.equal(c.siac_problem, true);
  });

  test('a wrong-dated duplicate of a punch keeps its date warning, the punch counts once', async () => {
    const handle = setup(DATE);
    await deliver(handle, now - 30_000, [
      `1;78;9000001;${DATE} 10:50:00`,
      `2;78;9000001;2026-10-03 10:50:00`,
    ]);
    const c = buildRadioStatus(handle, COMP, now, null)!.controls[0]!;
    assert.equal(c.received, 1);
    assert.equal(c.date_mismatch_count, 1);
  });
});

describe('buildRadioStatus — DST nights', () => {
  test('spring: a 02:55 station punch on 2026-03-29 matches its radio punch', async () => {
    const date = '2026-03-29';
    const handle = setup(date);
    const nowMs = localToEpochMs(date, 3 * 3600 + 10 * 60); // 03:10 CEST
    const t = 2 * 3600 + 55 * 60; // 02:55 on the station clock (skipped on the laptop's)
    const rows: string[] = [];
    for (const n of SIX) {
      cardRead(handle, 9_000_000 + n, nowMs - 60_000, { punches: [[78, t + n]] });
      rows.push(`${n};78;${9_000_000 + n};${date} ${hms(t + n)}`);
    }
    await deliver(handle, nowMs - 30_000, rows);
    const c = buildRadioStatus(handle, COMP, nowMs, null)!.controls[0]!;
    assert.equal(c.window_card_punches, 6);
    assert.equal(c.window_matched, 6);
    assert.equal(c.state, 'ok');
  });

  test('autumn: a punch just received in the repeated hour is not an hour old', async () => {
    const date = '2026-10-25';
    const handle = setup(date);
    const received = Date.UTC(2026, 9, 25, 1, 10, 0); // 02:10 CET, second pass
    const nowMs = received + 2 * 60_000;
    await deliver(handle, received, [`1;78;9000001;${date} 02:10:00`]);
    const c = buildRadioStatus(handle, COMP, nowMs, null)!.controls[0]!;
    assert.equal(c.last_heard_ms, received);
    assert.equal(c.state, 'ok');
  });

  test('autumn: silence is measured in real time across the repeated hour', async () => {
    const date = '2026-10-25';
    const handle = setup(date);
    const received = Date.UTC(2026, 9, 25, 0, 20, 0); // 02:20 CEST, first pass
    await deliver(handle, received, [`1;78;9000001;${date} 02:20:00`]);
    // 20 real minutes later (02:40 CET is 80 min on the wall clock, 20 real);
    // a runner has passed since: silent after 10 real minutes, not before.
    const at = (min: number) => received + min * 60_000;
    cardRead(handle, 9_000_002, at(15), { punches: [[78, 2 * 3600 + 35 * 60]] });
    assert.equal(buildRadioStatus(handle, COMP, at(8), null)!.controls[0]!.state, 'ok');
    assert.equal(buildRadioStatus(handle, COMP, at(20), null)!.controls[0]!.state, 'silent');
  });
});
