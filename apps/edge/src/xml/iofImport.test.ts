// Authored for fartola. Not ported from upstream.
//
// node:test coverage for importStartList (plan 02.1-03 task 2).
//
// Tests cover:
//   1. Valid StartList → structured array of ImportedStartEntry.
//   2. StartTime parsed to epoch ms (UTC ISO with Z suffix round-trips).
//   3. Entry without StartTime is kept with startTimeMs=null (02.1-14 Task 6;
//      it used to be excluded silently).
//   4. SI card extracted from ControlCard element.
//   5. Eventor person ID extracted from Person.Id[@type='Eventor'].
//   6. Multi-class StartList → entries grouped and tagged by className.
//   7. Non-StartList root element → throws.
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-03-PLAN.md task 2

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { importStartList } from './iofImport.ts';
import { buildStartListXml as exportStartListXml } from './iofExport.ts';
import { localToEpochMs } from '../time/competitionClock.ts';

// ---------------------------------------------------------------------------
// Fixture XML builders.
// ---------------------------------------------------------------------------

function buildStartListXml({
  classes,
}: {
  classes: Array<{
    name: string;
    persons: Array<{
      given: string;
      family: string;
      startTime?: string | null;
      siCard?: number | null;
      eventorId?: number | null;
      bibNumber?: string | null;
    }>;
  }>;
}): string {
  const classParts = classes
    .map(({ name, persons }) => {
      const personParts = persons
        .map(({ given, family, startTime, siCard, eventorId, bibNumber }) => {
          const idEl =
            eventorId !== null && eventorId !== undefined
              ? `<Id type="Eventor">${eventorId}</Id>`
              : '';
          const startEl =
            startTime !== undefined && startTime !== null
              ? `<Start>
                ${bibNumber != null ? `<BibNumber>${bibNumber}</BibNumber>` : ''}
                <StartTime>${startTime}</StartTime>
                ${siCard != null ? `<ControlCard punchingSystem="SI">${siCard}</ControlCard>` : ''}
              </Start>`
              : `<Start/>`;
          return `<PersonStart>
            <Person>
              ${idEl}
              <Name>
                <Family>${family}</Family>
                <Given>${given}</Given>
              </Name>
            </Person>
            ${startEl}
          </PersonStart>`;
        })
        .join('\n');
      return `<ClassStart>
        <Class><Name>${name}</Name></Class>
        ${personParts}
      </ClassStart>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<StartList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0"
           createTime="2026-05-19T18:00:00Z" creator="fartola test">
  <Event>
    <Name>StorTuna Tisdag</Name>
    <StartTime><Date>2026-05-19</Date></StartTime>
  </Event>
  ${classParts}
</StartList>`;
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe('importStartList', () => {
  test('test 1: valid StartList returns structured ImportedStartEntry array', () => {
    const xml = buildStartListXml({
      classes: [
        {
          name: 'H21',
          persons: [{ given: 'Anna', family: 'Andersson', startTime: '2026-05-19T10:00:00Z' }],
        },
      ],
    });
    const entries = importStartList(xml, 120);
    assert.equal(entries.length, 1);
    const e = entries[0]!;
    assert.equal(e.className, 'H21');
    assert.equal(e.givenName, 'Anna');
    assert.equal(e.familyName, 'Andersson');
    assert.equal(e.name, 'Anna Andersson');
  });

  test('test 2: StartTime parsed to epoch ms (UTC Z suffix)', () => {
    const startTime = '2026-05-19T10:30:00Z';
    const xml = buildStartListXml({
      classes: [
        {
          name: 'D21',
          persons: [{ given: 'Bo', family: 'Berg', startTime }],
        },
      ],
    });
    const entries = importStartList(xml, 120);
    assert.equal(entries.length, 1);
    const expected = new Date(startTime).getTime();
    assert.equal(entries[0]!.startTimeMs, expected);
  });

  test('a StartTime without an offset is on the competition clock, whatever the host time zone', () => {
    const saved = process.env['TZ'];
    process.env['TZ'] = 'UTC'; // a UTC host: Date.parse would read 10:00 as 10:00Z
    try {
      const xml = buildStartListXml({
        classes: [
          {
            name: 'H21',
            persons: [
              { given: 'Anna', family: 'Andersson', startTime: '2026-10-03T10:00:00' },
              { given: 'Bo', family: 'Berg', startTime: '2026-01-15T10:00:00.5' },
              // In the hour skipped when DST starts: one instant on a fixed clock.
              { given: 'Cia', family: 'Carlsson', startTime: '2026-03-29T02:00:54' },
            ],
          },
        ],
      });
      const [anna, bo, cia] = importStartList(xml, 120);
      assert.equal(anna!.startTimeMs, Date.parse('2026-10-03T08:00:00Z'));
      assert.equal(bo!.startTimeMs, Date.parse('2026-01-15T08:00:00.5Z'));
      assert.equal(cia!.startTimeMs, Date.parse('2026-03-29T00:00:54Z'));
      // The competition's offset, not the zone's at each time.
      const [, bo60, cia60] = importStartList(xml, 60);
      assert.equal(bo60!.startTimeMs, Date.parse('2026-01-15T09:00:00.5Z'));
      assert.equal(cia60!.startTimeMs, Date.parse('2026-03-29T01:00:54Z'));
    } finally {
      if (saved === undefined) delete process.env['TZ'];
      else process.env['TZ'] = saved;
    }
  });

  test('a StartTime with an offset is taken as given', () => {
    const xml = buildStartListXml({
      classes: [
        {
          name: 'H21',
          persons: [{ given: 'Anna', family: 'Andersson', startTime: '2026-10-03T10:00:00+01:00' }],
        },
      ],
    });
    assert.equal(importStartList(xml, 120)[0]!.startTimeMs, Date.parse('2026-10-03T09:00:00Z'));
  });

  // 02.1-14 Task 6 changed this: the entry used to be dropped silently; it is
  // now kept with startTimeMs=null so the import route reports it as skipped.
  test('test 3: entry without StartTime is kept with startTimeMs null', () => {
    const xml = buildStartListXml({
      classes: [
        {
          name: 'H21',
          persons: [
            { given: 'Anna', family: 'Andersson', startTime: '2026-05-19T10:00:00Z' },
            { given: 'Bo', family: 'Berg', startTime: null }, // no start time
          ],
        },
      ],
    });
    const entries = importStartList(xml, 120);
    assert.deepEqual(
      entries.map((e) => [e.row, e.name, e.startTimeMs]),
      [
        [1, 'Anna Andersson', Date.parse('2026-05-19T10:00:00Z')],
        [2, 'Bo Berg', null],
      ]
    );
  });

  test('test 4: SI card extracted from ControlCard element', () => {
    const xml = buildStartListXml({
      classes: [
        {
          name: 'H21',
          persons: [
            {
              given: 'Anna',
              family: 'Andersson',
              startTime: '2026-05-19T10:00:00Z',
              siCard: 7501853,
            },
          ],
        },
      ],
    });
    const entries = importStartList(xml, 120);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.siCard, 7501853);
  });

  test('test 5: Eventor person ID extracted from Person.Id[@type=Eventor]', () => {
    const xml = buildStartListXml({
      classes: [
        {
          name: 'H21',
          persons: [
            {
              given: 'Anna',
              family: 'Andersson',
              startTime: '2026-05-19T10:00:00Z',
              eventorId: 12345,
            },
          ],
        },
      ],
    });
    const entries = importStartList(xml, 120);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.eventorPersonId, 12345);
  });

  test('test 6: multi-class StartList — entries tagged by className', () => {
    const xml = buildStartListXml({
      classes: [
        {
          name: 'H21',
          persons: [{ given: 'Anna', family: 'Andersson', startTime: '2026-05-19T10:00:00Z' }],
        },
        {
          name: 'D21',
          persons: [
            { given: 'Bo', family: 'Berg', startTime: '2026-05-19T10:02:00Z' },
            { given: 'Cia', family: 'Carlsson', startTime: '2026-05-19T10:04:00Z' },
          ],
        },
      ],
    });
    const entries = importStartList(xml, 120);
    assert.equal(entries.length, 3);
    const h21 = entries.filter((e) => e.className === 'H21');
    const d21 = entries.filter((e) => e.className === 'D21');
    assert.equal(h21.length, 1);
    assert.equal(d21.length, 2);
    assert.equal(h21[0]!.name, 'Anna Andersson');
    assert.equal(d21[0]!.name, 'Bo Berg');
    assert.equal(d21[1]!.name, 'Cia Carlsson');
  });

  test('test 7: non-StartList root element throws', () => {
    const xml =
      '<?xml version="1.0"?><ResultList iofVersion="3.0"><Event><Name>X</Name></Event></ResultList>';
    assert.throws(() => importStartList(xml, 120), /StartList/);
  });

  test('bibNumber extracted when present', () => {
    const xml = buildStartListXml({
      classes: [
        {
          name: 'H21',
          persons: [
            {
              given: 'Anna',
              family: 'Andersson',
              startTime: '2026-05-19T10:00:00Z',
              bibNumber: '42',
            },
          ],
        },
      ],
    });
    const entries = importStartList(xml, 120);
    assert.equal(entries[0]!.bibNumber, '42');
  });

  test('02.1-14 Task 1: export → import round trip keeps the same epoch start time', () => {
    const startTimeMs = localToEpochMs('2026-10-03', 10 * 3600 + 30);
    const { xml } = exportStartListXml({
      competition: {
        id: 'c1',
        name: 'Round Trip',
        date: '2026-10-03',
        receipt_template: 'classic',
        auto_print: false,
        created_at_ms: 0,
        race_started_at_ms: null,
        timing_format: 'seconds',
        clock_offset_min: 120,
      },
      classes: [{ name: 'H21', competitors: [{ name: 'Anna Andersson', startTimeMs }] }],
    });
    const entries = importStartList(xml, 120);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.startTimeMs, startTimeMs);
  });
});
