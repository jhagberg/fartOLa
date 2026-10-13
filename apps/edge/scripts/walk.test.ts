// Authored for fartola. Not ported from upstream.
//
// The walk in the test suite: one short fixed walk, the sequences that
// calibrate the checks, and the findings through the plain routes: the fixed
// ones as tests, the ones written down but not fixed as todo tests (they
// fail today and do not fail the suite; when one passes, remove its `todo`
// and its KNOWN entry in walkChecks.ts).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { openDatabase } from '../src/db/index.ts';
import { ensureNodeId } from '../src/db/node-id.ts';
import { buildServer } from '../src/server.ts';
import { walk } from './walk.ts';
import { OPS, stepsOf } from './walkOps.ts';
import { entryListXml, startListXml, type Entry, type Step, type World } from './walkWorld.ts';

const step = (op: string, k?: string, dt = 30_000): Step => ({
  op,
  ...(k === undefined ? {} : { k }),
  a: 0,
  b: 0,
  c: 1,
  dt,
  rnd: 1,
});

describe('the operator-mistake walk', () => {
  test('a fixed walk of 60 steps meets no failure', async () => {
    const r = await walk(1, stepsOf(1, 60));
    assert.equal(r.failure, undefined, JSON.stringify(r.failure));
  });

  // The fault of 2026-10-12, as the walk found and shrank it on the code
  // before PR 130 (seed 2): there the reset went through, the result was
  // gone (check 4), and starting again did not bring it back (check 5).
  test('start, read, reset: the reset is refused and nothing is lost', async () => {
    const r = await walk(2, [
      { op: 'start', a: 703, b: 848, c: 225, dt: 0, rnd: 363015 },
      { op: 'read', k: 'ok', a: 525, b: 970, c: 220, dt: 35951, rnd: 32509 },
      { op: 'reset', a: 902, b: 669, c: 173, dt: 46438, rnd: 610093 },
    ]);
    assert.equal(r.failure, undefined, JSON.stringify(r.failure));
  });

  test('a read in the same millisecond as the start is reported as known', async () => {
    const r = await walk(1, [step('read', 'ok'), step('start', undefined, 0)]);
    assert.equal(r.failure, undefined, JSON.stringify(r.failure));
    assert.deepEqual(
      [...r.known.keys()],
      ['read in the same millisecond as the start, stored before it']
    );
  });

  // Open, .planning/todos/pending/2026-10-12-race-phase-revision.md: the
  // undo puts back the start the reset named, so the old confirmation is
  // taken once more.
  test('a forced reset sent again after its undo is reported as known', async () => {
    const r = await walk(
      1,
      ['start', 'read', 'reset', 'resetConfirm', 'undoAsk', 'undoConfirm', 'resetConfirm'].map(
        (op) => step(op, op === 'read' ? 'ok' : undefined)
      )
    );
    assert.equal(r.failure, undefined, JSON.stringify(r.failure));
    assert.deepEqual(
      [...r.known.keys()],
      ['a forced reset sent again after its undo resets the race again']
    );
  });

  test('the checks see what is changed behind their back', async () => {
    // Not steps an operator can take: rows changed with no event and no
    // word to the projection.
    const sql = (statement: string) => ({
      w: 0,
      run: async (w: World) => void w.handle.sqlite.prepare(statement).run(),
    });
    OPS['loseCards'] = sql('UPDATE competitors SET card_number = NULL');
    OPS['moveStart'] = sql(
      'UPDATE competitions SET race_started_at_ms = race_started_at_ms - 3600000'
    );
    const kinds = async (steps: Step[]): Promise<string[]> =>
      [...(await walk(1, steps, { all: true })).kinds.values()].map((k) => k.failure.id).sort();
    try {
      assert.deepEqual(await kinds([step('start'), step('read', 'ok'), step('loseCards')]), [
        'cache-stale',
        'mop-differs',
        'no-way-back',
        'results-fell',
      ]);
      // A card read before the start counts once the column says the race
      // began earlier; the events say otherwise.
      assert.deepEqual(await kinds([step('read', 'ok'), step('start'), step('moveStart')]), [
        'cache-stale',
        'events-differ',
        'mop-differs',
      ]);
    } finally {
      delete OPS['loseCards'];
      delete OPS['moveStart'];
    }
  });
});

// ---------------------------------------------------------------------------
// Findings, through the plain routes. Synthetic runners.
// ---------------------------------------------------------------------------

const ALVA: Entry = {
  given: 'Alva',
  family: 'Almfors',
  club: 'OK Granen',
  cls: 'H21',
  card: 8100001,
};

