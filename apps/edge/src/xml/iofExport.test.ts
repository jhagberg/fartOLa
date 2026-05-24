// Authored for fartola. Not ported from upstream.
//
// node:test coverage for the IOF XML 3.0 ResultList builder (plan 16 task 1).
//
// Eight tests cover the locked surfaces:
//   1. Frozen fixture byte-equality round-trip (deterministic createTime).
//   2. validateAndBuild on the seeded scenario → valid=true via the bundled XSD.
//   3. W-4 @status enum regression gate: Final→Complete, Provisional→Snapshot.
//   4. Class with zero non-PEND rows is omitted from the output.
//   5. W-5 empty competition VALID — zero ClassResult children, validateXml
//      accepts, @status still emitted.
//   6. Competitor with null club has no Organisation element.
//   7. Status mapping for OK/MP/DNF (PEND omitted entirely).
//   8. Round-trip parse via fast-xml-parser confirms structural fields.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-16-PLAN.md task 1

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';

import {
  buildResultListXml,
  validateAndBuild,
  splitName,
  statusForXml,
  resultListStatusFor,
  type ExportInput,
} from './iofExport.ts';
import type { CompetitionState, CompetitorView, ResultView } from '../projection/types.ts';
import type { CompetitionDTO, ClassDTO } from '@fartola/shared-types';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// PATTERNS S-5: HERE-based path resolution. The frozen-fixture lives next to
// the bundled IOF.xsd under apps/edge/test/fixtures (one directory up from
// src/xml/, then test/fixtures/).
const FIXTURE_PATH = path.resolve(
  HERE,
  '..',
  '..',
  'test',
  'fixtures',
  'iof30-resultlist-expected.xml'
);

// ---------------------------------------------------------------------------
// Fixture builder — the locked seed scenario from plan 16 task 1.
// ---------------------------------------------------------------------------

const FIXED_CREATE_TIME = new Date('2026-05-19T18:30:00.000Z');

function makeCompetition(): CompetitionDTO {
  return {
    id: 'comp-stortuna-tisdag',
    name: 'StorTuna Tisdag',
    date: '2026-05-19',
    receipt_template: 'classic',
    auto_print: false,
    created_at_ms: 1_716_120_000_000,
    race_started_at_ms: null,
  };
}

function makeClasses(): ClassDTO[] {
  return [
    { id: 'cls-h21', competition_id: 'comp-stortuna-tisdag', name: 'H21', short_name: null },
    { id: 'cls-d21', competition_id: 'comp-stortuna-tisdag', name: 'D21', short_name: null },
  ];
}

function makeCompetitorView(
  partial: Partial<CompetitorView> & {
    id: string;
    name: string;
    class_id: string;
    status: CompetitorView['status'];
    elapsed_time_ms: number | null;
  }
): CompetitorView {
  return {
    id: partial.id,
    name: partial.name,
    club: partial.club ?? null,
    class_id: partial.class_id,
    card_number: partial.card_number ?? null,
    status: partial.status,
    card_read_history: [],
    latest_punches: [],
    latest_start: null,
    latest_finish: null,
    missing_codes: [],
    extra_codes: [],
    out_of_order_codes: [],
    elapsed_time_ms: partial.elapsed_time_ms,
    manual_dnf_reason: null,
    manual_status: null,
    voided_legs: [],
    start_time_ms: null,
  };
}

interface SeedRow {
  competitor: CompetitorView;
  place: number | null;
}

/** Build a CompetitionState manually so the fixture test does not depend on
 * the reducer. Two classes, three competitors, one OK + one MP + one DNF. */
function makeSeededState(): CompetitionState {
  const anna = makeCompetitorView({
    id: 'cmp-anna',
    name: 'Anna Andersson',
    club: 'StorTuna OK',
    class_id: 'cls-h21',
    card_number: 7501853,
    status: 'OK',
    elapsed_time_ms: 720_000, // 12 minutes
  });
  const bo = makeCompetitorView({
    id: 'cmp-bo',
    name: 'Bo Berg',
    club: 'StorTuna OK',
    class_id: 'cls-h21',
    card_number: 1428824,
    status: 'MP',
    elapsed_time_ms: 800_000, // 13 min 20 s
  });
  const cia = makeCompetitorView({
    id: 'cmp-cia',
    name: 'Cia Carlsson',
    club: null,
    class_id: 'cls-d21',
    card_number: 248215,
    status: 'DNF',
    elapsed_time_ms: null,
  });

  const h21Rows: ResultView[] = [rowFor(anna, 1), rowFor(bo, null)];
  const d21Rows: ResultView[] = [rowFor(cia, null)];

  const competitors = new Map<string, CompetitorView>();
  competitors.set(anna.id, anna);
  competitors.set(bo.id, bo);
  competitors.set(cia.id, cia);

  const results_by_class = new Map<string, ResultView[]>();
  results_by_class.set('cls-h21', h21Rows);
  results_by_class.set('cls-d21', d21Rows);

  return {
    competition_id: 'comp-stortuna-tisdag',
    competitors,
    results_by_class,
    pending_unknown_cards: [],
    last_event_seq: 0,
  };
}

