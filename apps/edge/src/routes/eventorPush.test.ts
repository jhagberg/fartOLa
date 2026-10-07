// Authored for fartola. Not ported from upstream.
//
// TDD tests for POST /api/competitions/:id/eventor/push-results and
// POST /api/competitions/:id/eventor/push-startlist (plan 02.1-08 task 1).
// RED phase — written before eventorPush.ts exists.

import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import yauzl from 'yauzl';
import { buildServer } from '../server.ts';
import { openDatabase, type DbHandle } from '../db/index.ts';
import { classes, competitors, courses, events } from '../db/schema.ts';
import { localToEpochMs } from '../time/competitionClock.ts';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { pushResultStatus } from './eventorPush.ts';
import type { CompetitionState } from '../projection/types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomId(): string {
  return randomBytes(8).toString('hex');
}

interface AppCtx {
  app: FastifyInstance;
  compId: string;
  handle: DbHandle;
}

async function makeApp(apiKey?: string): Promise<AppCtx> {
  const dbPath = join(tmpdir(), `eventorpush-test-${randomId()}.sqlite3`);
  const handle = openDatabase(dbPath);
  const nodeId = randomId();

  // Optionally plant an API key in the config table.
  if (apiKey) {
    handle.sqlite
      .prepare(`INSERT OR REPLACE INTO config (key, value) VALUES ('EVENTOR_API_KEY', ?)`)
      .run(apiKey);
  }

  const app = await buildServer({
    logger: false,
    dbHandle: handle,
    nodeId,
    projectionDebounceMs: 0,
  });

  // Create a competition.
  const compId = randomId();
  handle.sqlite
    .prepare(
      `INSERT INTO competitions (id, name, date, receipt_template, auto_print, created_at_ms) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(compId, 'Test Competition', '2026-05-24', 'classic', 0, Date.now());

  return { app, compId, handle };
}

const EVENTOR_URL = 'https://eventor.orientering.se/Events/ResultList/99';

/** Replace the global fetch — the one eventor/push.ts falls back to — for
 * this test (restored after). Only a POST to Eventor's `endpoint` is
 * answered; any other request fails the test, so nothing reaches the
 * network. Returns the unzipped pushed bodies. */
function stubEventor(
  t: TestContext,
  endpoint: string,
  root: string,
  urlElement: string
): Array<{ apiKey: string | null; xml: string }> {
  const pushed: Array<{ apiKey: string | null; xml: string }> = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL, init?: RequestInit) => {
    assert.equal(String(url), `https://eventor.orientering.se/api/${endpoint}`);
    assert.equal(init?.method, 'POST');
    const headers = new Headers(init?.headers);
    pushed.push({
      apiKey: headers.get('ApiKey'),
      xml: await unzipOne(Buffer.from(init!.body as Uint8Array)),
    });
    return new Response(`<${root}><${urlElement}>${EVENTOR_URL}</${urlElement}></${root}>`, {
      status: 200,
    });
  });
  return pushed;
}

function unzipOne(zip: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zip, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error('no zip'));
      zipfile.on('entry', (entry: yauzl.Entry) => {
        zipfile.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e ?? new Error('no stream'));
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        });
      });
      zipfile.readEntry();
    });
  });
}

