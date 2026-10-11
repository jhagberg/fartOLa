// Authored for fartola. Not ported from upstream.
//
// SettingsView across a competition switch: a Liveresultat save or a
// helper-code request that answers after the operator switched to another
// competition writes nothing into the new competition's cards and leaves
// their buttons usable. The real component in jsdom, with a routed fake
// fetch whose writes the test answers by hand.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import SettingsView from './SettingsView.svelte';
import { activeCompetition } from '#lib/stores/activeCompetition.svelte.ts';

/** Writes (PATCH/POST/DELETE) wait here until the test answers them. */
let held: Array<{ url: string; answer: (status: number, body?: unknown) => void }>;

function installFetch(): void {
  held = [];
  global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    const method = init?.method ?? 'GET';
    if (method !== 'GET' && /\/(liveresultat|event-codes)/.test(url))
      return new Promise<Response>((resolve) =>
        held.push({ url, answer: (status, body = {}) => resolve(json(body, status)) })
      );
    if (url.includes('/liveresultat/')) return json({ liveresultat_id: null, has_password: false });
    if (url.includes('/event-codes')) return json({ codes: [] });
    if (/\/api\/competitions$/.test(url)) return json({ competitions: [] });
    if (url.includes('/settings/integrations')) return json({ integrations: [] });
    return json({});
  }) as unknown as typeof fetch;
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
    await tick();
  }
  flushSync();
};

const $ = <T extends Element>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);
const type = (id: string, value: string) => {
  const el = $<HTMLInputElement>(id)!;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('SettingsView — answers for the competition the operator left', () => {
  let component: ReturnType<typeof mount> | null = null;

  beforeEach(async () => {
    installFetch();
    await activeCompetition.set('A');
    component = mount(SettingsView, { target: document.body });
    await settle();
  });
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('a Liveresultat save for A that answers after the switch says nothing in B', async () => {
    type('liveresultat-id', '111');
    type('liveresultat-password', 'hemligt');
    await settle();
    $<HTMLButtonElement>('liveresultat-save')!.click();
    await settle();
    expect(held.map((h) => h.url)).toEqual(['/api/competitions/A/liveresultat/credentials']);

    await activeCompetition.set('B');
    await settle();
    // B's card is usable at once, not held by A's save.
    expect($<HTMLButtonElement>('liveresultat-save')!.disabled).toBe(false);

    held[0]!.answer(200, { liveresultat_id: '111', has_password: true });
    await settle();
    expect($('liveresultat-result')).toBeNull();
    expect($('liveresultat-state')!.textContent).not.toContain('påslaget');
    expect($<HTMLInputElement>('liveresultat-id')!.value).toBe('');
  });

  it('a helper code for A that fails after the switch shows no error in B; B can make one', async () => {
    $<HTMLButtonElement>('helper-codes-generate')!.click();
    await settle();
    expect(held.map((h) => h.url)).toEqual(['/api/competitions/A/event-codes']);

    await activeCompetition.set('B');
    await settle();
    expect($<HTMLButtonElement>('helper-codes-generate')!.disabled).toBe(false);

    held[0]!.answer(500, { error: 'boom' });
    await settle();
    expect(document.querySelector('#hjalpkoder [role="alert"]')).toBeNull();
    // A late answer for A does not end B's own request either.
    $<HTMLButtonElement>('helper-codes-generate')!.click();
    await settle();
    expect(held[1]!.url).toBe('/api/competitions/B/event-codes');
    expect($<HTMLButtonElement>('helper-codes-generate')!.disabled).toBe(true);
  });
});
