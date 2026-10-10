// Authored for fartola. Not ported from upstream.
//
// The mounted CorrectionsPanel (jsdom, routed fake fetch): a finish time by
// hand (SOFT TR 4.20.6) is placed after the start and saved with its
// reason, shown with a "Ta bort" that removes it, and a time before the
// start is refused without a request.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { clockToEpochMs, parseTimeOfDay } from '@fartola/shared-types';

import CorrectionsPanel from './CorrectionsPanel.svelte';
import type { CorrectionsDTO } from '#lib/api/client.ts';

const at = (text: string): number => clockToEpochMs('2026-10-03', parseTimeOfDay(text)!, 120);

describe('CorrectionsPanel (mounted)', () => {
  let component: ReturnType<typeof mount> | null = null;
  let state: CorrectionsDTO;
  let posts: Array<{ url: string; body: unknown }>;
  let offset: number;
  const onChanged = vi.fn();

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 12; i++) {
      await Promise.resolve();
      await tick();
    }
    flushSync();
  };
  const $ = <T extends HTMLElement>(id: string): T | null =>
    document.querySelector<T>(`[data-testid="${id}"]`);
  const type = (id: string, value: string): void => {
    const input = $<HTMLInputElement>(id)!;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  };

  beforeEach(() => {
    state = {
      status: 'DNF',
      elapsed_time_ms: null,
      start_ms: at('10:00'),
      read_at_ms: null,
      missing_codes: [],
      manual_finish_ms: null,
      manual_finish_reason: null,
      manual_punches: [],
      time_addition_min: 0,
      time_addition_reason: null,
    };
    posts = [];
    offset = 120;
    onChanged.mockReset();
    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { finish_ms?: number; reason?: string };
        posts.push({ url, body });
        if (url.endsWith('/manual-finish')) {
          state = {
            ...state,
            status: 'OK',
            elapsed_time_ms: body.finish_ms! - state.start_ms!,
            manual_finish_ms: body.finish_ms!,
            manual_finish_reason: body.reason!,
          };
        } else if (url.endsWith('/manual-punch')) {
          const b = body as unknown as { control_code: number; reason: string };
          state = {
            ...state,
            missing_codes: state.missing_codes.filter((c) => c !== b.control_code),
            manual_punches: [...state.manual_punches, b],
          };
        } else if (url.endsWith('/remove-manual-punch')) {
          state = { ...state, manual_punches: [] };
        } else if (url.endsWith('/time-addition')) {
          const b = body as unknown as { minutes: number; reason: string };
          state = { ...state, time_addition_min: b.minutes, time_addition_reason: b.reason };
        } else if (url.endsWith('/clear-time-addition')) {
          state = { ...state, time_addition_min: 0, time_addition_reason: null };
        } else if (url.endsWith('/clear-manual-finish')) {
          state = { ...state, status: 'DNF', elapsed_time_ms: null, manual_finish_ms: null };
        }
        return json({ local_seq: posts.length }, 201);
      }
      if (url.endsWith('/corrections')) return json(state);
      return json({ competition: { date: '2026-10-03', clock_offset_min: offset } });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
  });

  const mountIt = async () => {
    component = mount(CorrectionsPanel, {
      target: document.body,
      props: { competitionId: 'c1', competitorId: 'r1', onChanged },
    });
    await settle();
  };

  it('sets a finish time with its reason, shows it, and removes it', async () => {
    await mountIt();
    type('corr-finish-input', '10:42:30');
    $<HTMLButtonElement>('corr-finish-set')!.click();
    await settle();
    expect(posts).toEqual([
      {
        url: '/api/competitions/c1/competitors/r1/manual-finish',
        body: { finish_ms: at('10:42:30'), reason: 'Målenheten fungerade inte' },
      },
    ]);
    expect(onChanged).toHaveBeenCalledOnce();
    expect($('corr-finish-time')!.textContent).toBe('10:42:30');
    expect($('corr-now')!.textContent).toContain('42:30');

    $<HTMLButtonElement>('corr-finish-remove')!.click();
    await settle();
    expect(posts[1]!.url).toBe('/api/competitions/c1/competitors/r1/clear-manual-finish');
    expect($('corr-finish-input')).not.toBeNull();
  });

  it('a time before the start is refused without a request', async () => {
    await mountIt();
    type('corr-finish-input', '09:59');
    $<HTMLButtonElement>('corr-finish-set')!.click();
    await settle();
    expect(posts).toEqual([]);
    expect(document.body.textContent).toContain('Måltiden är före starttiden.');
    expect($('corr-finish-input')!.getAttribute('aria-invalid')).toBe('true');
  });

  it('offers the missing controls; adds a punch with its reason and removes it', async () => {
    state.missing_codes = [32, 35];
    await mountIt();
    const picks = [
      ...document.querySelectorAll<HTMLButtonElement>('[data-testid="corr-punch-pick"]'),
    ];
    expect(picks.map((b) => b.textContent?.trim())).toEqual(['32', '35']);
    picks[1]!.click();
    flushSync();
    expect($<HTMLInputElement>('corr-punch-input')!.value).toBe('35');
    $<HTMLButtonElement>('corr-punch-add')!.click();
    await settle();
    expect(posts).toEqual([
      {
        url: '/api/competitions/c1/competitors/r1/manual-punch',
        body: { control_code: 35, reason: 'Stiftklämma på startkortet' },
      },
    ]);
    expect($('corr-punch')!.textContent).toContain('35');
    $<HTMLButtonElement>('corr-punch-remove')!.click();
    await settle();
    expect(posts[1]).toEqual({
      url: '/api/competitions/c1/competitors/r1/remove-manual-punch',
      body: { control_code: 35 },
    });
    expect($('corr-punch')).toBeNull();
  });

  it('a code that is not a number is refused without a request', async () => {
    await mountIt();
    type('corr-punch-input', '3x');
    $<HTMLButtonElement>('corr-punch-add')!.click();
    await settle();
    expect(posts).toEqual([]);
    expect(document.body.textContent).toContain('Skriv kontrollens kodsiffra.');
  });

  it('a false start gives one minute in one click; removing it takes it away', async () => {
    await mountIt();
    $<HTMLButtonElement>('corr-false-start')!.click();
    await settle();
    expect(posts).toEqual([
      {
        url: '/api/competitions/c1/competitors/r1/time-addition',
        body: { minutes: 1, reason: 'Tjuvstart' },
      },
    ]);
    expect($('corr-addition-min')!.textContent?.trim()).toBe('1 min');
    $<HTMLButtonElement>('corr-addition-remove')!.click();
    await settle();
    expect(posts[1]!.url).toBe('/api/competitions/c1/competitors/r1/clear-time-addition');
    expect($('corr-addition-min')).toBeNull();
  });

  it('1 to 5 minutes with a reason', async () => {
    await mountIt();
    const select = $<HTMLSelectElement>('corr-addition-select')!;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      '1 min',
      '2 min',
      '3 min',
      '4 min',
      '5 min',
    ]);
    select.value = '3';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    type('corr-addition-reason', 'Förmildrande omständigheter');
    $<HTMLButtonElement>('corr-addition-set')!.click();
    await settle();
    expect(posts).toEqual([
      {
        url: '/api/competitions/c1/competitors/r1/time-addition',
        body: { minutes: 3, reason: 'Förmildrande omständigheter' },
      },
    ]);
  });

  it('places the typed finish on the clock the server has when saving', async () => {
    await mountIt();
    // Another tab corrects the offset to +180; the server shifts the start.
    offset = 180;
    state.start_ms = clockToEpochMs('2026-10-03', parseTimeOfDay('10:00')!, 180);
    type('corr-finish-input', '10:28');
    $<HTMLButtonElement>('corr-finish-set')!.click();
    await settle();
    expect((posts[0]!.body as { finish_ms: number }).finish_ms).toBe(
      clockToEpochMs('2026-10-03', parseTimeOfDay('10:28')!, 180)
    );
  });
});
