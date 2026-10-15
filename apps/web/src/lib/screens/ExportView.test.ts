// Authored for fartola. Not ported from upstream.
//
// Export only downloads a file. A volunteer looking for "send the results
// to Eventor" must find the way from this page at once, not only after a
// download.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import ExportView from './ExportView.svelte';

describe('ExportView', () => {
  let component: ReturnType<typeof mount> | null = null;
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
  });

  it('links to sending the results to Eventor before anything is downloaded', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    ) as unknown as typeof fetch;
    component = mount(ExportView, { target: document.body, props: { competitionId: 'c1' } });
    await tick();
    flushSync();
    const link = document.querySelector<HTMLAnchorElement>('[data-testid="export-eventor-link"]')!;
    expect(link.textContent).toBe('Skicka resultat till Eventor');
    expect(link.getAttribute('href')).toBe('/competition/c1/eventor-publish');
  });
});
