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
  const onChanged = vi.fn();

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) {
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
      start_time_ms: at('10:00'),
      missing_codes: [],
      manual_finish_ms: null,
      manual_finish_reason: null,
      manual_punches: [],
      time_addition_min: 0,
      time_addition_reason: null,
    };
    posts = [];
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
            elapsed_time_ms: body.finish_ms! - state.start_time_ms!,
            manual_finish_ms: body.finish_ms!,
            manual_finish_reason: body.reason!,
          };
        } else if (url.endsWith('/clear-manual-finish')) {
          state = { ...state, status: 'DNF', elapsed_time_ms: null, manual_finish_ms: null };
        }
        return json({ local_seq: posts.length }, 201);
      }
      if (url.endsWith('/corrections')) return json(state);
      return json({ competition: { date: '2026-10-03', clock_offset_min: 120 } });
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
});
