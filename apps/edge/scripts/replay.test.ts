// Authored for fartola. Not ported from upstream.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { formatReport, replay } from './replay.ts';

const NS = 'xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0"';
const EVENT = '<Event><Name>Prov</Name><StartTime><Date>2026-10-03</Date></StartTime></Event>';
const person = (id: string, family: string) =>
  `<Person><Id>${id}</Id><Name><Family>${family}</Family><Given>Test</Given></Name></Person><Organisation><Name>OK Prov</Name></Organisation>`;

/** SI clock fields for a local time on the competition day (CEST). */
const clock = (h: number, m: number) => {
  const s = h * 3600 + m * 60;
  return { seconds_in_half_day: s % 43200, half_day: s >= 43200 ? 1 : 0, weekday: null };
};

function read(card: number, codes: number[], startH: number, finishM: number, atMs: number) {
  return {
    schema_version: 1,
    event: 'card_read',
    ts_ms: atMs,
    device_path: 'replay',
    card_type: 'SIAC',
    card_number: card,
    start: clock(startH, 0),
    finish: clock(startH, finishM),
    check: null,
    clear: null,
    punch_count: codes.length,
    punches: codes.map((code, i) => ({ code, ...clock(startH, i + 1) })),
    card_holder: null,
  };
}

function fixture(dir: string): void {
  writeFileSync(
    path.join(dir, 'CourseData.xml'),
    `<?xml version="1.0" encoding="UTF-8"?><CourseData ${NS}><Event><Name>Prov</Name><Class><Name>H12</Name></Class><Class><Name>D12</Name></Class></Event>` +
      '<RaceCourseData><Control type="Start"><Id>S1</Id></Control><Control><Id>31</Id></Control><Control><Id>32</Id></Control><Control type="Finish"><Id>F1</Id></Control>' +
      '<Course><Name>Gul</Name><CourseControl type="Start"><Control>S1</Control></CourseControl><CourseControl><Control>31</Control></CourseControl><CourseControl><Control>32</Control></CourseControl><CourseControl type="Finish"><Control>F1</Control></CourseControl></Course>' +
      '<ClassCourseAssignment><ClassName>H12</ClassName><CourseName>Gul</CourseName></ClassCourseAssignment>' +
      '<ClassCourseAssignment><ClassName>D12</ClassName><CourseName>Gul</CourseName></ClassCourseAssignment></RaceCourseData></CourseData>'
  );
  const runners = [
    ['R1', 'Ett', 8100001, 'H12'],
    ['R2', 'Tva', 8100002, 'D12'],
    ['R3', 'Tre', 8100003, 'H12'],
  ] as const;
  writeFileSync(
    path.join(dir, 'EntryList.xml'),
    `<?xml version="1.0" encoding="UTF-8"?><EntryList ${NS}>${EVENT}` +
      runners
        .map(
          ([id, f, card, cls]) =>
            `<PersonEntry>${person(id, f)}<ControlCard punchingSystem="SI">${card}</ControlCard><Class><Name>${cls}</Name></Class></PersonEntry>`
        )
        .join('') +
      '</EntryList>'
  );
  writeFileSync(
    path.join(dir, 'StartList.xml'),
    `<?xml version="1.0" encoding="UTF-8"?><StartList ${NS}>${EVENT}` +
      runners
        .map(
          ([id, f, card, cls]) =>
            `<ClassStart><Class><Name>${cls}</Name></Class><PersonStart>${person(id, f)}<Start><StartTime>2026-10-03T10:00:00+02:00</StartTime><ControlCard punchingSystem="SI">${card}</ControlCard></Start></PersonStart></ClassStart>`
        )
        .join('') +
      '</StartList>'
  );
  const at = Date.parse('2026-10-03T08:30:00Z');
  writeFileSync(
    path.join(dir, 'readouts.ndjson'),
    [
      read(8100001, [31, 32], 10, 20, at), // OK 20:00
      read(8100002, [31, 99, 32], 10, 25, at + 1000), // extra punch: still OK, 25:00
      read(8100003, [32], 10, 15, at + 2000), // missed 31: MP
    ]
      .map((r) => JSON.stringify(r))
      .join('\n') + '\n'
  );
  writeFileSync(
    path.join(dir, 'expected.json'),
    JSON.stringify([
      { runner: 'R1', card: 8100001, className: 'H12', status: 'OK', time: 1200 },
      { runner: 'R2', card: 8100002, className: 'D12', status: 'OK', time: 1500 },
      { runner: 'R3', card: 8100003, className: 'H12', status: 'MissingPunch', time: null },
    ])
  );
  writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ source: { event: 'Prov', date: '2026-10-03' } })
  );
}

describe('replay script', () => {
  test('imports, replays the reads and matches the official result 3/3', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fartola-replay-'));
    try {
      fixture(dir);
      const report = await replay(dir);
      assert.deepEqual(report.mismatches, []);
      assert.equal(report.equal, 3);
      assert.match(formatReport(report), /^3\/3 lika/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
