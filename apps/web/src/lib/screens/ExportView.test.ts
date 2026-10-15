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

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
      await tick();
    }
    flushSync();
  };
  const refusing = (): void => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'SQLITE_BUSY: database is locked' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        })
    ) as unknown as typeof fetch;
  };

  it('a failed check says Något gick fel, never the server text', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    refusing();
    component = mount(ExportView, { target: document.body, props: { competitionId: 'c1' } });
    await settle();
    const box = document.querySelector('[data-testid="export-error-network"]')!;
    expect(box.textContent).toContain('Något gick fel');
    expect(document.body.textContent).not.toContain('SQLITE_BUSY');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('a failed undo of the unread-to-DNS step says Något gick fel, never the server text', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    refusing();
    component = mount(ExportView, { target: document.body, props: { competitionId: 'c1' } });
    await settle();
    document.querySelector<HTMLElement>('[data-testid="export-unread-dns-undo"]')!.click();
    await settle();
    expect(document.querySelector('[data-testid="export-unread-message"]')!.textContent).toBe(
      'Något gick fel'
    );
    expect(document.body.textContent).not.toContain('SQLITE_BUSY');
    log.mockRestore();
  });
});