/** One H21 runner (course 4.2 km, start 10:00) read out OK in 30:00 after the race start. */
function seedRace(handle: DbHandle, compId: string): void {
  handle.db.insert(classes).values({ id: 'cls-h21', competitionId: compId, name: 'H21' }).run();
  handle.db
    .insert(courses)
    .values({ id: 'crs-a', competitionId: compId, name: 'A', classId: 'cls-h21', lengthM: 4200 })
    .run();
  handle.db
    .insert(competitors)
    .values({
      id: 'cmp-anna',
      competitionId: compId,
      name: 'Anna Andersson',
      classId: 'cls-h21',
      cardNumber: 7501853,
      startTimeMs: localToEpochMs('2026-05-24', 10 * 3600),
    })
    .run();
  handle.sqlite.prepare('UPDATE competitions SET race_started_at_ms = 1 WHERE id = ?').run(compId);
  handle.db
    .insert(events)
    .values({
      nodeId: 'test-node',
      localSeq: 1,
      competitionId: compId,
      eventType: 'card_read',
      eventTimeMs: localToEpochMs('2026-05-24', 10 * 3600 + 40 * 60),
      recordedAtMs: Date.now(),
      payload: {
        event_type: 'card_read',
        card_number: 7501853,
        card_type: 'SI10',
        start: null,
        finish: { half_day: 0, seconds_in_half_day: 10 * 3600 + 30 * 60, weekday: null },
        check: null,
        clear: null,
        punch_count: 0,
        punches: [],
        card_holder: null,
      },
    })
    .run();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('eventorPush routes', () => {
  it('Test 8: push-results with no API key configured returns 400 no_api_key', async () => {
    const { app, compId } = await makeApp(); // No API key.

    const res = await app.inject({
      method: 'POST',
      url: `/api/competitions/${compId}/eventor/push-results`,
    });

    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body) as { error: string };
    assert.equal(body.error, 'no_api_key');
    await app.close();
  });

  it('Test 8b: push-startlist with no API key configured returns 400 no_api_key', async () => {
    const { app, compId } = await makeApp(); // No API key.

    const res = await app.inject({
      method: 'POST',
      url: `/api/competitions/${compId}/eventor/push-startlist`,
    });

    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body) as { error: string };
    assert.equal(body.error, 'no_api_key');
    await app.close();
  });

  it('SOFT TR 4.21.4/7.8.3: push-results uploads the populated ResultList to Eventor (200; the zipped body is inspected)', async (t) => {
    const { app, compId, handle } = await makeApp('VALID-KEY');
    seedRace(handle, compId);
    const pushed = stubEventor(t, 'import/resultlist', 'ImportResultListResult', 'ResultListUrl');

    const res = await app.inject({
      method: 'POST',
      url: `/api/competitions/${compId}/eventor/push-results`,
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { url: EVENTOR_URL, status: 'Final' });
    assert.equal(pushed.length, 1);
    assert.equal(pushed[0]!.apiKey, 'VALID-KEY');
    const xml = pushed[0]!.xml;
    assert.match(xml, /<ResultList [^>]*status="Complete"/);
    assert.match(xml, /<Family>Andersson<\/Family>/);
    assert.match(xml, /<Length>4200<\/Length>/);
    assert.match(xml, /<Time>1800<\/Time>/);
    assert.match(xml, /<Position>1<\/Position>/);
    assert.match(xml, /<Status>OK<\/Status>/);
    await app.close();
  });

  it('Test 7: push-startlist with API key calls pushToEventor and returns { url }', async (t) => {
    const { app, compId, handle } = await makeApp('VALID-KEY');
    seedRace(handle, compId);
    const pushed = stubEventor(t, 'import/startlist', 'ImportStartListResult', 'StartListUrl');

    const res = await app.inject({
      method: 'POST',
      url: `/api/competitions/${compId}/eventor/push-startlist`,
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { url: EVENTOR_URL });
    assert.equal(pushed.length, 1);
    assert.match(pushed[0]!.xml, /<StartList /);
    assert.match(pushed[0]!.xml, /<Family>Andersson<\/Family>/);
    assert.match(pushed[0]!.xml, /<StartTime>2026-05-24T\d\d:00:00\+02:00<\/StartTime>/);
    await app.close();
  });
});

describe('pushResultStatus', () => {
  const state = (statuses: string[]) =>
    ({
      competitors: new Map(statuses.map((s, i) => [`c${i}`, { status: s }])),
    }) as unknown as CompetitionState;

  it('SOFT TA till TR 7.8.2: a push while runners are still out is provisional, so they are not published as "Ej start"', () => {
    assert.equal(pushResultStatus(state(['OK', 'PEND', 'MP'])), 'Provisional');
  });

  it('SOFT TA till TR 7.8.2: a push when everyone is read out or has a status is final', () => {
    assert.equal(pushResultStatus(state(['OK', 'DNS', 'MP', 'DQ'])), 'Final');
  });

  it('the operator can ask for a final or provisional push explicitly', () => {
    assert.equal(pushResultStatus(state(['OK', 'PEND']), true), 'Final');
    assert.equal(pushResultStatus(state(['OK']), false), 'Provisional');
  });
});
