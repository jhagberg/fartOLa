// Authored for fartola. Not ported from upstream.
//
// Vitest coverage for the per-class "Starttid räknas från" select in
// LottningView (02.1-14 Task 14, replaces Task 11's "Ej startstämpling"
// checkbox). Pure-helper style like CompetitionInfoView.test.ts: i18n keys
// + the client call the select makes. Below: the M1 draw modes (pure body
// builder, and the mounted view with a routed fake fetch).

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import {
  buildLottningBody,
  refusalOf,
  seedGroupsFromInput,
  visibleFields,
  type DrawForm,
} from './lottning.ts';
import { ApiError } from '../api/client.ts';

describe('02.1-14 Task 14 — start method per class', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sv + en have the select keys; the old checkbox key is gone', async () => {
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    const en = (await import('../i18n/en.json')).default as Record<string, string>;
    expect(sv['lottning.startMethod']).toBe('Starttid räknas från');
    expect(sv['lottning.startMethod.auto']).toBe('Automatiskt');
    expect(sv['lottning.startMethod.start_time']).toBe('Starttid');
    expect(sv['lottning.startMethod.start_punch']).toBe('Startstämpling');
    for (const key of [
      'lottning.startMethod',
      'lottning.startMethod.auto',
      'lottning.startMethod.start_time',
      'lottning.startMethod.start_punch',
    ]) {
      expect(en[key], `missing en key ${key}`).toBeTruthy();
    }
    expect(sv['lottning.ignoreStartPunch']).toBeUndefined();
  });

  it('patchClass sends start_method to the class PATCH route', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const { patchClass } = await import('../api/client.ts');
    await patchClass('comp-1', 'cls-1', { start_method: 'start_punch' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/competitions/comp-1/classes/cls-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ start_method: 'start_punch' });
  });
});

// ---------------------------------------------------------------------------
// M1 draw modes: the POST body per mode, seeding groups, and a refused draw
// in plain Swedish with its confirm path (ADR-0016 rules 1 and 6).
// ---------------------------------------------------------------------------

const FORM: DrawForm = {
  mode: 'SOFT',
  drawType: 'All',
  firstStartMs: 1_000_000,
  intervalSec: 120,
  vacantSlots: 0,
  vacantPosition: 'Mixed',
  bestFirst: false,
  restartMs: 2_000_000,
  maxBehindMin: 30,
  scale: 1,
};

describe('M1 — draw body per mode (mirrors the edge LottningInput)', () => {
  it('a whole-class SOFT draw sends vacancies with their position only when there are any', () => {
    expect(buildLottningBody(FORM)).toEqual({
      mode: 'SOFT',
      firstStartMs: 1_000_000,
      intervalSec: 120,
    });
    expect(buildLottningBody({ ...FORM, vacantSlots: 2, vacantPosition: 'Last' })).toEqual({
      mode: 'SOFT',
      firstStartMs: 1_000_000,
      intervalSec: 120,
      vacantSlots: 2,
      vacantPosition: 'Last',
    });
  });

  it('SOFT TR 7.5.7/7.5.8: late entrants send drawType and no first start or vacancies', () => {
    expect(buildLottningBody({ ...FORM, drawType: 'RemainingVacant', vacantSlots: 3 })).toEqual({
      mode: 'SOFT',
      drawType: 'RemainingVacant',
      intervalSec: 120,
    });
  });

  it('SOFT TR 7.4.1: pursuit sends restart, max behind in seconds, no vacancies', () => {
    expect(buildLottningBody({ ...FORM, mode: 'ReversePursuit', vacantSlots: 2 })).toEqual({
      mode: 'ReversePursuit',
      firstStartMs: 1_000_000,
      intervalSec: 120,
      restartMs: 2_000_000,
      maxBehindSec: 1800,
    });
    expect(buildLottningBody({ ...FORM, mode: 'Pursuit', scale: 0.5 }).scale).toBe(0.5);
    expect(visibleFields('Pursuit', 'All')).toMatchObject({ vacancies: false, pursuit: true });
  });

  it('SOFT TR 7.4.5: seeded sends bestFirst; mass start sends interval 0', () => {
    expect(buildLottningBody({ ...FORM, mode: 'Seeded', bestFirst: true }).bestFirst).toBe(true);
    expect(buildLottningBody({ ...FORM, mode: 'Simultaneous' }).intervalSec).toBe(0);
  });

  it('seeding fields become groups, strongest first; bad input is refused', () => {
    expect(seedGroupsFromInput(['a', 'b', 'c', 'd'], { a: '2', b: '1', c: '', d: ' 2 ' })).toEqual([
      ['b'],
      ['a', 'd'],
    ]);
    expect(seedGroupsFromInput(['a'], { a: 'x' })).toBeNull();
    expect(seedGroupsFromInput(['a'], { a: '0' })).toBeNull();
  });

  it('refusals map to Swedish keys with the confirm path', () => {
    const err = (status: number, body: unknown) =>
      new ApiError(status, 'x', body, JSON.stringify(body));
    expect(refusalOf(err(409, { error: 'class_kind_unconfirmed' }), 'H12')).toEqual({
      key: 'lottning.err.classKindUnconfirmed',
      fix: 'class_kind',
      vars: { class: 'H12' },
    });
    expect(refusalOf(err(409, { error: 'competition_level_unknown' }), 'H21').fix).toBe('level');
    expect(
      refusalOf(err(422, { error: 'pursuit_not_allowed', rule: 'SOFT TR 7.4.1' }), 'H12').key
    ).toBe('lottning.err.pursuitNotAllowed');
    expect(
      refusalOf(err(400, { errors: [{ path: 'restartMs', code: 'custom', message: 'm' }] }), 'H')
    ).toEqual({ key: 'lottning.err.invalidField', fieldKey: 'lottning.restart' });
  });

  it('every refusal and mode label exists in sv and en, and names the SOFT rule', async () => {
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    const en = (await import('../i18n/en.json')).default as Record<string, string>;
    const keys = Object.keys(sv).filter(
      (k) => k.startsWith('lottning.err.') || k.startsWith('lottning.drawType')
    );
    expect(keys.length).toBeGreaterThan(15);
    for (const k of keys) expect(en[k], k).toBeTruthy();
    expect(sv['lottning.err.pursuitNotAllowed']).toContain('SOFT TR 7.4.1');
    expect(sv['lottning.err.seedingNotAllowed']).toContain('SOFT TR 7.4.5');
    expect(sv['lottning.err.vacantInElite']).toContain('SOFT TR 7.5.8');
  });
});

