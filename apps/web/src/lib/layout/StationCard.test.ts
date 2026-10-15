// Authored for fartola. Not ported from upstream.
//
// A reconnect the server refuses with its own text says "Något gick fel";
// the raw text goes to the console only.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import StationCard from './StationCard.svelte';

describe('StationCard', () => {
  let component: ReturnType<typeof mount> | null = null;
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('a failed reconnect with server text says Något gick fel, never the text', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'SQLITE_BUSY: database is locked' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        })
    ) as unknown as typeof fetch;
    component = mount(StationCard, { target: document.body, props: { status: 'offline' } });
    document.querySelector<HTMLElement>('[data-testid="bridge-reconnect"]')!.click();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    await tick();
    flushSync();
    expect(document.querySelector('.reconnect-error')!.textContent).toBe('Något gick fel');
    expect(document.body.textContent).not.toContain('SQLITE_BUSY');
    expect(log).toHaveBeenCalled();
  });
});