function rowFor(c: CompetitorView, place: number | null): ResultView {
  return {
    competitor_id: c.id,
    name: c.name,
    club: c.club,
    status: c.status,
    elapsed_time_ms: c.elapsed_time_ms,
    place,
    behind_leader_ms: null,
  };
}

// `_seedRowsTouched`-style helper retained for clarity; SeedRow type kept so
// future tests can extend the seed without re-discovering the shape.
const _SEED_INTERFACE_PROBE: SeedRow | null = null;
void _SEED_INTERFACE_PROBE;

function makeInput(overrides: Partial<ExportInput> = {}): ExportInput {
  return {
    competition: makeCompetition(),
    classes: makeClasses(),
    courses: [],
    state: makeSeededState(),
    status: 'Final',
    creator: 'fartOLa test v0.0',
    now: () => FIXED_CREATE_TIME,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildResultListXml — frozen fixture + structural guarantees', () => {
  test('test 1: byte-equal output matches the frozen fixture (seeded scenario)', () => {
    const { xml } = buildResultListXml(makeInput());
    const expected = readFileSync(FIXTURE_PATH, 'utf8');
    // Normalize trailing newline so an editor's auto-append never breaks
    // the assertion. The builder emits no trailing \n; the committed
    // fixture also has none.
    assert.equal(xml.replace(/\s+$/, ''), expected.replace(/\s+$/, ''));
  });

  test('test 2: validateAndBuild on the seeded scenario → valid=true', async () => {
    const result = await validateAndBuild(makeInput());
    if (!result.valid) {
      const messages = result.errors.map((e) => `${e.line ?? '?'}: ${e.message}`).join('\n');
      assert.fail(`Expected validateAndBuild to pass; got errors:\n${messages}`);
    }
    assert.equal(result.build.summary.class_count, 2);
    assert.equal(result.build.summary.person_result_count, 3);
    assert.equal(result.build.summary.status, 'Final');
  });

  test('test 3: @status enum regression gate — Final→Complete, Provisional→Snapshot', () => {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseAttributeValue: false,
    });
    // Locked enum per the bundled IOF.xsd ResultListStatus restriction.
    const ALLOWED = new Set(['Complete', 'Delta', 'Snapshot']);

    for (const status of ['Final', 'Provisional'] as const) {
      const { xml } = buildResultListXml(makeInput({ status }));
      const parsed = parser.parse(xml) as { ResultList: { '@_status': string } };
      const got = parsed.ResultList['@_status'];
      assert.ok(
        ALLOWED.has(got),
        `@status="${got}" must be in {Complete, Delta, Snapshot}; got: ${got}`
      );
      assert.equal(got, status === 'Final' ? 'Complete' : 'Snapshot');
    }
  });

  test('test 4: a class with zero non-PEND rows is omitted from output', () => {
    const state = makeSeededState();
    // Replace D21's lone DNF row with a PEND so the whole class becomes
    // unexportable.
    const pendCia = makeCompetitorView({
      id: 'cmp-cia',
      name: 'Cia Carlsson',
      club: null,
      class_id: 'cls-d21',
      card_number: 248215,
      status: 'PEND',
      elapsed_time_ms: null,
    });
    state.competitors.set(pendCia.id, pendCia);
    state.results_by_class.set('cls-d21', [rowFor(pendCia, null)]);

    const { xml, summary } = buildResultListXml(makeInput({ state }));
    assert.equal(summary.class_count, 1);
    assert.ok(xml.includes('<Name>H21</Name>'));
    assert.ok(!xml.includes('<Name>D21</Name>'));
  });

  test('test 5: empty competition emits a VALID empty ResultList (W-5 gate)', async () => {
    // No competitor views, no class rows — just the two empty classes.
    const emptyState: CompetitionState = {
      competition_id: 'comp-stortuna-tisdag',
      competitors: new Map(),
      results_by_class: new Map(),
      pending_unknown_cards: [],
      last_event_seq: 0,
    };
    const { xml, summary } = buildResultListXml(makeInput({ state: emptyState }));
    assert.equal(summary.class_count, 0);
    assert.equal(summary.person_result_count, 0);

    // XSD-valid via the bundled IOF.xsd.
    const result = await validateAndBuild(makeInput({ state: emptyState }));
    assert.equal(result.valid, true, 'empty-competition export must be XSD-valid');

    // Parse and verify zero ClassResult children + status present.
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const parsed = parser.parse(xml) as {
      ResultList: { '@_status': string; ClassResult?: unknown };
    };
    assert.equal(parsed.ResultList['@_status'], 'Complete');
    assert.equal(parsed.ResultList.ClassResult, undefined);

    // The default-status path (no `status` override) under Provisional also
    // round-trips clean — provisional empties still emit a single root
    // element with a Snapshot status.
    const provResult = await validateAndBuild(
      makeInput({ state: emptyState, status: 'Provisional' })
    );
    assert.equal(provResult.valid, true);
    if (provResult.valid) {
      const provParsed = parser.parse(provResult.build.xml) as {
        ResultList: { '@_status': string };
      };
      assert.equal(provParsed.ResultList['@_status'], 'Snapshot');
    }
  });

  test('test 6: competitor with null club has no <Organisation> element', () => {
    const { xml } = buildResultListXml(makeInput());
    // Cia (D21) is club=null → her PersonResult is the only one in D21,
    // so the entire D21 ClassResult block is the easiest place to assert.
    const ciaSlice = xml.slice(xml.indexOf('Carlsson') - 200, xml.indexOf('Carlsson') + 400);
    assert.ok(!ciaSlice.includes('Organisation'), 'club=null must not emit <Organisation>');
    // Anna (H21, club non-null) DOES emit Organisation with type="Club".
    assert.ok(xml.includes('<Organisation type="Club">'));
    assert.ok(xml.includes('StorTuna OK'));
  });

  test('Phase 2.0: DNS/DQ/CANCEL/MAX rows round-trip into XSD-valid IOF XML', async () => {
    const state = makeSeededState();
    const cmps: Array<['DNS' | 'DQ' | 'CANCEL' | 'MAX', string, string]> = [
      ['DNS', 'cmp-dns', 'Erik Eriksson'],
      ['DQ', 'cmp-dq', 'Fia Forsberg'],
      ['CANCEL', 'cmp-cancel', 'Gustav Gren'],
      ['MAX', 'cmp-max', 'Hanna Hagberg'],
    ];
    for (const [status, id, name] of cmps) {
      const view = makeCompetitorView({
        id,
        name,
        club: 'StorTuna OK',
        class_id: 'cls-h21',
        card_number: 9000000 + state.competitors.size,
        status,
        elapsed_time_ms: status === 'MAX' ? 9_000_000 : null,
      });
      state.competitors.set(view.id, view);
      state.results_by_class.get('cls-h21')!.push(rowFor(view, null));
    }
    const res = await validateAndBuild(makeInput({ state }));
    assert.equal(res.valid, true, `XSD-invalid output: ${JSON.stringify(res)}`);
    if (res.valid) {
      assert.ok(res.build.xml.includes('<Status>DidNotStart</Status>'));
      assert.ok(res.build.xml.includes('<Status>Disqualified</Status>'));
      assert.ok(res.build.xml.includes('<Status>Cancelled</Status>'));
      assert.ok(res.build.xml.includes('<Status>OverTime</Status>'));
    }
  });

  test('test 7: per-competitor status mapping — OK/MP/DNF emitted, PEND omitted', () => {
    const state = makeSeededState();
    // Add a PEND row to H21 (extra competitor with no card read yet).
    const dani = makeCompetitorView({
      id: 'cmp-dani',
      name: 'Dani Danielsson',
      club: 'StorTuna OK',
      class_id: 'cls-h21',
      card_number: 8888888,
      status: 'PEND',
      elapsed_time_ms: null,
    });
    state.competitors.set(dani.id, dani);
    const h21Rows = state.results_by_class.get('cls-h21')!;
    h21Rows.push(rowFor(dani, null));

    const { xml, summary } = buildResultListXml(makeInput({ state }));
    // PEND not emitted → total person_result_count unchanged from the seed (3).
    assert.equal(summary.person_result_count, 3);
    assert.ok(!xml.includes('Danielsson'), 'PEND competitor must not appear');
    assert.ok(xml.includes('<Status>OK</Status>'));
    assert.ok(xml.includes('<Status>MissingPunch</Status>'));
    assert.ok(xml.includes('<Status>DidNotFinish</Status>'));
  });

  test('test 8: round-trip parse confirms structural fields', () => {
    const { xml } = buildResultListXml(makeInput());
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseAttributeValue: false,
    });
    const parsed = parser.parse(xml) as {
      ResultList: {
        '@_iofVersion': string;
        '@_status': string;
        Event: { Name: string; StartTime: { Date: string } };
        ClassResult:
          | Array<{
              Class: { Name: string };
              PersonResult:
                | Array<{
                    Person: { Name: { Family: string; Given: string } };
                    Result: { Status: string; Time?: number; Position?: number };
                  }>
                | {
                    Person: { Name: { Family: string; Given: string } };
                    Result: { Status: string; Time?: number; Position?: number };
                  };
            }>
          | {
              Class: { Name: string };
              PersonResult: unknown;
            };
      };
    };

    assert.equal(parsed.ResultList['@_iofVersion'], '3.0');
    assert.equal(parsed.ResultList['@_status'], 'Complete');
    assert.equal(parsed.ResultList.Event.Name, 'StorTuna Tisdag');
    assert.equal(parsed.ResultList.Event.StartTime.Date, '2026-05-19');

    const classResultArr = Array.isArray(parsed.ResultList.ClassResult)
      ? parsed.ResultList.ClassResult
      : [parsed.ResultList.ClassResult];
    assert.equal(classResultArr.length, 2);
    assert.equal(classResultArr[0]!.Class.Name, 'H21');
    assert.equal(classResultArr[1]!.Class.Name, 'D21');

    // H21 PersonResult is an array of 2 entries; D21 is a single object.
    const h21Persons = Array.isArray(classResultArr[0]!.PersonResult)
      ? classResultArr[0]!.PersonResult
      : [classResultArr[0]!.PersonResult];
    assert.equal(h21Persons.length, 2);
    const anna = h21Persons.find(
      (p: { Person: { Name: { Family: string } } }) => p.Person.Name.Family === 'Andersson'
    ) as {
      Person: { Name: { Family: string; Given: string } };
      Result: { Status: string; Time?: number; Position?: number };
    };
    assert.equal(anna.Person.Name.Given, 'Anna');
    assert.equal(anna.Result.Status, 'OK');
    assert.equal(anna.Result.Time, 720);
    assert.equal(anna.Result.Position, 1);
  });
});

