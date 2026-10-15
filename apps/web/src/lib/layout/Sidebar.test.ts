// Authored for fartola. Not ported from upstream.
//
// ADR-0016: the sidebar groups its entries by when the volunteer needs
// them, with a heading per group, so export and Eventor sit together.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import Sidebar from './Sidebar.svelte';

describe('Sidebar groups', () => {
  let component: ReturnType<typeof mount> | null = null;

  beforeEach(async () => {
    global.fetch = vi.fn(
      async () =>
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    ) as unknown as typeof fetch;
    component = mount(Sidebar, { target: document.body, props: { activeCompId: 'c1' } });
    await tick();
    flushSync();
  });
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
  });

  const group = (id: string) => {
    const el = document.querySelector<HTMLElement>(`[data-testid="nav-group-${id}"]`)!;
    return {
      heading: el.querySelector('.nav-heading')?.textContent?.trim(),
      labelledBy: el.getAttribute('aria-labelledby'),
      headingId: el.querySelector('.nav-heading')?.id,
      items: [...el.querySelectorAll('.nav-label')].map((l) => l.textContent?.trim()),
    };
  };

  it('puts every entry under the heading for when it is needed', () => {
    expect(group('before')).toMatchObject({
      heading: 'Före loppet',
      items: ['Tävlingsinfo', 'Anmälda', 'Lottning', 'Kontroll'],
    });
    expect(group('during')).toMatchObject({
      heading: 'Under loppet',
      items: ['Avläsning', 'Registrering', 'Resultat', 'Speaker', 'Kvar i skogen', 'Hyrbrickor'],
    });
    expect(group('after')).toMatchObject({
      heading: 'Efter loppet',
      items: ['Export', 'Eventor'],
    });
  });

  it('each group is named by its heading for a screen reader', () => {
    for (const id of ['before', 'during', 'after']) {
      const g = group(id);
      expect(g.labelledBy).toBeTruthy();
      expect(g.labelledBy).toBe(g.headingId);
    }
  });

  it('Tävlingar stays above the groups and Inställningar below them', () => {
    const labels = [...document.querySelectorAll('.sidebar > .nav-item .nav-label')].map((l) =>
      l.textContent?.trim()
    );
    expect(labels).toEqual(['Tävlingar', 'Inställningar']);
  });
});
