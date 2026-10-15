// Authored for fartola. Not ported from upstream.
//
// AddRunnerSheet: an unmapped failure says something plain and logs the raw
// error; a network failure (no response) says so.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import AddRunnerSheet from './AddRunnerSheet.svelte';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
    await tick();
  }
  flushSync();
};
const q = <T extends Element>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);

/** Text of the elements an input's aria-describedby points at. */
const describedBy = (el: Element | null): string =>
  (el?.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
    .join(' ')
    .trim();

describe('AddRunnerSheet', () => {
  let component: ReturnType<typeof mount> | null = null;
  let network: boolean;

  beforeEach(async () => {
    network = false;
    global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        if (network) throw new TypeError('Failed to fetch');
        return new Response(JSON.stringify({ error: 'boom' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      void url;
      return new Response(JSON.stringify({ hit: false, suggestions: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    component = mount(AddRunnerSheet, {
      target: document.body,
      props: {
        open: true,
        competitionId: 'c1',
        classes: [{ id: 'h21', name: 'H21' }] as never,
        onClose: () => {},
        onSaved: () => {},
      },
    });
    await settle();
    const name = q<HTMLInputElement>('add-runner-name')!;
    name.value = 'Anna Test';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    const cls = q<HTMLSelectElement>('add-runner-class')!;
    cls.value = 'h21';
    cls.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  });
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('a failed save says something went wrong and logs the raw error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    q<HTMLButtonElement>('add-runner-save')!.click();
    await settle();
    expect(q('add-runner-error')!.textContent).toBe('Något gick fel');
    expect(log).toHaveBeenCalled();
  });

  it('a network failure says so in plain words', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    network = true;
    // createCompetitor retries a dropped request once after 1.5 s.
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    q<HTMLButtonElement>('add-runner-save')!.click();
    await settle();
    await vi.advanceTimersByTimeAsync(1500);
    await settle();
    vi.useRealTimers();
    expect(q('add-runner-error')!.textContent).toBe('Nätverksfel — försök igen');
  });

  it('the card field says what to type', () => {
    expect(describedBy(q('add-runner-card'))).toBe('Numret som står på brickan, bara siffror.');
  });
});
