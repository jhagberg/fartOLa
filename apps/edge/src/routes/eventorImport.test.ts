// Authored for fartola. Not ported from upstream.
//
// POST /api/competitions/:id/eventor-import (SOFT TR 4.14.1 (2026-07-01):
// entries to level 1–3 events go through Eventor). The route downloads the
// IOF EntryList from Eventor with the global fetch (eventor/entries.ts falls
// back to it); the test replaces that fetch with one that serves the repo
// fixture and fails on any other request, so nothing reaches the network.

import { describe, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';

import { buildServer } from '../server.ts';
import { openDatabase } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import { classes, competitors } from '../db/schema.ts';

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../test/fixtures/iof30-entrylist-sample.xml'
);

describe('POST /api/competitions/:id/eventor-import', () => {
  test('SOFT TR 4.14.1: entries are downloaded from Eventor and parsed into competitors (EntryList through the route)', async (t: TestContext) => {
    const handle = openDatabase(':memory:');
    handle.sqlite
      .prepare(`INSERT INTO config (key, value) VALUES ('EVENTOR_API_KEY', 'KEY')`)
      .run();
    const app = await buildServer({
      logger: false,
      dbHandle: handle,
      nodeId: ensureNodeId(handle),
    });
    t.after(async () => {
      await app.close();
      handle.close();
    });
    const requested: string[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string | URL, init?: RequestInit) => {
      requested.push(String(url));
      assert.equal(
        String(url),
        'https://eventor.orientering.se/api/export/entries?eventId=4711&version=3.0'
      );
      assert.equal(new Headers(init?.headers).get('ApiKey'), 'KEY');
      return new Response(readFileSync(FIXTURE, 'utf-8'), { status: 200 });
    });

    const comp = await app.inject({
      method: 'POST',
      url: '/api/competitions',
      payload: { name: 'StorTuna Tisdag', date: '2026-05-14' },
    });
    const id = (comp.json() as { id: string }).id;
    for (const name of ['H21', 'D21']) {
      await app.inject({
        method: 'POST',
        url: `/api/competitions/${id}/classes`,
        payload: { name },
      });
    }

    const res = await app.inject({
      method: 'POST',
      url: `/api/competitions/${id}/eventor-import`,
      payload: { eventId: 4711 },
    });
    assert.equal(res.statusCode, 201, res.body);
    assert.equal((res.json() as { competitors_created: number }).competitors_created, 3);
    assert.equal(requested.length, 1);

    const rows = handle.db
      .select({
        name: competitors.name,
        club: competitors.club,
        card: competitors.cardNumber,
        cls: classes.name,
      })
      .from(competitors)
      .innerJoin(classes, eq(classes.id, competitors.classId))
      .where(eq(competitors.competitionId, id))
      .all()
      .sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(rows, [
      { name: 'Anna Andersson', club: 'StorTuna OK', card: 7501853, cls: 'H21' },
      { name: 'Bo Berg', club: 'StorTuna OK', card: null, cls: 'H21' },
      { name: 'Cia Carlsson', club: null, card: 1428824, cls: 'D21' },
    ]);
  });
});
