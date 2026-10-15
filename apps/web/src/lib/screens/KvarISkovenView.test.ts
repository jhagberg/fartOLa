// Authored for fartola. Not ported from upstream.
//
// A card-list fetch the server refuses with its own text says "Något gick
// fel"; the raw text goes to the console only.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import KvarISkovenView from './KvarISkovenView.svelte';

describe('KvarISkovenView', () => {
  let component: ReturnType<typeof mount> | null = null;
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('a 500 with server text says Något gick fel, never the text', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const ok = init?.method !== 'POST';
      return new Response(JSON.stringify(ok ? {} : { error: 'SQLITE_BUSY: database is locked' }), {
        status: ok ? 200 : 500,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    component = mount(KvarISkovenView, { target: document.body, props: { competitionId: 'c1' } });
    await tick();
    document.querySelector<HTMLElement>('[data-testid="kvariskov-fetch"]')!.click();
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
      await tick();
    }
    flushSync();
    expect(document.querySelector('[data-testid="kvariskov-error"]')!.textContent).toContain(
      'Något gick fel'
    );
    expect(document.body.textContent).not.toContain('SQLITE_BUSY');
    expect(log).toHaveBeenCalled();
  });
});
