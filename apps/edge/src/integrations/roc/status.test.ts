// Authored for fartola. Not ported from upstream.
//
// buildRadioStatus over the event log: start/finish/check, DST nights.
// Synthetic data only.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { openDatabase } from '../../db/index.ts';
import type { DbHandle } from '../../db/index.ts';
import { cardTypeFromNumber } from '../../si/cardType.ts';
import { insertEvent } from '../../si/eventInserter.ts';
import { localToEpochMs } from '../../time/competitionClock.ts';
import { createRocPoller } from './poller.ts';
import { buildRadioStatus } from './status.ts';

const COMP = 'comp-1';

function setup(
  date: string,
  controls: string | null = null,
  roles: { start?: string; check?: string; finish?: string } = {}
): DbHandle {
  const handle = openDatabase(':memory:');
  handle.sqlite
    .prepare(
      `INSERT INTO competitions (id, name, date, receipt_template, auto_print, created_at_ms,
         roc_competition_id, roc_enabled, roc_start_id, roc_controls,
         roc_start_codes, roc_check_codes, roc_finish_codes)
       VALUES (?, 'C1', ?, 'classic', 0, 0, '2380', 1, 1, ?, ?, ?, ?)`
    )
    .run(COMP, date, controls, roles.start ?? null, roles.check ?? null, roles.finish ?? null);
  return handle;
}

const clock = (sec: number, code?: number, touchFree?: boolean) => ({
  half_day: (sec >= 43200 ? 1 : 0) as 0 | 1,
  seconds_in_half_day: sec % 43200,
  weekday: null,
  ...(code === undefined ? {} : { code }),
  ...(touchFree === true ? { touch_free: true as const } : {}),
});

/** A start/finish/check time of day, optionally stamped by unit `unit`. */
type Stamp = number | [sec: number, unit: number] | [sec: number, unit: number, touchFree: boolean];
const stamp = (t: Stamp | undefined) =>
  t === undefined ? null : typeof t === 'number' ? clock(t) : clock(t[0], t[1], t[2]);

