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
  // Default: a start id of 1, i.e. baseline already taken. Pass null for a first poll.
  const startId = opts.startId === undefined ? 1 : opts.startId;
  const handle = openDatabase(':memory:');
  handle.sqlite
    .prepare(
      `INSERT INTO competitions (id, name, date, receipt_template, auto_print, created_at_ms,
         roc_competition_id, roc_enabled, roc_start_id)
       VALUES (?, 'C1', ?, 'classic', 0, 0, '2380', ?, ?)`
    )
    .run(COMP, DATE, opts.enabled === false ? 0 : 1, startId);
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

  test('baseline: on enable, every row that exists is history, whatever its date', async () => {
    const handle = setup({ startId: null });
    const { fetchImpl, urls } = fakeFetch([
      [
        '10;78;9000001;2026-10-04 10:00:00',
        '11;78;9000002;2026-09-20 10:00:05',
        '12;78;9000003;2026-10-03 10:00:00',
      ].join('\r\n'),
      [
        '13;78;9000004;2026-10-04 10:00:07',
        '14;78;9000005;2026-10-03 10:00:09', // a sender with yesterday's date
      ].join('\r\n'),
    ]);
    const p = poller(handle, fetchImpl);
    const first = await p.pollOnce(COMP);
    assert.equal(first?.skipped, 3);
    assert.equal(first?.inserted, 0);
    const row = handle.db.select().from(competitions).where(eq(competitions.id, COMP)).get()!;
    assert.equal(row.rocStartId, 13);
    assert.equal(row.rocLastId, 12);
    const second = await p.pollOnce(COMP);
    assert.equal(new URL(urls[1]!).searchParams.get('lastId'), '12');
    assert.equal(second?.inserted, 2);
    assert.equal(second?.dateMismatches, 1);
  });

  test('baseline on an empty ROC: rows arriving afterwards are all stored', async () => {
    const handle = setup({ startId: null });
    const { fetchImpl } = fakeFetch(['', '1;78;9000001;2026-10-03 09:00:00']);
    const p = poller(handle, fetchImpl);
    await p.pollOnce(COMP);
    const row = handle.db.select().from(competitions).where(eq(competitions.id, COMP)).get()!;
    assert.deepEqual([row.rocStartId, row.rocLastId], [1, 0]);
    const second = await p.pollOnce(COMP);
    assert.equal(second?.inserted, 1);
    assert.equal(second?.dateMismatches, 1);
  });

  test('a morning whose first rows are all wrong-dated: all stored with date_mismatch, none skipped', async () => {
    const handle = setup({ startId: 100 });
    const { fetchImpl } = fakeFetch([
      [
        '100;78;9000001;2026-10-03 09:00:00',
        '101;78;9000002;2026-10-03 09:00:03',
        '102;100;9000003;2026-10-03 09:00:05',
      ].join('\r\n'),
    ]);
    const batch = await poller(handle, fetchImpl).pollOnce(COMP);
    assert.equal(batch?.skipped, 0);
    assert.equal(batch?.inserted, 3);
    assert.ok(radioEvents(handle).every((r) => r.p['date_mismatch'] === true));
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

  test('a re-fetched row is stored once; the same punch from two senders is two rows with their own date flags', async () => {
    const handle = setup();
    const { fetchImpl } = fakeFetch([
      '40;78;9000001;2026-10-04 10:00:00\r\n41;78;9000001;2026-10-03 10:00:00',
    ]);
    const p = poller(handle, fetchImpl);
    const a = await p.pollOnce(COMP);
    assert.equal(a?.inserted, 2);
    // The wrong-dated duplicate still raises its warning.
    assert.equal(a?.dateMismatches, 1);
    assert.deepEqual(
      radioEvents(handle).map((r) => r.p['date_mismatch']),
      [false, true]
    );
  });

  test('wrong-dated copy first, correct copy second: the warning stays', async () => {
    const handle = setup();
    const { fetchImpl } = fakeFetch([
      '40;78;9000001;2026-10-03 10:00:00\r\n41;78;9000001;2026-10-04 10:00:00',
    ]);
    const a = await poller(handle, fetchImpl).pollOnce(COMP);
    assert.equal(a?.dateMismatches, 1);
  });

  test('the same ROC row delivered twice (crash before the cursor moved) is stored once', async () => {
    const handle = setup();
    const row = '40;78;9000001;2026-10-04 10:00:00';
    handle.sqlite.prepare('UPDATE competitions SET roc_last_id = 39').run();
    const p1 = poller(handle, fakeFetch([row]).fetchImpl);
    await p1.pollOnce(COMP);
    handle.sqlite.prepare('UPDATE competitions SET roc_last_id = 39').run();
    const b = await poller(handle, fakeFetch([row]).fetchImpl).pollOnce(COMP);
    assert.equal(b?.duplicates, 1);
    assert.equal(radioEvents(handle).length, 1);
  });

  test('a response for old settings is discarded when the settings changed during the fetch', async () => {
    const handle = setup({ startId: 1 });
    let release!: (b: string) => void;
    const slow = (() =>
      new Promise<Response>((resolve) => {
        release = (b) => resolve(new Response(b, { status: 200 }));
      })) as unknown as typeof fetch;
    const pending = poller(handle, slow).pollOnce(COMP);
    // The operator moves to unit 999, start id 50, while the request is out.
    handle.sqlite
      .prepare(
        "UPDATE competitions SET roc_competition_id='999', roc_start_id=50, roc_last_id=NULL"
      )
      .run();
    release('1000;78;9000001;2026-10-04 10:00:00');
    assert.equal(await pending, null);
    const row = handle.db.select().from(competitions).where(eq(competitions.id, COMP)).get()!;
    assert.deepEqual([row.rocCompetitionId, row.rocStartId, row.rocLastId], ['999', 50, null]);
    assert.equal(radioEvents(handle).length, 0);
  });

  test('receive time is taken after the response is in', async () => {
    const handle = setup();
    let clock = NOON;
    const fetchImpl = (async () => {
      clock += 13_000; // the request takes 13 s
      return new Response('90;78;9000001;2026-10-04 12:00:05', { status: 200 });
    }) as unknown as typeof fetch;
    const p = createRocPoller({ handle, nodeId: 'node-A', fetchImpl, now: () => clock });
    await p.pollOnce(COMP);
    const [e] = radioEvents(handle);
    assert.equal(e!.p['received_at_ms'], NOON + 13_000);
    // Punch 12:00:05 is placed relative to that, delay is 8 s, never negative.
    assert.equal((e!.p['received_at_ms'] as number) - e!.eventTimeMs, 8_000);
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

  test('onInserted fires after a poll that stored rows, not after one that stored none', async () => {
    const handle = setup();
    const { fetchImpl } = fakeFetch(['1;78;9000001;2026-10-04 10:00:00', '']);
    const calls: string[] = [];
    const p = createRocPoller({
      handle,
      nodeId: 'node-A',
      fetchImpl,
      now: () => NOON,
      onInserted: (id) => calls.push(id),
    });
    await p.pollOnce(COMP);
    await p.pollOnce(COMP);
    assert.deepEqual(calls, [COMP]);
  });

  test('backs off on errors: 5 s, then doubling up to the cap', () => {
    assert.equal(nextDelayMs(0, 5000, 60000), 5000);
    assert.equal(nextDelayMs(1, 5000, 60000), 10000);
    assert.equal(nextDelayMs(2, 5000, 60000), 20000);
    assert.equal(nextDelayMs(10, 5000, 60000), 60000);
  });
});
