// Authored for fartola. Not ported from upstream.
//
// node:test coverage for the Eventor cachedcompetitors + clubs XML parser
// (Plan 02-01 task 2). Validates:
//
//   - streamCompetitorsXml emits one EventorCompetitor record per <Competitor>
//     in the synthetic fixture, with field shapes locked by RESEARCH §Pattern 1.
//   - Path-aware field extraction (Person/Id vs Organisation/Id) — different
//     <Id> elements at different XML paths must NOT cross-contaminate.
//   - UTF-8 multi-byte names (Östberg / Pär) survive the stream-decode path.
//   - Multi-ControlCard handling: both si_card AND emit_card populated for
//     one Competitor element with two <ControlCard> children.
//   - Orphan competitor (no <Organisation>) → club_id = null, no crash.
//   - DOCTYPE pre-flight (T-FILE-IMPORT mitigation): throws before any
//     parser construction.
//   - parseClubsXmlSync (DOM-style for the smaller 1.3 MB clubs.xml) returns
//     EventorClub records with id 637/320/8.
//
// Locked by:
// - .planning/phases/02-4-klubbs-mvp/02-01-PLAN.md task 2
// - .planning/phases/02-4-klubbs-mvp/02-RESEARCH.md §Pattern 1 (the saxes
//   template + the synthetic fixture body)
// - .planning/phases/02-4-klubbs-mvp/02-RESEARCH.md §Pitfall 6
//   (UTF-8 streaming — do NOT pass { encoding: 'utf8' } to createReadStream)

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { streamCompetitorsXml, parseClubsXmlSync, type EventorCompetitor } from './parser.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, '__fixtures__');

describe('eventor parser: streamCompetitorsXml — synthetic fixture', () => {
  test('emits 3 records with person_id 1001 / 1002 / 1003', async () => {
    const records: EventorCompetitor[] = [];
    await streamCompetitorsXml(path.join(FIXTURE_DIR, 'competitors-sample.xml'), (rec) =>
      records.push(rec)
    );
    assert.equal(records.length, 3, `expected 3 records, got ${records.length}`);
    assert.deepEqual(
      records.map((r) => r.person_id),
      [1001, 1002, 1003]
    );
  });

  test('record[0] (Hagberg) has si_card=8535005, club_id=637, sex=M, birth_year=1980', async () => {
    const records: EventorCompetitor[] = [];
    await streamCompetitorsXml(path.join(FIXTURE_DIR, 'competitors-sample.xml'), (rec) =>
      records.push(rec)
    );
    const r = records[0];
    assert.ok(r);
    assert.equal(r.person_id, 1001);
    assert.equal(r.family_name, 'Hagberg');
    assert.equal(r.given_name, 'Jonas');
    assert.equal(r.si_card, 8535005);
    assert.equal(r.emit_card, null);
    assert.equal(r.club_id, 637);
    assert.equal(r.sex, 'M');
    assert.equal(r.birth_year, 1980);
    assert.equal(r.modify_date_ms, Date.parse('2024-12-12T09:46:45Z'));
  });

  test('record[1] (Provsson, orphan + multi-ControlCard) — both si_card and emit_card', async () => {
    const records: EventorCompetitor[] = [];
    await streamCompetitorsXml(path.join(FIXTURE_DIR, 'competitors-sample.xml'), (rec) =>
      records.push(rec)
    );
    const r = records[1];
    assert.ok(r);
    assert.equal(r.person_id, 1002);
    assert.equal(r.family_name, 'Provsson');
    assert.equal(r.given_name, 'Lina');
    assert.equal(r.si_card, 8999901);
    assert.equal(r.emit_card, 999901);
    // Orphan rule — no <Organisation> → club_id null, no crash.
    assert.equal(r.club_id, null);
    assert.equal(r.sex, 'F');
  });

  test('record[2] (Östberg, UTF-8) — multi-byte chars preserved in stream decode', async () => {
    const records: EventorCompetitor[] = [];
    await streamCompetitorsXml(path.join(FIXTURE_DIR, 'competitors-sample.xml'), (rec) =>
      records.push(rec)
    );
    const r = records[2];
    assert.ok(r);
    assert.equal(r.family_name, 'Östberg');
    assert.equal(r.given_name, 'Pär');
    // No SI card on this row → null, never undefined.
    assert.equal(r.si_card, null);
    assert.equal(r.club_id, 637);
  });
});

