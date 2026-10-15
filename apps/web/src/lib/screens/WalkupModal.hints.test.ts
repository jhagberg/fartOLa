// Authored for fartola. Not ported from upstream.
//
// WalkupModal: the card number and birth year fields say what to type, in
// text the operator sees (and a screen reader announces), not a placeholder.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import WalkupModal from './WalkupModal.svelte';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
    await tick();
  }
  flushSync();
};
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`);
const describedBy = (el: Element | null): string =>
  (el?.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
    .join(' ')
    .trim();

describe('WalkupModal — format hints', () => {
  let component: ReturnType<typeof mount> | null = null;
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('the card and birth year fields say what to type', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ suggestions: [], hit: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    ) as unknown as typeof fetch;
    component = mount(WalkupModal, {
      target: document.body,
      props: {
        cardNumber: 8100002,
        competitionId: 'c1',
        classes: [],
        onClose: vi.fn(),
        eventorHint: null as never,
      },
    });
    await settle();
    expect(describedBy(q('walkup-card'))).toBe('Numret som står på brickan, bara siffror.');
    expect(describedBy(q('walkup-birth-year'))).toBe('Fyra siffror, t.ex. 2012.');
  });
});
