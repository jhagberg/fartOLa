// Authored for fartola. Not ported from upstream.
//
// A failed "Sätt alla" shows plain words, never the server's text; the raw
// error goes to the console.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import MissingStartsPanel from './MissingStartsPanel.svelte';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
    await tick();
  }
  flushSync();
};

describe('MissingStartsPanel', () => {
  let component: ReturnType<typeof mount> | null = null;
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('a failed apply says something went wrong in plain words and logs the raw error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ error: 'boom' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          n: 1,
          median_ms: 60000,
          mean_ms: 60000,
          offset_ms: 0,
          clock_offset_min: 120,
          items: [
            {
              competitor_id: 'r1',
              name: 'Test Löpare',
              club: null,
              class_id: 'h21',
              class_name: 'H21',
              card_number: 1,
              status: 'OK',
              check_ms: 36_000_000,
              suggested_start_ms: 36_060_000,
              finish_ms: 38_000_000,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as unknown as typeof fetch;
    component = mount(MissingStartsPanel, {
      target: document.body,
      props: { competitionId: 'c1' },
    });
    await settle();
    document.querySelector<HTMLButtonElement>('[data-testid="missing-starts-set-all"]')!.click();
    await settle();
    const alert = document.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Något gick fel');
    expect(alert.textContent).not.toMatch(/boom|500|HTTP/);
    expect(log).toHaveBeenCalled();
  });
});
