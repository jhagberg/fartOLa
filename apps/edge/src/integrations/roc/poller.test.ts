// Authored for fartola. Not ported from upstream.
//
// ROC poller against an injected fetch (never the real ROC server) and an
// in-memory database. Synthetic card numbers only.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { openDatabase } from '../../db/index.ts';
import type { DbHandle } from '../../db/index.ts';
import { competitions, events } from '../../db/schema.ts';
import { localToEpochMs } from '../../time/competitionClock.ts';
import { createRocPoller, nextDelayMs } from './poller.ts';

const COMP = 'comp-1';
const DATE = '2026-10-04';
const NOON = localToEpochMs(DATE, 12 * 3600);

function setup(opts: { enabled?: boolean; startId?: number | null } = {}): DbHandle {
  const handle = openDatabase(':memory:');
  handle.sqlite
    .prepare(
      `INSERT INTO competitions (id, name, date, receipt_template, auto_print, created_at_ms,
         roc_competition_id, roc_enabled, roc_start_id)
       VALUES (?, 'C1', ?, 'classic', 0, 0, '2380', ?, ?)`
    )
    .run(COMP, DATE, opts.enabled === false ? 0 : 1, opts.startId ?? null);
  return handle;
}

/** A fetch that answers from a queue of bodies and records every URL. */
function fakeFetch(bodies: Array<string | number>): {
  fetchImpl: typeof fetch;
  urls: string[];
} {
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    urls.push(String(input));
    const next = bodies.shift() ?? '';
    if (typeof next === 'number') return new Response('', { status: next });
    return new Response(next, { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, urls };
}

function radioEvents(handle: DbHandle) {
  return handle.db
    .select()
    .from(events)
    .where(eq(events.eventType, 'radio_punch'))
    .all()
    .map((e) => ({ eventTimeMs: e.eventTimeMs, p: e.payload as Record<string, unknown> }));
}

function poller(handle: DbHandle, fetchImpl: typeof fetch, now = NOON) {
  return createRocPoller({ handle, nodeId: 'node-A', fetchImpl, now: () => now });
}

describe('ROC poller', () => {
  test('requests carry unitId and lastId only, never date or time', async () => {
    const handle = setup();
    const { fetchImpl, urls } = fakeFetch(['', '']);
    const p = poller(handle, fetchImpl);
    await p.pollOnce(COMP);
    await p.pollOnce(COMP);
    for (const u of urls) {
      const q = new URL(u).searchParams;
      assert.deepEqual([...q.keys()].sort(), ['lastId', 'unitId']);
      assert.equal(q.get('unitId'), '2380');
    }
    assert.equal(new URL(urls[0]!).searchParams.get('lastId'), '0');
  });

  test('skips history by id (first row with the competition date), not by timestamp', async () => {
    const handle = setup();
    const { fetchImpl } = fakeFetch([
      [
        '10;78;9000001;2026-09-20 10:00:00',
        '11;78;9000002;2026-09-20 10:00:05',
        '12;78;9000003;2026-10-04 10:00:00',
        '13;78;9000004;2026-10-04 10:00:07',
      ].join('\r\n'),
    ]);
    const batch = await poller(handle, fetchImpl).pollOnce(COMP);
    assert.equal(batch?.skipped, 2);
    assert.equal(batch?.inserted, 2);
    const row = handle.db.select().from(competitions).where(eq(competitions.id, COMP)).get()!;
    assert.equal(row.rocStartId, 12);
    assert.equal(row.rocLastId, 13);
  });

  test('a configured start id wins and the first request asks from startId - 1', async () => {
    const handle = setup({ startId: 50 });
    const { fetchImpl, urls } = fakeFetch([
      '50;78;9000001;2026-10-03 10:00:00\r\n51;78;9000002;2026-10-04 10:00:00',
    ]);
    const batch = await poller(handle, fetchImpl).pollOnce(COMP);
    assert.equal(new URL(urls[0]!).searchParams.get('lastId'), '49');
    // id 50 is >= start id, so it is kept even with an old date.
    assert.equal(batch?.inserted, 2);
  });

  test('a restart resumes from the stored lastId', async () => {
    const handle = setup();
    const first = fakeFetch([
      '20;78;9000001;2026-10-04 10:00:00\r\n21;78;9000002;2026-10-04 10:00:01',
    ]);
    await poller(handle, first.fetchImpl).pollOnce(COMP);

    const second = fakeFetch(['22;78;9000003;2026-10-04 10:00:02']);
    const batch = await poller(handle, second.fetchImpl).pollOnce(COMP);
    assert.equal(new URL(second.urls[0]!).searchParams.get('lastId'), '21');
    assert.equal(batch?.inserted, 1);
    assert.equal(radioEvents(handle).length, 3);
  });

  test('a row with another date is kept and flagged, not dropped', async () => {
    const handle = setup();
    const { fetchImpl } = fakeFetch([
      [
        '30;78;9000001;2026-10-04 10:00:00',
        '31;78;9000002;2026-10-03 10:00:30',
        '32;100;9000003;2026-10-03 10:00:40',
      ].join('\n'),
    ]);
    const batch = await poller(handle, fetchImpl).pollOnce(COMP);
    assert.equal(batch?.inserted, 3);
    assert.equal(batch?.dateMismatches, 2);
    const rows = radioEvents(handle);
    assert.deepEqual(
      rows.map((r) => r.p['date_mismatch']),
      [false, true, true]
    );
    // Placed on the competition day from the time of day alone.
    assert.equal(rows[1]!.eventTimeMs, localToEpochMs(DATE, 10 * 3600 + 30));
  });

  test('the same punch via two senders is stored once', async () => {
    const handle = setup();
    const { fetchImpl } = fakeFetch([
      '40;78;9000001;2026-10-04 10:00:00\r\n41;78;9000001;2026-10-03 10:00:00',
      '42;78;9000001;2026-10-04 10:00:00',
    ]);
    const p = poller(handle, fetchImpl);
    const a = await p.pollOnce(COMP);
    assert.equal(a?.inserted, 1);
    assert.equal(a?.duplicates, 1);
    const b = await p.pollOnce(COMP);
    assert.equal(b?.duplicates, 1);
    assert.equal(radioEvents(handle).length, 1);
    // lastId still advanced past the duplicates.
    assert.equal(
      handle.db.select().from(competitions).where(eq(competitions.id, COMP)).get()!.rocLastId,
      42
    );
  });

  test('places a time of day on the right side of midnight', async () => {
    const handle = setup();
    const justAfterMidnight = localToEpochMs('2026-10-05', 5);
    const { fetchImpl } = fakeFetch([
      '60;78;9000001;2026-10-04 23:59:30\r\n61;78;9000002;2026-10-05 00:00:02',
    ]);
    await poller(handle, fetchImpl, justAfterMidnight).pollOnce(COMP);
    const times = radioEvents(handle).map((r) => r.eventTimeMs);
    assert.deepEqual(times, [
      localToEpochMs('2026-10-04', 23 * 3600 + 59 * 60 + 30),
      localToEpochMs('2026-10-05', 2),
    ]);
  });

  test('HTTP 500 throws and leaves the stored state alone', async () => {
    const handle = setup();
    const { fetchImpl } = fakeFetch([500]);
    await assert.rejects(poller(handle, fetchImpl).pollOnce(COMP), /HTTP 500/);
    const row = handle.db.select().from(competitions).where(eq(competitions.id, COMP)).get()!;
    assert.equal(row.rocLastId, null);
    assert.equal(radioEvents(handle).length, 0);
  });

  test('does nothing, and makes no request, when ROC is off', async () => {
    const handle = setup({ enabled: false });
    const { fetchImpl, urls } = fakeFetch([]);
    assert.equal(await poller(handle, fetchImpl).pollOnce(COMP), null);
    assert.equal(urls.length, 0);
  });

  test('malformed and blank lines do not stop the good rows', async () => {
    const handle = setup();
    const { fetchImpl } = fakeFetch(['\r\nnonsense\r\n70;78;9000001;2026-10-04 10:00:00\r\n\r\n']);
    const batch = await poller(handle, fetchImpl).pollOnce(COMP);
    assert.equal(batch?.inserted, 1);
    assert.equal(batch?.malformed, 1);
  });

  test('backs off on errors: 5 s, then doubling up to the cap', () => {
    assert.equal(nextDelayMs(0, 5000, 60000), 5000);
    assert.equal(nextDelayMs(1, 5000, 60000), 10000);
    assert.equal(nextDelayMs(2, 5000, 60000), 20000);
    assert.equal(nextDelayMs(10, 5000, 60000), 60000);
  });
});
