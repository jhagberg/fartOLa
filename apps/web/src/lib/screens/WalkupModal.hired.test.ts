// Authored for fartola. Not ported from upstream.
//
// Component test of the hire card contact fields in the direct-entry form:
// phone and e-mail are checked when left and when cleared (aria-invalid,
// aria-describedby), and a bad phone number blocks the save.

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

let posts: unknown[];

function installFetch(): void {
  posts = [];
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
    if (url === '/api/competitors' && init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)));
      return json({ id: 'x' }, 201);
    }
    return json({ suggestions: [], hit: false });
  }) as unknown as typeof fetch;
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
    await tick();
  }
  flushSync();
};

const q = <T extends HTMLElement = HTMLElement>(testid: string): T | null =>
  document.querySelector<T>(`[data-testid="${testid}"]`);

async function type(testid: string, value: string): Promise<void> {
  const el = q<HTMLInputElement>(testid)!;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
}

async function blur(testid: string): Promise<void> {
  q(testid)!.dispatchEvent(new FocusEvent('blur'));
  await settle();
}

describe('WalkupModal — hire card contact checks', () => {
  let component: ReturnType<typeof mount> | null = null;

  beforeEach(async () => {
    installFetch();
    component = mount(WalkupModal, {
      target: document.body,
      props: { cardNumber: 8100002, competitionId: COMP, classes: [cls], onClose: vi.fn() },
    });
    await settle();
    q('walkup-hired')!.click();
    await settle();
  });
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('a phone number of letters is flagged when the field is left, and clears when emptied', async () => {
    await type('walkup-hc-phone', 'abc');
    expect(q('walkup-hc-phone-error')).toBeNull();
    await blur('walkup-hc-phone');
    const phone = q('walkup-hc-phone')!;
    const err = q('walkup-hc-phone-error')!;
    expect(err.textContent).toContain('telefonnummer');
    expect(phone.getAttribute('aria-invalid')).toBe('true');
    expect(phone.getAttribute('aria-describedby')).toBe(err.id);

    await type('walkup-hc-phone', '');
    expect(q('walkup-hc-phone-error')).toBeNull();
    expect(phone.getAttribute('aria-invalid')).toBeNull();
  });

  it('a phone number with spaces and a plus is fine', async () => {
    await type('walkup-hc-phone', '+46 70-123 45 67');
    await blur('walkup-hc-phone');
    expect(q('walkup-hc-phone-error')).toBeNull();
  });

  it('an e-mail without @ is flagged when the field is left', async () => {
    await type('walkup-hc-email', 'rut');
    await blur('walkup-hc-email');
    expect(q('walkup-hc-email-error')?.textContent).toContain('e-postadress');
    expect(q('walkup-hc-email')!.getAttribute('aria-invalid')).toBe('true');
  });

  it('a bad phone number blocks the save and shows its error', async () => {
    await type('walkup-name', 'Eva Ek');
    const cs = q<HTMLSelectElement>('walkup-class')!;
    cs.value = H21;
    cs.dispatchEvent(new Event('change', { bubbles: true }));
    q('walkup-consent')!.click();
    await type('walkup-hc-phone', 'abc');
    q('walkup-save')!.click();
    await settle();
    expect(posts).toHaveLength(0);
    expect(q('walkup-hc-phone-error')).not.toBeNull();
  });
});