/** A started race with one class and Alva entered; `read` reads a card. */
async function race() {
  process.env['FARTOLA_DEV'] = '1';
  const handle = openDatabase(':memory:');
  const app = await buildServer({
    logger: false,
    dbHandle: handle,
    nodeId: ensureNodeId(handle),
    printerSink: { isPrinterConnected: async () => true, print: async () => {} },
  });
  const send = (method: string, url: string, payload?: object) =>
    app.inject({ method: method as 'POST', url, ...(payload ? { payload } : {}) });
  const upload = async (url: string, xml: string) => {
    const form = new FormData();
    form.set('file', new File([xml], 'fil.xml', { type: 'application/xml' }));
    const req = new Request('http://x/', { method: 'POST', body: form });
    return app.inject({
      method: 'POST',
      url,
      payload: Buffer.from(await req.arrayBuffer()),
      headers: { 'content-type': req.headers.get('content-type') ?? '' },
    });
  };
  const id = (
    await send('POST', '/api/competitions', { name: 'Höstträffen', date: '2026-10-10' })
  ).json().id as string;
  const base = `/api/competitions/${id}`;
  const classId = (
    await send('POST', `${base}/classes`, { name: 'H21', class_kind: 'senior', age_class: 21 })
  ).json().id as string;
  await send('POST', `${base}/courses`, {
    name: 'Lång',
    class_id: classId,
    controls: [31, 32].map((control_code, order_idx) => ({ control_code, order_idx })),
  });
  const runner = (
    await send('POST', '/api/competitors', {
      competition_id: id,
      name: 'Alva Almfors',
      club: ALVA.club,
      class_id: classId,
      card_number: ALVA.card,
      consent: true,
    })
  ).json().id as string;
  await send('POST', `${base}/start-race`);
  const clock = (sec: number) => ({ seconds_in_half_day: sec, half_day: 0, weekday: null });
  return {
    app,
    close: async () => {
      await app.close();
      handle.close();
    },
    id,
    runner,
    send,
    upload,
    read: (card: number) =>
      send('POST', '/api/__dev/simulate-read', {
        competition_id: id,
        card_number: card,
        card_type: 'SIAC',
        punches: [31, 32].map((control_code) => ({ control_code, time_ms: null })),
        start: clock(36_000),
        finish: clock(36_600),
      }),
    status: (): string => app.projectionStore.recomputeNow(id)!.competitors.get(runner)!.status,
  };
}

// The fault of 2026-10-12, a changed card number takes a read-out runner's
// result away (routes/_cardResult.ts).
describe('found by the walk and fixed', () => {
  for (const [name, change] of [
    [
      '"Ändra": a new card number',
      (r: Awaited<ReturnType<typeof race>>, extra: object) =>
        r.send('PATCH', `/api/competitors/${r.runner}/profile`, { card_number: 8100099, ...extra }),
    ],
    [
      '"Byt bricka": a new card',
      (r: Awaited<ReturnType<typeof race>>, extra: object) =>
        r.send('POST', '/api/competitors', {
          competition_id: r.id,
          replace_card_for_competitor_id: r.runner,
          card_number: 8300001,
          ...extra,
        }),
    ],
  ] as const) {
    test(`${name} for a runner who has read out is refused, and taken when what is lost is confirmed`, async () => {
      const r = await race();
      try {
        await r.read(8100001);
        assert.equal(r.status(), 'OK');
        const res = await change(r, {});
        assert.equal(res.statusCode, 409, res.body);
        assert.equal(res.json().error, 'has_result');
        assert.equal(res.json().lose_result.card_number, 8100001);
        assert.equal(r.status(), 'OK');
        const confirmed = await change(r, { lose_result: res.json().lose_result });
        assert.equal(confirmed.statusCode, 200, confirmed.body);
        assert.equal(r.status(), 'PEND');
      } finally {
        await r.close();
      }
    });
  }

  test('the start list again, after a card was changed on the day, keeps the result', async () => {
    const r = await race();
    try {
      // The runner's card failed: a new one at the read-out, and a read.
      await r.send('POST', '/api/competitors', {
        competition_id: r.id,
        replace_card_for_competitor_id: r.runner,
        card_number: 8300001,
      });
      await r.read(8300001);
      assert.equal(r.status(), 'OK');
      // The start list from before the day still names the old card.
      const res = await r.upload(
        `/api/competitions/${r.id}/import/startlist`,
        startListXml([ALVA])
      );
      assert.equal(res.statusCode, 201, res.body);
      assert.equal(r.status(), 'OK', `card_updated: ${res.json().card_updated}`);
      assert.equal(res.json().card_kept, 1);
    } finally {
      await r.close();
    }
  });
});

describe('found by the walk, not fixed', () => {
  test(
    'the entry list again adds no runner',
    {
      todo: '.planning/todos/pending/2026-10-11-import-dedupe-cardless-runners.md',
    },
    async () => {
      const r = await race();
      try {
        const xml = entryListXml([{ ...ALVA, given: 'Bo', card: null }]);
        const count = async (): Promise<number> =>
          (await r.send('GET', `/api/competitions/${r.id}/competitors`)).json().competitors.length;
        assert.equal((await r.upload(`/api/competitions/${r.id}/import`, xml)).statusCode, 201);
        assert.equal(await count(), 2);
        assert.equal((await r.upload(`/api/competitions/${r.id}/import`, xml)).statusCode, 201);
        assert.equal(await count(), 2);
      } finally {
        await r.close();
      }
    }
  );

  test(
    'a DQ taken back and set again leaves the runner as before',
    {
      todo: '.planning/todos/pending/2026-10-13-dq-before-read-keeps-punches.md',
    },
    async () => {
      const r = await race();
      try {
        const path = `/api/competitions/${r.id}/competitors/${r.runner}`;
        const dq = () => r.send('POST', `${path}/status`, { status: 'DQ', reason: 'Tjuvstart' });
        const punches = (): number =>
          r.app.projectionStore.recomputeNow(r.id)!.competitors.get(r.runner)!.latest_punches
            .length;
        // Disqualified first, read out afterwards: the punches are shown.
        assert.equal((await dq()).statusCode, 201);
        await r.read(8100001);
        const before = punches();
        assert.equal((await r.send('POST', `${path}/clear-status`)).statusCode, 201);
        assert.equal((await dq()).statusCode, 201);
        assert.equal(punches(), before);
      } finally {
        await r.close();
      }
    }
  );
});
