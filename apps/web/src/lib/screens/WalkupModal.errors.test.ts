// Authored for fartola. Not ported from upstream.
//
// A save the server refuses with its own text (a locked database, a 400 we
// do not map) says "Något gick fel" on screen; the raw text goes to the
// console only.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import WalkupModal from './WalkupModal.svelte';
import type { ClassDTO } from '@fartola/shared-types';

const COMP = '00000000-0000-4000-8000-00000000c001';
const H21 = '00000000-0000-4000-8000-0000000000a1';
const cls: ClassDTO = {
  id: H21,
  competition_id: COMP,
  name: 'H21',
  short_name: null,
  no_timing: false,
  start_method: 'auto',
};
const RAW = 'SQLITE_BUSY: database is locked';

let postAnswers: Array<{ status: number; body: unknown }>;

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
    await tick();
  }
  flushSync();
};
const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.querySelector<T>(`[data-testid="${id}"]`);

describe('WalkupModal: server text never on screen', () => {
  let component: ReturnType<typeof mount> | null = null;

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    postAnswers = [];
    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.includes('/entries'))
        return json({ card_number: 1, clock_offset_min: 120, runners: [] });
      if (url.endsWith('/fees')) return json({ error: 'not found' }, 404);
      if (url.includes('/api/competitors') && init?.method === 'POST') {
        const a = postAnswers.shift()!;
        return json(a.body, a.status);
      }
      return json({ suggestions: [], hit: false });
    }) as unknown as typeof fetch;
    component = mount(WalkupModal, {
      target: document.body,
      props: { cardNumber: 8100002, competitionId: COMP, classes: [cls], onClose: vi.fn() },
    });
    await settle();
    const name = q<HTMLInputElement>('walkup-name')!;
    name.value = 'Eva Ek';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    const cs = q<HTMLSelectElement>('walkup-class')!;
    cs.value = H21;
    cs.dispatchEvent(new Event('change', { bubbles: true }));
    q('walkup-consent')!.click();
    await settle();
  });
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it.each([500, 400])('a %s with server text says Något gick fel', async (status) => {
    postAnswers = [{ status, body: { error: RAW } }];
    q('walkup-save')!.click();
    await settle();
    expect(q('walkup-error')!.textContent).toBe('Något gick fel');
    expect(document.body.textContent).not.toContain('SQLITE_BUSY');
  });

  it('a failed card correction says Något gick fel', async () => {
    postAnswers = [
      { status: 409, body: { error: 'card_taken', existing_competitor_id: 'holder' } },
      { status: 500, body: { error: RAW } },
    ];
    q('walkup-save')!.click();
    await settle();
    q('walkup-correct-card')!.click();
    await settle();
    expect(q('walkup-error')!.textContent).toBe('Något gick fel');
    expect(document.body.textContent).not.toContain('SQLITE_BUSY');
  });
});