describe('LottningView (mounted)', () => {
  let component: ReturnType<typeof mount> | null = null;
  let posts: Array<{ url: string; body: Record<string, unknown> }>;
  let puts: Array<{ url: string; body: unknown }>;
  let drawAnswer: { status: number; body: unknown };
  let startList: unknown[];
  let seeding: Array<{ id: string; seed_group: number }>;
  let previousResults: { results: number; ok: number };
  /** When set, the competition GET (the clock) waits for it. */
  let holdClock: Promise<void> | null;
  /** The previous-results upload waits for it. */
  let holdUpload: Promise<void>;
  let classKindSource: string;

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
      await tick();
    }
    flushSync();
  };

  beforeEach(() => {
    posts = [];
    puts = [];
    startList = [];
    seeding = [];
    previousResults = { results: 0, ok: 0 };
    holdClock = null;
    holdUpload = Promise.resolve();
    classKindSource = 'name';
    drawAnswer = { status: 201, body: { drawn: 2 } };
    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.endsWith('/import/previous-results')) {
        await holdUpload;
        return json({ results: 2, matched: 2, unmatched: [] }, 201);
      }
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (init?.method === 'POST') {
        posts.push({ url, body });
        return json(drawAnswer.body, drawAnswer.status);
      }
      if (init?.method === 'PUT') {
        puts.push({ url, body });
        if (url.endsWith('/classes/kinds')) classKindSource = 'operator';
        return json({ ok: true });
      }
      if (url.endsWith('/start-times/history')) return json({ items: [] });
      if (url.endsWith('/classes/kinds'))
        return json({
          eventor: 'not_linked',
          items: [
            {
              class_id: 'h12',
              name: 'H12',
              class_kind: 'ungdom',
              age_class: 12,
              class_kind_source: classKindSource,
              suggestion: { class_kind: 'ungdom', age_class: 12, source: 'name' },
            },
          ],
        });
      if (url.endsWith('/classes'))
        return json({
          classes: [
            {
              id: 'h12',
              competition_id: 'c1',
              name: 'H12',
              short_name: null,
              class_kind: 'ungdom',
              age_class: 12,
              class_kind_source: classKindSource,
            },
          ],
        });
      if (url.includes('/lottning/'))
        return json({
          class: { id: 'h12', name: 'H12' },
          start_list: startList,
          seeding,
          previous_results: previousResults,
        });
      if (url.endsWith('/competitors'))
        return json({
          competitors: [
            {
              id: 'r1',
              name: 'Anna',
              club: 'OK A',
              class_id: 'h12',
              start_time_ms: startList.length > 0 ? 1 : null,
            },
            { id: 'r2', name: 'Bo', club: 'OK B', class_id: 'h12', start_time_ms: null },
          ],
        });
      if (holdClock !== null) await holdClock;
      return json({
        competition: { id: 'c1', date: '2026-10-08', clock_offset_min: 120, level: 'niva3' },
        classes: [],
        courses: [],
      });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
  });

  const $ = (id: string) => document.querySelector(`[data-testid="${id}"]`);
  const choose = async (id: string, value: string) => {
    const el = $(id) as HTMLSelectElement;
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  };

  it('shows the class kind, its status and the level; previews what the draw will do', async () => {
    const { default: LottningView } = await import('./LottningView.svelte');
    component = mount(LottningView, { target: document.body, props: { competitionId: 'c1' } });
    await settle();
    expect($('lottning-class-kind')!.textContent).toContain('Ungdom (D/H10–16)');
    expect($('lottning-class-kind')!.textContent).toContain('inte bekräftad');
    expect($('lottning-level')!.textContent).toContain('Nivå 3');
    expect($('lottning-preview')!.textContent).toBe('2 löpare i H12 får ny starttid.');
  });

  it('an unconfirmed class kind refuses pursuit with the reason and confirms it right there', async () => {
    drawAnswer = {
      status: 409,
      body: { error: 'class_kind_unconfirmed', message: 'Bekräfta klasstyp för H12' },
    };
    const { default: LottningView } = await import('./LottningView.svelte');
    component = mount(LottningView, { target: document.body, props: { competitionId: 'c1' } });
    await settle();
    await choose('lottning-mode-select', 'Pursuit');
    expect($('lottning-pursuit')).not.toBeNull();
    expect($('lottning-vacants')).toBeNull();
    ($('lottning-draw-btn') as HTMLButtonElement).click();
    await settle();
    expect(posts[0]!.body).toMatchObject({ mode: 'Pursuit', maxBehindSec: 1800 });
    expect($('lottning-refusal')!.textContent).toContain(
      'Klasstypen för H12 är bara gissad från klassnamnet.'
    );

    ($('class-kind-confirm') as HTMLButtonElement).click();
    await settle();
    expect(puts[0]!.body).toEqual({
      items: [{ class_id: 'h12', class_kind: 'ungdom', age_class: 12 }],
    });
    expect($('lottning-refusal')).toBeNull();
    expect($('lottning-done')!.textContent).toBe('Klasstypen är sparad. Tryck på Lotta igen.');
    expect($('lottning-class-kind')!.getAttribute('data-status')).toBe('operator');
  });

  it('SOFT TR 7.4.1: a banned pursuit is explained with the rule', async () => {
    drawAnswer = { status: 422, body: { error: 'pursuit_not_allowed', rule: 'SOFT TR 7.4.1' } };
    const { default: LottningView } = await import('./LottningView.svelte');
    component = mount(LottningView, { target: document.body, props: { competitionId: 'c1' } });
    await settle();
    await choose('lottning-mode-select', 'ReversePursuit');
    ($('lottning-draw-btn') as HTMLButtonElement).click();
    await settle();
    expect($('lottning-refusal')!.textContent).toContain('(SOFT TR 7.4.1)');
    expect($('class-kinds')).toBeNull();
  });

  it('SOFT TR 7.4.5: a seeded draw saves the typed groups before drawing', async () => {
    const { default: LottningView } = await import('./LottningView.svelte');
    component = mount(LottningView, { target: document.body, props: { competitionId: 'c1' } });
    await settle();
    await choose('lottning-mode-select', 'Seeded');
    const inputs = document.querySelectorAll<HTMLInputElement>(
      '[data-testid="lottning-seed-input"]'
    );
    inputs[1]!.value = '1';
    inputs[1]!.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    ($('lottning-draw-btn') as HTMLButtonElement).click();
    await settle();
    expect(puts[0]).toEqual({
      url: '/api/competitions/c1/lottning/h12/seeding',
      body: { groups: [['r2']] },
    });
    expect(posts[0]!.body).toMatchObject({ mode: 'Seeded', bestFirst: false });
    expect($('lottning-done')!.textContent).toBe('Klart: 2 löpare i H12 fick starttid.');
  });

  it('the draw uses the settings as they were when Lotta was pressed, and locks them meanwhile', async () => {
    const { default: LottningView } = await import('./LottningView.svelte');
    component = mount(LottningView, { target: document.body, props: { competitionId: 'c1' } });
    await settle();
    let release!: () => void;
    holdClock = new Promise((r) => (release = r));
    ($('lottning-draw-btn') as HTMLButtonElement).click();
    await settle();
    expect(($('lottning-settings') as HTMLFieldSetElement).disabled).toBe(true);
    // A change that still gets through (e.g. a keyboard event already queued).
    await choose('lottning-mode-select', 'Simultaneous');
    release();
    await settle();
    expect(posts[0]!.body).toMatchObject({ mode: 'SOFT', intervalSec: 120 });
    expect(($('lottning-settings') as HTMLFieldSetElement).disabled).toBe(false);
  });

  it('SOFT TR 7.4.1: the pursuit fields say what is read in for the class, also after a reload', async () => {
    previousResults = { results: 2, ok: 1 };
    const { default: LottningView } = await import('./LottningView.svelte');
    component = mount(LottningView, { target: document.body, props: { competitionId: 'c1' } });
    await settle();
    await choose('lottning-mode-select', 'Pursuit');
    expect($('pursuit-results-status')!.textContent!.trim()).toBe(
      'Inläst för H12: 2 resultat från förra etappen, varav 1 godkända.'
    );
    // A new file is read in: the status follows the server.
    previousResults = { results: 2, ok: 2 };
    const input = $('pursuit-results-file') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File(['<ResultList/>'], 'dag1.xml', { type: 'application/xml' })],
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    ($('pursuit-results-upload') as HTMLButtonElement).click();
    await settle();
    expect($('pursuit-results-status')!.textContent).toContain('varav 2 godkända');
  });

  it('SOFT TR 7.4.1: a pursuit cannot be drawn while the previous stage is being read in', async () => {
    const { default: LottningView } = await import('./LottningView.svelte');
    component = mount(LottningView, { target: document.body, props: { competitionId: 'c1' } });
    await settle();
    await choose('lottning-mode-select', 'Pursuit');
    let release!: () => void;
    holdUpload = new Promise((r) => (release = r));
    const input = $('pursuit-results-file') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File(['<ResultList/>'], 'dag1.xml', { type: 'application/xml' })],
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    ($('pursuit-results-upload') as HTMLButtonElement).click();
    await settle();
    const draw = $('lottning-draw-btn') as HTMLButtonElement;
    expect(draw.disabled).toBe(true);
    expect($('lottning-wait-results')).not.toBeNull();
    draw.click();
    await settle();
    expect(posts).toEqual([]);

    release();
    await settle();
    expect(draw.disabled).toBe(false);
    expect($('lottning-wait-results')).toBeNull();
  });

  it('SOFT TR 7.4.5: groups stored for runners not yet drawn are shown and sent again, not erased', async () => {
    // A seeded draw refused earlier (e.g. level unset) has already stored
    // the groups; nobody in the class has a start time.
    seeding = [{ id: 'r2', seed_group: 1 }];
    const { default: LottningView } = await import('./LottningView.svelte');
    component = mount(LottningView, { target: document.body, props: { competitionId: 'c1' } });
    await settle();
    await choose('lottning-mode-select', 'Seeded');
    const inputs = document.querySelectorAll<HTMLInputElement>(
      '[data-testid="lottning-seed-input"]'
    );
    expect([...inputs].map((i) => i.value)).toEqual(['', '1']);
    ($('lottning-draw-btn') as HTMLButtonElement).click();
    await settle();
    expect(puts[0]!.body).toEqual({ groups: [['r2']] });
  });

  it('SOFT TR 7.5.8: with a start list, late entrants can be placed without a redraw', async () => {
    startList = [
      {
        id: 'r1',
        name: 'Anna',
        club: 'OK A',
        card_number: null,
        start_time_ms: 1,
        seed_group: null,
      },
    ];
    const { default: LottningView } = await import('./LottningView.svelte');
    component = mount(LottningView, { target: document.body, props: { competitionId: 'c1' } });
    await settle();
    const late = document.querySelector<HTMLInputElement>(
      'input[name="lottning-draw-type"][value="RemainingAfter"]'
    )!;
    late.click();
    await settle();
    expect($('lottning-first-start')).toBeNull();
    expect($('lottning-preview')!.textContent).toContain('Efteranmälda i H12 som får starttid: 1.');
    ($('lottning-draw-btn') as HTMLButtonElement).click();
    await settle();
    // No redraw confirmation: nobody already drawn moves.
    expect($('lottning-redraw-confirm')).toBeNull();
    expect(posts[0]!.body).toEqual({ mode: 'SOFT', drawType: 'RemainingAfter', intervalSec: 120 });
  });
});
