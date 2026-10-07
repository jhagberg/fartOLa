// Authored for fartola. Not ported from upstream.
//
// Vitest coverage for the radio-control status view helpers, the API client
// URLs and the i18n catalogue (sv + en). Pure-helper style, like
// SettingsView.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RadioControlStatus, RadioStatus } from '@fartola/shared-types';
import {
  baselineKey,
  formatDelay,
  latestOnly,
  radioControlView,
  rocLinkProblem,
  sortedRadioViews,
} from './radio-status.ts';

const OFFSET = 120;
const NOW = Date.UTC(2026, 9, 4, 9, 30, 0);

function control(over: Partial<RadioControlStatus>): RadioControlStatus {
  return {
    role: 'control',
    unknown_unit: false,
    control_code: 78,
    state: 'ok',
    last_heard_ms: NOW - 3 * 60_000,
    median_delay_ms: 2000,
    listed: false,
    received: 40,
    window_card_punches: 12,
    window_matched: 12,
    coverage: 1,
    siac_card_punches: 0,
    siac_matched: 0,
    other_card_punches: 12,
    other_matched: 12,
    siac_problem: false,
    date_mismatch_count: 0,
    ...over,
  };
}

function status(controls: RadioControlStatus[], poll: RadioStatus['poll'] = null): RadioStatus {
  return {
    settings: {
      enabled: true,
      roc_competition_id: '2380',
      start_id: 1,
      last_id: 2,
      radio_controls: [],
      start_codes: [],
      check_codes: [],
      finish_codes: [],
      heard_codes: [],
    },
    poll,
    now_ms: NOW,
    clock_offset_min: OFFSET,
    window_min: 20,
    silence_min: 10,
    coverage_threshold: 0.8,
    controls,
  };
}

describe('radioControlView', () => {
  it('gives every state a text label key and a symbol (never colour alone)', () => {
    const symbols = new Set<string>();
    for (const state of ['ok', 'few', 'silent'] as const) {
      const v = radioControlView(control({ state }), NOW, OFFSET);
      expect(v.labelKey).toBe(`radio.state.${state}`);
      expect(v.symbol.length).toBeGreaterThan(0);
      symbols.add(v.symbol);
    }
    expect(symbols.size).toBe(3);
  });

  it('shows minutes since last heard and coverage as matched/total', () => {
    const v = radioControlView(
      control({ window_matched: 9, window_card_punches: 12 }),
      NOW,
      OFFSET
    );
    expect(v.agoMin).toBe(3);
    expect(v.coverageText).toBe('9/12');
    expect(
      radioControlView(control({ window_card_punches: 0 }), NOW, OFFSET).coverageText
    ).toBeNull();
  });

  it('carries the date warning count next to the state', () => {
    expect(radioControlView(control({ date_mismatch_count: 4 }), NOW, OFFSET).dateWarnings).toBe(4);
  });
});

describe('sortedRadioViews', () => {
  it('lists the worst first: silent, few, date warning, ok', () => {
    const out = sortedRadioViews(
      status([
        control({ control_code: 1 }),
        control({ control_code: 2, date_mismatch_count: 1 }),
        control({ control_code: 3, state: 'few' }),
        control({ control_code: 4, state: 'silent' }),
      ])
    );
    expect(out.map((v) => v.code)).toEqual([4, 3, 2, 1]);
  });
});

describe('radio view extras', () => {
  it('a listed control never heard has no last-heard time', () => {
    const v = radioControlView(
      control({ last_heard_ms: null, median_delay_ms: null, listed: true, state: 'silent' }),
      NOW,
      OFFSET
    );
    expect(v.lastHeard).toBeNull();
    expect(v.agoMin).toBeNull();
    expect(v.delayText).toBeNull();
  });
  it('formats the delay and flags SIAC', () => {
    expect(formatDelay(3000)).toBe('3 s');
    expect(formatDelay(-300_000)).toBe('5 min');
    expect(radioControlView(control({ median_delay_ms: 2000 }), NOW, OFFSET).delayText).toBe('2 s');
    expect(radioControlView(control({ siac_problem: true }), NOW, OFFSET).siacProblem).toBe(true);
  });
  it('names the baseline in plain words', () => {
    expect(baselineKey(status([]))).toEqual({ key: 'radio.baseline.from', id: 1 });
    const pending = status([]);
    pending.settings.start_id = null;
    expect(baselineKey(pending).key).toBe('radio.baseline.pending');
  });
});

