// Authored for fartola. Not ported from upstream.
//
// node:test coverage for the IOF XML 3.0 root-dispatching parser. Locked
// behavior + T-FILE-IMPORT pre-flight asserted in one place so a future
// regression on the security gate fails loudly.
//
// Covers:
// - test 1: parseIofXml(<CourseData sample>) → kind CourseData with the
//   expected counts (2 classes, 4 controls, 2 courses) and ordered control
//   codes per course.
// - test 2: parseIofXml(<EntryList sample>) → kind EntryList with the
//   expected 3 competitors, including null club + null card_number where
//   the source has no Organisation / no ControlCard element.
// - test 3 (T-FILE-IMPORT): parseIofXml(<xml-bomb>) throws 'DOCTYPE not
//   allowed' BEFORE the parser sees the bytes.
// - test 4 (C-L2 wording): parseIofXml('<UnknownRoot/>') throws with the
//   Purple-Pen-aware message distinguishing CourseData from EntryList.
// - test 5: parseIofXml('') throws.
// - test 6: parseIofXml(malformed XML) throws.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-05-PLAN.md task 1
// - .planning/phases/01-single-laptop-training-mvp/01-PATTERNS.md S-5
//   (fixture-relative path resolution via import.meta.url)

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parseIofXml } from './parse.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(HERE, '..', '..', 'test', 'fixtures');

function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}

describe('parseIofXml', () => {
  test('test 1: CourseData sample → 2 classes, 4 controls, 2 courses with ordered codes', () => {
    const xml = readFixture('iof30-coursedata-sample.xml');
    const parsed = parseIofXml(xml);
    assert.equal(parsed.kind, 'CourseData');
    if (parsed.kind !== 'CourseData') throw new Error('unreachable');
    const d = parsed.data;
    assert.equal(d.event_name, 'StorTuna Tisdag');
    assert.equal(d.classes.length, 2);
    const classNames = d.classes.map((c) => c.name).sort();
    assert.deepEqual(classNames, ['D21', 'H21']);
    assert.equal(d.controls.length, 4);
    const codes = d.controls.map((c) => c.code).sort((a, b) => a - b);
    assert.deepEqual(codes, [31, 32, 33, 34]);

    assert.equal(d.courses.length, 2);
    const bana1 = d.courses.find((c) => c.name === 'Bana 1');
    assert.ok(bana1);
    assert.deepEqual(bana1.control_codes, [31, 32, 33, 34]);
    assert.equal(bana1.length_m, 3500);
    assert.equal(bana1.climb_m, 45);
    assert.equal(bana1.class_id_ref, 'H21');

    const bana2 = d.courses.find((c) => c.name === 'Bana 2');
    assert.ok(bana2);
    assert.deepEqual(bana2.control_codes, [34, 33, 32, 31]);
    assert.equal(bana2.class_id_ref, 'D21');
  });

  test('02.1-14 Task 4: every ClassCourseAssignment is kept (two classes on one course)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CourseData xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0">
  <Event><Name>Shared</Name>
    <Class><Name>H21</Name></Class><Class><Name>D21</Name></Class>
  </Event>
  <RaceCourseData>
    <Control><Id>31</Id></Control>
    <Course><Name>Bana 1</Name><CourseControl><Control>31</Control></CourseControl></Course>
    <ClassCourseAssignment><ClassName>H21</ClassName><CourseName>Bana 1</CourseName></ClassCourseAssignment>
    <ClassCourseAssignment><ClassName>D21</ClassName><CourseName>Bana 1</CourseName></ClassCourseAssignment>
  </RaceCourseData>
</CourseData>`;
    const parsed = parseIofXml(xml);
    if (parsed.kind !== 'CourseData') throw new Error('unreachable');
    const bana1 = parsed.data.courses[0]!;
    assert.deepEqual(bana1.class_refs, ['H21', 'D21']);
  });

  test('test 2: EntryList sample → 3 competitors; null club + null card_number where source omits them', () => {
    const xml = readFixture('iof30-entrylist-sample.xml');
    const parsed = parseIofXml(xml);
    assert.equal(parsed.kind, 'EntryList');
    if (parsed.kind !== 'EntryList') throw new Error('unreachable');
    const d = parsed.data;
    assert.equal(d.event_name, 'StorTuna Tisdag');
    assert.equal(d.competitors.length, 3);

    const anna = d.competitors[0];
    assert.ok(anna);
    assert.equal(anna.name, 'Anna Andersson');
    assert.equal(anna.club, 'StorTuna OK');
    assert.equal(anna.class_name, 'H21');
    assert.equal(anna.card_number, 7501853);

    // Bo Berg has no ControlCard → card_number must be null.
    const bo = d.competitors[1];
    assert.ok(bo);
    assert.equal(bo.name, 'Bo Berg');
    assert.equal(bo.card_number, null);

    // Cia Carlsson has no Organisation → club must be null.
    const cia = d.competitors[2];
    assert.ok(cia);
    assert.equal(cia.name, 'Cia Carlsson');
    assert.equal(cia.club, null);
    assert.equal(cia.card_number, 1428824);
  });

  test('test 3 (T-FILE-IMPORT): xml-bomb DOCTYPE rejected at pre-flight', () => {
    const xml = readFixture('iof30-xml-bomb.xml');
    assert.throws(() => parseIofXml(xml), /DOCTYPE not allowed/);
  });

  test('test 4 (C-L2): unknown root element throws with Purple-Pen-aware message', () => {
    assert.throws(
      () => parseIofXml('<?xml version="1.0"?><UnknownRoot/>'),
      (err: Error) => {
        return (
          /Unsupported XML root element: UnknownRoot/.test(err.message) &&
          /CourseData/.test(err.message) &&
          /EntryList/.test(err.message) &&
          /Purple Pen/.test(err.message)
        );
      }
    );
  });

  test('test 5: empty input throws', () => {
    assert.throws(() => parseIofXml(''), /Empty XML input/);
  });

  test('test 6: malformed XML throws', () => {
    // Unclosed tag — fast-xml-parser surfaces this through .parse() ordinarily,
    // but with strict ordering it may also tolerate it. Either way the parse
    // result has no recognisable root and we surface a useful error.
    assert.throws(
      () => parseIofXml('<NotARealRoot><inner></NotARealRoot>'),
      /Malformed XML|Unsupported XML root element/
    );
  });

  test('test 7: ENTITY declaration rejected even without DOCTYPE', () => {
    const adversarial =
      '<?xml version="1.0"?><!ENTITY x "lolz"><CourseData iofVersion="3.0"><Event><Name>x</Name></Event></CourseData>';
    assert.throws(() => parseIofXml(adversarial), /ENTITY declarations not allowed/);
  });
});
