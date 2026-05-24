// Authored for fartola. Not ported from upstream.
//
// Tests for mopBuilder.ts — MOP XML 2.0 builder from projection state.
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-07-PLAN.md task 1
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-RESEARCH.md Pitfall 5

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { XMLParser } from 'fast-xml-parser';

import { buildMopXml, type MopBuildInput } from './mopBuilder.ts';
import type { CompetitionState, CompetitorView } from '../../projection/types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: false,
  parseAttributeValue: true,
  trimValues: true,
});

function parseXml(xml: string): Record<string, unknown> {
  return parser.parse(xml) as Record<string, unknown>;
}

function makeCompetitorView(overrides: Partial<CompetitorView> = {}): CompetitorView {
  return {
    id: 'comp-1',
    name: 'Anna Svensson',
    club: 'OK Täby',
    class_id: 'cls-1',
    card_number: 1234567,
    status: 'PEND',
    card_read_history: [],
    latest_punches: [],
    latest_start: null,
    latest_finish: null,
    missing_codes: [],
    extra_codes: [],
    out_of_order_codes: [],
    elapsed_time_ms: null,
    manual_dnf_reason: null,
    manual_status: null,
    voided_legs: [],
    start_time_ms: null,
    ...overrides,
  };
}

function makeState(
  opts: {
    competitionId?: string;
    competitors?: Map<string, CompetitorView>;
  } = {}
): CompetitionState {
  return {
    competition_id: opts.competitionId ?? 'comp-id-1',
    competitors: opts.competitors ?? new Map(),
    results_by_class: new Map(),
    pending_unknown_cards: [],
    last_event_seq: 0,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildMopXml', () => {
  it('Test 1: valid MOP XML 2.0 with 2 classes, 3 competitors each', () => {
    // Build 6 competitors across 2 classes
    const competitors = new Map<string, CompetitorView>();
    for (let i = 1; i <= 3; i++) {
      competitors.set(
        `c1-${i}`,
        makeCompetitorView({
          id: `c1-${i}`,
          name: `Runner A${i}`,
          club: 'Club Alpha',
          class_id: 'cls-1',
          card_number: 100 + i,
          status: 'PEND',
        })
      );
    }
    for (let i = 1; i <= 3; i++) {
      competitors.set(
        `c2-${i}`,
        makeCompetitorView({
          id: `c2-${i}`,
          name: `Runner B${i}`,
          club: 'Club Beta',
          class_id: 'cls-2',
          card_number: 200 + i,
          status: 'PEND',
        })
      );
    }

    const input: MopBuildInput = {
      state: makeState({ competitors }),
      competition: { id: 'comp-id-1', name: 'Test Race', date: '2026-05-24' },
      classes: [
        { id: 'cls-1', name: 'H21' },
        { id: 'cls-2', name: 'D21' },
      ],
      clubs: [
        { id: 'org-1', name: 'Club Alpha' },
        { id: 'org-2', name: 'Club Beta' },
      ],
    };

    const xml = buildMopXml(input);

    // Must be parseable and start with the right root
    const parsed = parseXml(xml);
    const root = parsed['MOPComplete'] as Record<string, unknown>;
    assert.ok(root, 'Root element must be MOPComplete');

    // Must have xmlns attribute
    assert.ok(xml.includes('xmlns="http://www.melin.nu/mop"'), 'Must have MOP namespace');

    // Must have a competition element
    assert.ok(root['competition'], 'Must have competition element');

    // Must have cls elements (at least 2)
    const clsRaw = root['cls'];
    const cls = Array.isArray(clsRaw) ? clsRaw : [clsRaw];
    assert.ok(cls.length >= 2, `Expected at least 2 cls elements, got ${cls.length}`);

    // Must have cmp elements (6 total)
    const cmpRaw = root['cmp'];
    const cmp = Array.isArray(cmpRaw) ? cmpRaw : [cmpRaw];
    assert.equal(cmp.length, 6, 'Expected 6 cmp elements');
  });

  it('Test 2: start_time_ms=360000 produces start="3600" (tenths of a second)', () => {
    const competitors = new Map<string, CompetitorView>();
    competitors.set(
      'c1',
      makeCompetitorView({
        id: 'c1',
        name: 'Runner',
        class_id: 'cls-1',
        start_time_ms: 360000,
        status: 'PEND',
      })
    );

    const input: MopBuildInput = {
      state: makeState({ competitors }),
      competition: { id: 'comp-id-1', name: 'Test', date: '2026-05-24' },
      classes: [{ id: 'cls-1', name: 'H21' }],
      clubs: [],
    };

    const xml = buildMopXml(input);
    const parsed = parseXml(xml);
    const root = parsed['MOPComplete'] as Record<string, unknown>;
    const cmpRaw = root['cmp'];
    const cmp = (Array.isArray(cmpRaw) ? cmpRaw : [cmpRaw]) as Array<Record<string, unknown>>;
    assert.equal(cmp.length, 1);
    const base = cmp[0]!['base'] as Record<string, unknown>;
    // 360000 ms / 100 = 3600 tenths
    assert.equal(base['@_st'], 3600, `Expected st=3600, got ${base['@_st']}`);
  });

  it('Test 3: elapsed_time_ms=1234567 produces rt="12346" (Math.round(1234567/100))', () => {
    const competitors = new Map<string, CompetitorView>();
    competitors.set(
      'c1',
      makeCompetitorView({
        id: 'c1',
        name: 'Runner',
        class_id: 'cls-1',
        status: 'OK',
        elapsed_time_ms: 1234567,
      })
    );

    const input: MopBuildInput = {
      state: makeState({ competitors }),
      competition: { id: 'comp-id-1', name: 'Test', date: '2026-05-24' },
      classes: [{ id: 'cls-1', name: 'H21' }],
      clubs: [],
    };

    const xml = buildMopXml(input);
    const parsed = parseXml(xml);
    const root = parsed['MOPComplete'] as Record<string, unknown>;
    const cmpRaw = root['cmp'];
    const cmp = (Array.isArray(cmpRaw) ? cmpRaw : [cmpRaw]) as Array<Record<string, unknown>>;
    const base = cmp[0]!['base'] as Record<string, unknown>;
    // Math.round(1234567 / 100) = Math.round(12345.67) = 12346
    assert.equal(base['@_rt'], 12346, `Expected rt=12346, got ${base['@_rt']}`);
  });

  it('Test 4: status codes map correctly — OK→1, MP→3, PEND→no st', () => {
    const competitors = new Map<string, CompetitorView>();
    competitors.set(
      'ok',
      makeCompetitorView({ id: 'ok', class_id: 'cls-1', status: 'OK', elapsed_time_ms: 3600000 })
    );
    competitors.set('mp', makeCompetitorView({ id: 'mp', class_id: 'cls-1', status: 'MP' }));
    competitors.set('pend', makeCompetitorView({ id: 'pend', class_id: 'cls-1', status: 'PEND' }));

    const input: MopBuildInput = {
      state: makeState({ competitors }),
      competition: { id: 'comp-id-1', name: 'Test', date: '2026-05-24' },
      classes: [{ id: 'cls-1', name: 'H21' }],
      clubs: [],
    };

    const xml = buildMopXml(input);
    const parsed = parseXml(xml);
    const root = parsed['MOPComplete'] as Record<string, unknown>;
    const cmpRaw = root['cmp'];
    const cmps = (Array.isArray(cmpRaw) ? cmpRaw : [cmpRaw]) as Array<Record<string, unknown>>;

    // Map by id
    const byId = new Map(cmps.map((c) => [String(c['@_id']), c]));

    const okBase = byId.get('ok')!['base'] as Record<string, unknown>;
    const mpBase = byId.get('mp')!['base'] as Record<string, unknown>;
    const pendBase = byId.get('pend')!['base'] as Record<string, unknown>;

    // OK → stat=1
    assert.equal(okBase['@_stat'], 1, `OK should map to stat=1, got ${okBase['@_stat']}`);
    // MP → stat=3
    assert.equal(mpBase['@_stat'], 3, `MP should map to stat=3, got ${mpBase['@_stat']}`);
    // PEND → stat=0 (unknown/not started yet)
    // The spec uses 0 for unknown; PEND has no completed status
    assert.equal(pendBase['@_stat'], 0, `PEND should map to stat=0, got ${pendBase['@_stat']}`);
  });
});
