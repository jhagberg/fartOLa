// Authored for fartola. Not ported from upstream.
//
// startListClasses: what the StartList export and the Eventor push send per
// class and runner (SOFT TR 7.5.4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { openDatabase } from '../db/index.ts';
import { classes, competitions, competitors, courses } from '../db/schema.ts';
import { startListClasses } from './_startListInputs.ts';

test('SOFT TR 7.5.4: startListClasses gives course, start place and bibs per class', () => {
  const handle = openDatabase(':memory:');
  try {
    const db = handle.db;
    db.insert(competitions)
      .values({
        id: 'c1',
        name: 'Test',
        date: '2026-05-24',
        receiptTemplate: 'classic',
        autoPrint: false,
        createdAtMs: 1,
      })
      .run();
    db.insert(classes)
      .values([
        { id: 'h21', competitionId: 'c1', name: 'H21', startName: 'Start 1' },
        { id: 'd21', competitionId: 'c1', name: 'D21' },
      ])
      .run();
    db.insert(courses)
      .values([
        { id: 'co1', competitionId: 'c1', name: 'Bana 1', lengthM: 5400, climbM: 120 },
        // A legacy course found by its class_id.
        { id: 'co2', competitionId: 'c1', name: 'Bana 2', classId: 'd21', lengthM: 4100 },
      ])
      .run();
    db.update(classes).set({ courseId: 'co1' }).where(eq(classes.id, 'h21')).run();
    db.insert(competitors)
      .values([
        {
          id: 'r1',
          competitionId: 'c1',
          name: 'Anna A',
          classId: 'h21',
          startTimeMs: 2e12,
          bib: '101',
        },
        { id: 'r2', competitionId: 'c1', name: 'Bo B', classId: 'd21', startTimeMs: 2e12 },
      ])
      .run();

    const byName = new Map(startListClasses(handle, 'c1').map((c) => [c.name, c]));
    const [h21, d21] = [byName.get('H21'), byName.get('D21')];
    assert.deepEqual(h21, {
      name: 'H21',
      course: { name: 'Bana 1', lengthM: 5400, climbM: 120 },
      startName: 'Start 1',
      competitors: [{ name: 'Anna A', club: null, startTimeMs: 2e12, bibNumber: '101' }],
    });
    assert.deepEqual(d21, {
      name: 'D21',
      course: { name: 'Bana 2', lengthM: 4100, climbM: null },
      startName: null,
      competitors: [{ name: 'Bo B', club: null, startTimeMs: 2e12 }],
    });
  } finally {
    handle.close();
  }
});
