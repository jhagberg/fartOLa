// Authored for fartola. Not ported from upstream.
//
// A consent confirmation the server refuses with its own text says
// "Något gick fel"; the raw answer goes to the console only.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import ConsentConfirmationToast from './ConsentConfirmationToast.svelte';

describe('ConsentConfirmationToast', () => {
  let component: ReturnType<typeof mount> | null = null;
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('a 500 with server text says Något gick fel, never the text', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: 'SQLITE_BUSY', message: 'SQLITE_BUSY: database is locked' }),
          { status: 500, headers: { 'content-type': 'application/json' } }
        )
    ) as unknown as typeof fetch;
    component = mount(ConsentConfirmationToast, {
      target: document.body,
      props: { competitorId: 'k1', competitorName: 'Eva', className: 'D21', onResolved: vi.fn() },
    });
    await tick();
    document.querySelector<HTMLElement>('[data-testid="consent-toast-confirm"]')!.click();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    await tick();
    flushSync();
    expect(document.querySelector('[data-testid="consent-toast-error"]')!.textContent).toBe(
      'Något gick fel'
    );
    expect(document.body.textContent).not.toContain('SQLITE_BUSY');
    expect(log).toHaveBeenCalled();
  });
});