/** A card read at `readAtMs` with the given times of day (seconds). */
function cardRead(
  handle: DbHandle,
  card: number,
  readAtMs: number,
  t: { start?: Stamp; finish?: Stamp; check?: Stamp; punches?: Array<[number, number]> }
): void {
  insertEvent(
    handle,
    'node-A',
    'card_read',
    readAtMs,
    {
      event_type: 'card_read',
      card_number: card,
      card_type: cardTypeFromNumber(card),
      start: stamp(t.start),
      finish: stamp(t.finish),
      check: stamp(t.check),
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

describe('buildRadioStatus — start, finish and check units', () => {
  const DATE = '2026-10-04';
  const now = localToEpochMs(DATE, 11 * 3600);
  const T = 10 * 3600 + 3000;
  const finishRow = (id: number, unit: number, card: number, sec: number) =>
    `${id};${unit};${card};${DATE} ${hms(sec)}`;

  test('a listed finish unit with card finishes but no radio is silent', () => {
    const handle = setup(DATE, null, { finish: '10' });
    for (const n of SIX) cardRead(handle, 9_000_000 + n, now - 60_000, { finish: [T + n, 10] });
    const c = buildRadioStatus(handle, COMP, now, null)!.controls.find(
      (x) => x.role === 'finish' && x.control_code === 10
    )!;
    assert.equal(c.state, 'silent');
    assert.equal(c.window_card_punches, 6);
    assert.equal(c.window_matched, 0);
  });

  test('role mapping: radio code 13 matches start times of unit 13, 12 matches check, 10 finish', async () => {
    const handle = setup(DATE, null, { start: '3,13', check: '2,12,22', finish: '10,20' });
    const rows: string[] = [];
    let id = 1;
    for (const n of SIX) {
      cardRead(handle, 9_000_000 + n, now - 60_000, {
        start: [T + n, 13],
        check: [T + 100 + n, 12],
        finish: [T + 200 + n, 10],
      });
      rows.push(finishRow(id++, 13, 9_000_000 + n, T + n));
      rows.push(finishRow(id++, 12, 9_000_000 + n, T + 100 + n));
      rows.push(finishRow(id++, 10, 9_000_000 + n, T + 200 + n));
    }
    await deliver(handle, now - 30_000, rows);
    const out = buildRadioStatus(handle, COMP, now, null)!;
    const unit = (role: string, code: number) =>
      out.controls.find((x) => x.role === role && x.control_code === code)!;
    for (const [role, code] of [
      ['start', 13],
      ['check', 12],
      ['finish', 10],
    ] as const) {
      assert.equal(unit(role, code).window_matched, 6, `${role} ${code}`);
      assert.equal(unit(role, code).state, 'ok');
    }
    // A unit the cards did not use is shown but not alarming.
    assert.equal(unit('finish', 20).window_card_punches, 0);
    assert.equal(unit('finish', 20).state, 'ok');
    // Role codes are not also shown as ordinary controls.
    assert.equal(out.controls.filter((x) => x.role === 'control').length, 0);
  });

  test('finish unit 20 drops SIAC while unit 10 forwards them: flagged per unit, role total above 50 %', async () => {
    const handle = setup(DATE, null, { finish: '10,20' });
    const rows: string[] = [];
    let id = 1;
    const n10 = 12; // SIAC cards through unit 10: 11 forwarded
    for (let n = 1; n <= n10; n++) {
      cardRead(handle, 8_000_000 + n, now - 60_000, { finish: [T + n, 10, true] });
      if (n <= 11) rows.push(finishRow(id++, 10, 8_000_000 + n, T + n));
    }
    for (let n = 1; n <= 8; n++) {
      // unit 20: ordinary cards forwarded, SIAC (1 of 8) not
      cardRead(handle, 9_000_000 + n, now - 60_000, { finish: [T + 300 + n, 20] });
      rows.push(finishRow(id++, 20, 9_000_000 + n, T + 300 + n));
      cardRead(handle, 8_000_100 + n, now - 60_000, { finish: [T + 400 + n, 20, true] });
      if (n === 1) rows.push(finishRow(id++, 20, 8_000_101, T + 401));
    }
    await deliver(handle, now - 30_000, rows);
    const out = buildRadioStatus(handle, COMP, now, null)!;
    const u10 = out.controls.find((x) => x.role === 'finish' && x.control_code === 10)!;
    const u20 = out.controls.find((x) => x.role === 'finish' && x.control_code === 20)!;
    assert.equal(u20.siac_problem, true);
    assert.equal(u20.other_matched, 8);
    assert.equal(u20.siac_matched, 1);
    assert.equal(u10.siac_problem, false);
    // Mixed together the finish SIAC share is above 50 %: a role-level check misses it.
    const siacAll = u10.siac_card_punches + u20.siac_card_punches;
    const siacHit = u10.siac_matched + u20.siac_matched;
    assert.ok(siacHit / siacAll > 0.5, `${siacHit}/${siacAll}`);
  });

  test('touch-free flag, not card number: unit 20 drops Air+ punches, a SIAC used in contact counts as contact', async () => {
    const handle = setup(DATE, null, { finish: '10,20' });
    const rows: string[] = [];
    let id = 1;
    // Unit 20: contact punches (ordinary SI10 numbers AND SIAC cards used in
    // contact) all forwarded, touch-free (SI10 numbers here) 1 of 8.
    for (let n = 1; n <= 8; n++) {
      cardRead(handle, 7_000_000 + n, now - 60_000, { finish: [T + n, 20] });
      rows.push(finishRow(id++, 20, 7_000_000 + n, T + n));
      cardRead(handle, 8_000_000 + n, now - 60_000, { finish: [T + 100 + n, 20] });
      rows.push(finishRow(id++, 20, 8_000_000 + n, T + 100 + n));
      cardRead(handle, 7_100_000 + n, now - 60_000, { finish: [T + 200 + n, 20, true] });
      if (n === 1) rows.push(finishRow(id++, 20, 7_100_001, T + 201));
    }
    await deliver(handle, now - 30_000, rows);
    const u20 = buildRadioStatus(handle, COMP, now, null)!.controls.find(
      (x) => x.role === 'finish' && x.control_code === 20
    )!;
    // Contact: 16 (8 SI10 + 8 SIAC in contact) all through; touch-free: 1 of 8.
    assert.equal(u20.other_card_punches, 16);
    assert.equal(u20.other_matched, 16);
    assert.equal(u20.siac_card_punches, 8);
    assert.equal(u20.siac_matched, 1);
    assert.equal(u20.siac_problem, true);
  });

  test('cards without a unit code (SI5) count as the unknown unit of the role', async () => {
    const handle = setup(DATE, null, { finish: '10,20' });
    const rows: string[] = [];
    SIX.forEach((n, i) => {
      cardRead(handle, 100_000 + n, now - 60_000, { finish: T + n });
      if (i < 4) rows.push(finishRow(i + 1, 20, 100_000 + n, T + n));
    });
    await deliver(handle, now - 30_000, rows);
    const out = buildRadioStatus(handle, COMP, now, null)!;
    const unk = out.controls.find((x) => x.role === 'finish' && x.unknown_unit)!;
    assert.equal(unk.window_card_punches, 6);
    assert.equal(unk.window_matched, 4);
    // The cards say nothing about which unit: the named units get none of them.
    assert.equal(
      out.controls.find((x) => x.role === 'finish' && x.control_code === 20)!.window_card_punches,
      0
    );
  });

  test('heard codes that are in no list are suggested', async () => {
    const handle = setup(DATE, '78', { finish: '10' });
    await deliver(handle, now - 30_000, [
      finishRow(1, 78, 9_000_001, T),
      finishRow(2, 10, 9_000_001, T + 5),
      finishRow(3, 22, 9_000_001, T + 6),
    ]);
    assert.deepEqual(buildRadioStatus(handle, COMP, now, null)!.settings.heard_codes, [22]);
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

  // 2026-10-25: Stockholm goes back at 03:00 CEST. The competition clock keeps
  // one fixed offset (+01:00 here, the offset at noon), so 02:00-03:00 happens
  // once and nothing repeats.
  const AUTUMN = '2026-10-25';
  const at0210 = Date.UTC(2026, 9, 25, 1, 10, 0); // 02:10:00 on the clock

  test('autumn: a punch received at once in the 02:00-03:00 hour has a delay of seconds', async () => {
    const handle = setup(AUTUMN);
    await deliver(handle, at0210 + 1000, [`1;78;9000001;${AUTUMN} 02:10:00`]);
    const c = buildRadioStatus(handle, COMP, at0210 + 120_000, null)!.controls[0]!;
    assert.equal(c.median_delay_ms, 1000);
    assert.equal(c.last_heard_ms, at0210 + 1000);
    assert.equal(c.state, 'ok');
  });

  test('autumn: silence is detected in the 02:00-03:00 hour', async () => {
    const handle = setup(AUTUMN);
    await deliver(handle, at0210 + 1000, [`1;78;9000001;${AUTUMN} 02:10:00`]);
    // 14 minutes on: a card read with an unmatched 02:23 punch, nothing from the radio.
    const now = at0210 + 14 * 60_000;
    cardRead(handle, 9_000_002, now, { punches: [[78, 2 * 3600 + 23 * 60]] });
    assert.equal(buildRadioStatus(handle, COMP, now, null)!.controls[0]!.state, 'silent');
    // Not yet at 8 minutes.
    const early = at0210 + 8 * 60_000;
    assert.equal(buildRadioStatus(handle, COMP, early, null)!.controls[0]!.state, 'ok');
  });

  test('events from an earlier build (no stored placement) still match the cards', async () => {
    const date = '2026-10-04';
    const handle = setup(date);
    const nowMs = localToEpochMs(date, 11 * 3600);
    const t = 10 * 3600 + 3000;
    for (const n of SIX) {
      cardRead(handle, 9_000_000 + n, nowMs - 60_000, { punches: [[78, t + n]] });
      // The shape written before placement was derived: wall_ms present or absent,
      // event_time_ms in the old placement.
      insertEvent(
        handle,
        'node-A',
        'radio_punch',
        localToEpochMs(date, t + n),
        {
          event_type: 'radio_punch',
          source: 'roc',
          idempotency_key: `9${n}:78:${hms(t + n)}`,
          roc_id: n,
          card_number: 9_000_000 + n,
          control_code: 78,
          time_of_day: hms(t + n),
          received_at_ms: nowMs - 30_000,
          roc_date: date,
          date_mismatch: false,
        },
        COMP
      );
    }
    const c = buildRadioStatus(handle, COMP, nowMs, null)!.controls[0]!;
    assert.equal(c.window_card_punches, 6);
    assert.equal(c.window_matched, 6);
  });
});
