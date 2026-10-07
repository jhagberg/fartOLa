// Authored for fartola. Not ported from upstream.
//
// Radio punches are events in the log but results come from card reads only:
// the projection is identical with and without them.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { openDatabase } from '../../db/index.ts';
import {
  classes,
  competitors,
  controls,
  courseControls,
  courses,
  events,
} from '../../db/schema.ts';
import { loadCompetitionInputs } from '../../projection/loader.ts';
import { reduce } from '../../projection/reduce.ts';
import { insertEvent } from '../../si/eventInserter.ts';
import { localToEpochMs } from '../../time/competitionClock.ts';
import { createRocPoller } from './poller.ts';

const COMP = 'comp-1';
const DATE = '2026-10-04';
const NOON = localToEpochMs(DATE, 12 * 3600);

describe('radio punches and results', () => {
  test('the projection is identical with and without radio punches', async () => {
    const handle = openDatabase(':memory:');
    handle.sqlite
      .prepare(
        `INSERT INTO competitions (id, name, date, receipt_template, auto_print, created_at_ms,
           roc_competition_id, roc_enabled, roc_start_id, race_started_at_ms)
         VALUES (?, 'C1', ?, 'classic', 0, 0, '2380', 1, 1, ?)`
      )
      .run(COMP, DATE, NOON - 3600_000);
    handle.db.insert(classes).values({ id: 'cls', competitionId: COMP, name: 'H21' }).run();
    handle.db
      .insert(courses)
      .values({ id: 'crs', competitionId: COMP, name: 'C', classId: 'cls' })
      .run();
    handle.db.update(classes).set({ courseId: 'crs' }).where(eq(classes.id, 'cls')).run();
    for (const [i, code] of [78, 100].entries()) {
      handle.db
        .insert(controls)
        .values({ id: `ctl-${code}`, competitionId: COMP, code })
        .run();
      handle.db
        .insert(courseControls)
        .values({ id: `cc-${code}`, courseId: 'crs', controlId: `ctl-${code}`, orderIdx: i })
        .run();
    }
    handle.db
      .insert(competitors)
      .values({
        id: 'c1',
        competitionId: COMP,
        name: 'Test Runner',
        classId: 'cls',
        cardNumber: 9_000_001,
        consentStatus: 'explicit',
        source: 'entrylist',
      })
      .run();
    const clock = (sec: number) => ({
      half_day: (sec >= 43200 ? 1 : 0) as 0 | 1,
      seconds_in_half_day: sec % 43200,
      weekday: null,
    });
    insertEvent(
      handle,
      'node-A',
      'card_read',
      NOON,
      {
        event_type: 'card_read',
        card_number: 9_000_001,
        card_type: 'SI10',
        start: clock(11 * 3600),
        finish: clock(11 * 3600 + 900),
        check: null,
        clear: null,
        punch_count: 2,
        punches: [
          { code: 78, ...clock(11 * 3600 + 300) },
          { code: 100, ...clock(11 * 3600 + 600) },
        ],
        card_holder: null,
      },
      COMP
    );

    const project = () => reduce(loadCompetitionInputs(handle, COMP)!);
    const before = project();
    assert.equal(before.competitors.get('c1')?.status, 'OK');

    const fetchImpl = (async () =>
      new Response(
        [
          '1;78;9000001;2026-10-04 11:05:00',
          '2;100;9000001;2026-10-03 11:10:00',
          '3;78;9000009;2026-10-04 11:07:00',
        ].join('\r\n')
      )) as unknown as typeof fetch;
    const poller = createRocPoller({ handle, nodeId: 'node-A', fetchImpl, now: () => NOON });
    assert.equal((await poller.pollOnce(COMP))?.inserted, 3);
    assert.equal(
      handle.db.select().from(events).where(eq(events.eventType, 'radio_punch')).all().length,
      3
    );

    assert.deepEqual(project(), before);
  });
});