// ---------------------------------------------------------------------------
// Pure-helper unit tests — splitName, statusForXml, resultListStatusFor.
// ---------------------------------------------------------------------------

describe('iofExport — helper functions', () => {
  test('splitName splits on the LAST space (Swedish convention)', () => {
    assert.deepEqual(splitName('Anna Andersson'), { family: 'Andersson', given: 'Anna' });
    assert.deepEqual(splitName('Sven Olof Karlsson'), {
      family: 'Karlsson',
      given: 'Sven Olof',
    });
    assert.deepEqual(splitName('Madonna'), { family: 'Madonna', given: '' });
    assert.deepEqual(splitName(''), { family: '', given: '' });
    assert.deepEqual(splitName('  Bo Berg  '), { family: 'Berg', given: 'Bo' });
  });

  test('statusForXml maps the projection PunchStatus to the IOF ResultStatus enum', () => {
    assert.equal(statusForXml('OK'), 'OK');
    assert.equal(statusForXml('MP'), 'MissingPunch');
    assert.equal(statusForXml('DNF'), 'DidNotFinish');
    assert.equal(statusForXml('PEND'), null);
    // Phase 2.0 (2026-05-18) — the four operator-asserted states. Each maps
    // to an enumeration value present in apps/edge/src/xml/IOF.xsd (lines
    // 2994 / 2931 / 3008 / 2959). The validator gate stays on byte-for-byte
    // (`validateAndBuild` keeps the build/validate contract); these asserts
    // only check the wire-level mapping is in sync with the XSD enum.
    assert.equal(statusForXml('DNS'), 'DidNotStart');
    assert.equal(statusForXml('DQ'), 'Disqualified');
    assert.equal(statusForXml('CANCEL'), 'Cancelled');
    assert.equal(statusForXml('MAX'), 'OverTime');
  });

  test('resultListStatusFor maps the export-status toggle to the IOF @status enum', () => {
    assert.equal(resultListStatusFor('Final'), 'Complete');
    assert.equal(resultListStatusFor('Provisional'), 'Snapshot');
  });
});
