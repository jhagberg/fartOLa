// Authored for fartola. Not ported from upstream.

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server.ts';
import { openDatabase, type DbHandle } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import { classes, competitions } from '../db/schema.ts';

interface Ctx {
  app: FastifyInstance;
  handle: DbHandle;
  competitionId: string;
  h21: string;
  gul: string;
}

async function boot(): Promise<Ctx> {
  const handle = openDatabase(':memory:');
  const app = await buildServer({ logger: false, dbHandle: handle, nodeId: ensureNodeId(handle) });
  const competitionId = crypto.randomUUID();
  handle.db
    .insert(competitions)
    .values({ id: competitionId, name: 'Test Cup', date: '2026-10-10', createdAtMs: 0 })
    .run();
  const h21 = crypto.randomUUID();
  const gul = crypto.randomUUID();
  handle.db
    .insert(classes)
    .values([
      { id: h21, competitionId, name: 'H21', classKind: 'senior', ageClass: 21 },
      { id: gul, competitionId, name: 'Gul 2,5', classKind: 'oppen' },
    ])
    .run();
  return { app, handle, competitionId, h21, gul };
}

let ctx: Ctx;
beforeEach(async () => {
  ctx = await boot();
});
afterEach(async () => {
  await ctx.app.close();
  ctx.handle.close();
});

const url = () => `/api/competitions/${ctx.competitionId}/fees`;

describe('fees routes (SOFT TR 4.12.4, TR 4.12.6)', () => {
  test('PUT sets the card fee and class fees; GET returns them', async () => {
    const put = await ctx.app.inject({
      method: 'PUT',
      url: url(),
      payload: {
        card_fee: 30,
        classes: [
          { class_id: ctx.h21, entry_fee: 180, youth_entry_fee: null, late_fee_pct: 50 },
          { class_id: ctx.gul, entry_fee: 180, youth_entry_fee: 90, late_fee_pct: null },
        ],
      },
    });
    assert.equal(put.statusCode, 200, put.body);
    const get = await ctx.app.inject({ method: 'GET', url: url() });
    assert.deepEqual(get.json(), {
      card_fee: 30,
      classes: [
        {
          class_id: ctx.gul,
          name: 'Gul 2,5',
          class_kind: 'oppen',
          entry_fee: 180,
          youth_entry_fee: 90,
          late_fee_pct: null,
        },
        {
          class_id: ctx.h21,
          name: 'H21',
          class_kind: 'senior',
          entry_fee: 180,
          youth_entry_fee: null,
          late_fee_pct: 50,
        },
      ],
    });
  });

  test('PUT is all or nothing: a class outside the competition → 400, nothing written', async () => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: url(),
      payload: {
        card_fee: 30,
        classes: [
          { class_id: ctx.h21, entry_fee: 180, youth_entry_fee: null, late_fee_pct: 50 },
          { class_id: 'nope', entry_fee: 1, youth_entry_fee: null, late_fee_pct: null },
        ],
      },
    });
    assert.equal(res.statusCode, 400);
    const comp = ctx.handle.db
      .select()
      .from(competitions)
      .where(eq(competitions.id, ctx.competitionId))
      .get()!;
    assert.equal(comp.cardFee, null);
  });

  test('PUT refuses negative fees and a surcharge above 100 %', async () => {
    for (const bad of [
      { card_fee: -1 },
      {
        classes: [{ class_id: ctx.h21, entry_fee: 180, youth_entry_fee: null, late_fee_pct: 150 }],
      },
    ]) {
      const res = await ctx.app.inject({ method: 'PUT', url: url(), payload: bad });
      assert.equal(res.statusCode, 400, JSON.stringify(bad));
    }
  });

  test('from-eventor copies the linked event class fees by name', async (t) => {
    ctx.handle.db
      .update(competitions)
      .set({ eventorEventId: 4711 })
      .where(eq(competitions.id, ctx.competitionId))
      .run();
    ctx.handle.sqlite
      .prepare(`INSERT INTO config (key, value) VALUES ('EVENTOR_API_KEY', 'KEY')`)
      .run();
    t.mock.method(globalThis, 'fetch', async (u: string | URL) =>
      String(u).includes('entryfees')
        ? new Response(
            '<EntryFeeList><EntryFee entryFeeType="adult"><EntryFeeId>1</EntryFeeId><Amount>180</Amount></EntryFee>' +
              '<EntryFee valueOperator="percent"><EntryFeeId>2</EntryFeeId><Amount>50</Amount></EntryFee></EntryFeeList>',
            { status: 200 }
          )
        : new Response(
            '<EventClassList><EventClass><Name>H21</Name><ClassEntryFee><EntryFeeId>1</EntryFeeId></ClassEntryFee>' +
              '<ClassEntryFee><EntryFeeId>2</EntryFeeId></ClassEntryFee></EventClass></EventClassList>',
            { status: 200 }
          )
    );
    const res = await ctx.app.inject({ method: 'POST', url: `${url()}/from-eventor` });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { updated: 1 });
    const row = ctx.handle.db.select().from(classes).where(eq(classes.id, ctx.h21)).get()!;
    assert.deepEqual([row.entryFee, row.youthEntryFee, row.lateFeePct], [180, null, 50]);
  });

  test('from-eventor without a linked event → 409 not_linked', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: `${url()}/from-eventor` });
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.json(), { error: 'eventor_unavailable', eventor: 'not_linked' });
  });
});