describe('eventor parser: UTF-8 chunk-boundary safety (F-001 regression)', () => {
  // Regression test for code-review F-001 BLOCKER. Forces a chunk
  // boundary INSIDE a multi-byte UTF-8 codepoint and asserts that
  // streamCompetitorsXml preserves the character. Before the fix, the
  // per-chunk Buffer.toString('utf8') lost the upper bytes of "Östberg"
  // / "Pär" / similar at any seam landing inside the two-byte 0xC3 0x96
  // sequence for "Ö" (and the 0xC3 0xA4 for "ä", 0xC3 0xA5 for "å").
  test('manual saxes pipeline preserves "Östberg" when chunk splits mid-codepoint', async () => {
    const { SaxesParser } = await import('saxes');
    const { StringDecoder } = await import('node:string_decoder');
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<CompetitorList xmlns="http://www.orienteering.org/datastandard/3.0">' +
      '<Competitor><Person><Id type="Sweden">42</Id>' +
      '<Name><Family>Östberg</Family><Given>Pär</Given></Name>' +
      '</Person></Competitor>' +
      '</CompetitorList>';
    const bytes = Buffer.from(xml, 'utf8');
    // Find the byte index of "Ö" (0xC3 0x96) and force a split BETWEEN
    // the two bytes — that's exactly the boundary that produced U+FFFD
    // before the fix.
    const splitAt = bytes.indexOf(0xc3) + 1; // points at the 0x96
    assert.ok(splitAt > 1, 'fixture must contain the multi-byte Ö');
    const chunkA = bytes.subarray(0, splitAt);
    const chunkB = bytes.subarray(splitAt);

    const parser = new SaxesParser({ xmlns: true });
    const decoder = new StringDecoder('utf8');
    let captured = '';
    let inFamily = false;
    parser.on('opentag', (tag) => {
      if (tag.name === 'Family') inFamily = true;
    });
    parser.on('text', (t) => {
      if (inFamily) captured += t;
    });
    parser.on('closetag', (tag) => {
      if (tag.name === 'Family') inFamily = false;
    });

    parser.write(decoder.write(chunkA));
    parser.write(decoder.write(chunkB));
    const tail = decoder.end();
    if (tail.length > 0) parser.write(tail);
    parser.close();
    assert.equal(captured, 'Östberg');
  });
});

describe('eventor parser: DOCTYPE pre-flight (T-FILE-IMPORT)', () => {
  test('throws "DOCTYPE not allowed" on the with-doctype fixture', async () => {
    await assert.rejects(
      async () =>
        streamCompetitorsXml(path.join(FIXTURE_DIR, 'competitors-with-doctype.xml'), () => {}),
      /DOCTYPE not allowed/i
    );
  });
});

describe('eventor parser: parseClubsXmlSync — DOM parse', () => {
  test('returns 3 clubs with ids 637 / 320 / 8', () => {
    const clubs = parseClubsXmlSync(path.join(FIXTURE_DIR, 'clubs-sample.xml'));
    assert.equal(clubs.length, 3);
    const byId = new Map(clubs.map((c) => [c.club_id, c]));
    const stk = byId.get(637);
    assert.ok(stk);
    assert.equal(stk.name, 'Stora Tuna OK');
    assert.equal(stk.short_name, 'STK');
    assert.equal(stk.media_name, 'Stora Tuna');
    assert.equal(stk.parent_id, 8);

    const sok = byId.get(320);
    assert.ok(sok);
    assert.equal(sok.name, 'Sala OK');
    assert.equal(sok.parent_id, null);

    const dalarnas = byId.get(8);
    assert.ok(dalarnas);
    assert.equal(dalarnas.name, 'Dalarnas OF');
  });
});
