// Authored for fartola. Not ported from upstream.
//
// A competition switch the server refuses with its own text says
// "Något gick fel"; the raw text goes to the console only.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import ActiveCompetitionPill from './ActiveCompetitionPill.svelte';
import { activeCompetition } from '../stores/activeCompetition.svelte.ts';

describe('ActiveCompetitionPill', () => {
  let component: ReturnType<typeof mount> | null = null;
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
      await tick();
    }
    flushSync();
  };

  it('a refused switch with server text says Något gick fel, never the text', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return json({ error: 'SQLITE_BUSY: database is locked' }, 500);
      if (String(input).includes('active-competition')) return json({ competition_id: null });
      return json({
        competitions: [{ id: 'c1', name: 'Tuna Ting', date: '2026-10-10', created_at_ms: 1 }],
      });
    }) as unknown as typeof fetch;
    await activeCompetition.init();
    component = mount(ActiveCompetitionPill, { target: document.body, props: {} });
    document.querySelector<HTMLElement>('[data-testid="active-comp-pill"]')!.click();
    await settle();
    document.querySelector<HTMLElement>('[role="option"]')!.click();
    await settle();
    expect(document.querySelector('.switch-error')!.textContent).toBe('Något gick fel');
    expect(document.body.textContent).not.toContain('SQLITE_BUSY');
    expect(log).toHaveBeenCalled();
  });
});
