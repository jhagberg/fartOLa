// Authored for fartola. Not ported from upstream.
//
// A push to Eventor that fails on the server says so in plain words; the
// server's own text goes to the console only.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import EventorPublishView from './EventorPublishView.svelte';

describe('EventorPublishView', () => {
  let component: ReturnType<typeof mount> | null = null;
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('a 500 with server text says the push failed, never the text', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'SQLITE_BUSY: database is locked' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        })
    ) as unknown as typeof fetch;
    component = mount(EventorPublishView, {
      target: document.body,
      props: { competitionId: 'c1' },
    });
    await tick();
    document.querySelector<HTMLElement>('[data-testid="eventor-publish-results"] button')!.click();
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
      await tick();
    }
    flushSync();
    expect(document.querySelector('[data-testid="eventor-results-err"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain('SQLITE_BUSY');
    expect(log).toHaveBeenCalled();
  });
});