describe('unit names and the SIAC warning numbers', () => {
  it('names a finish unit, an unknown unit and an ordinary control apart', () => {
    const unit20 = radioControlView(
      control({
        role: 'finish',
        control_code: 20,
        siac_problem: true,
        other_card_punches: 15,
        other_matched: 13,
        siac_card_punches: 25,
        siac_matched: 1,
      }),
      NOW,
      OFFSET
    );
    expect(unit20.nameKey).toBe('radio.name.finish');
    expect(unit20.key).toBe('finish:20');
    expect(unit20.otherPct).toBe(87);
    expect(unit20.siacPct).toBe(4);
    const unknown = radioControlView(
      control({ role: 'start', control_code: 0, unknown_unit: true }),
      NOW,
      OFFSET
    );
    expect(unknown.nameKey).toBe('radio.name.start.unknown');
    expect(unknown.key).toBe('start:unknown');
    expect(radioControlView(control({}), NOW, OFFSET).key).toBe('control:78');
  });
  it('has Swedish texts for the unit names and the Mål enhet 20 warning', async () => {
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    expect(sv['radio.name.finish']).toBe('Mål enhet {{code}}');
    expect(sv['radio.siacProblem']).toContain('kontrollera Air+-inställningen');
    const { t } = await import('../i18n/index.ts');
    expect(
      t('radio.siacProblem', { what: t('radio.name.finish', { code: 20 }), other: 87, siac: 4 })
    ).toBe('Mål enhet 20: vanliga brickor 87 %, SIAC 4 % – kontrollera Air+-inställningen');
  });
});

describe('latestOnly', () => {
  it('ignores the response of a request that a later one has replaced', async () => {
    const begin = latestOnly();
    const applied: string[] = [];
    const load = async (comp: string, ms: number): Promise<void> => {
      const isCurrent = begin();
      await new Promise((r) => setTimeout(r, ms));
      if (isCurrent()) applied.push(comp);
    };
    // A is requested first and answers last; the operator has moved to B.
    await Promise.all([load('A', 30), load('B', 5)]);
    expect(applied).toEqual(['B']);
  });
  it('lets the only request through', () => {
    const begin = latestOnly();
    expect(begin()()).toBe(true);
  });
});

describe('rocLinkProblem', () => {
  it('is null without poll data or with a healthy poll', () => {
    expect(rocLinkProblem(status([]))).toBeNull();
    const ok = { last_poll_at: 1, last_success_at: 1, last_error: null, consecutive_failures: 0 };
    expect(rocLinkProblem(status([], ok))).toBeNull();
  });
  it('reports consecutive failures with the error', () => {
    const bad = {
      last_poll_at: 2,
      last_success_at: 1,
      last_error: 'ROC HTTP 500',
      consecutive_failures: 3,
    };
    expect(rocLinkProblem(status([], bad))).toBe('ROC HTTP 500');
  });
});

describe('radio API client', () => {
  beforeEach(() => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(status([])), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    ) as unknown as typeof fetch;
  });
  afterEach(() => vi.restoreAllMocks());

  it('GETs status and PATCHes settings on the radio routes', async () => {
    const { getRadioStatus, setRadioSettings } = await import('../api/client.ts');
    await getRadioStatus('c 1');
    await setRadioSettings('c 1', { enabled: true, roc_competition_id: '2380' });
    const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]![0]).toBe('/api/competitions/c%201/radio/status');
    expect(calls[1]![0]).toBe('/api/competitions/c%201/radio/settings');
    expect((calls[1]![1] as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((calls[1]![1] as RequestInit).body as string)).toEqual({
      enabled: true,
      roc_competition_id: '2380',
    });
  });
});

describe('radio i18n keys', () => {
  const KEYS = [
    'radio.title',
    'radio.state.ok',
    'radio.state.few',
    'radio.state.silent',
    'radio.dateWarning',
    'radio.lastHeard',
    'radio.coverage',
    'radio.none',
    'radio.linkOk',
    'radio.linkProblem',
    'radio.loadError',
    'radio.siacProblem',
    'radio.name.control',
    'radio.name.start',
    'radio.name.check',
    'radio.name.finish',
    'radio.name.finish.unknown',
    'settings.radio.startCodes',
    'settings.radio.checkCodes',
    'settings.radio.finishCodes',
    'settings.radio.unitsHelp',
    'settings.radio.heard',
    'radio.neverHeard',
    'radio.delay',
    'radio.baseline.from',
    'radio.baseline.pending',
    'settings.radio.startId',
    'settings.radio.startIdHelp',
    'settings.radio.controls',
    'settings.radio.controlsHelp',
    'settings.radio.title',
    'settings.radio.description',
    'settings.radio.enabled',
    'settings.radio.id',
    'settings.radio.save',
    'settings.radio.saved',
    'settings.radio.invalid',
    'settings.radio.saveError',
  ];
  it('exist in sv and en', async () => {
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    const en = (await import('../i18n/en.json')).default as Record<string, string>;
    for (const k of KEYS) {
      expect(sv[k], `sv ${k}`).toBeTruthy();
      expect(en[k], `en ${k}`).toBeTruthy();
    }
    expect(sv['radio.state.few']).toBe('Få stämplingar');
    expect(sv['radio.state.silent']).toBe('Tyst');
    expect(sv['radio.baseline.from']).toContain('{{id}}');
  });
});
