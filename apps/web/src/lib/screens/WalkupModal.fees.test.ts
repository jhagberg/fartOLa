// Authored for fartola. Not ported from upstream.
//
// Component test of the direct-entry form's fee line (SOFT TR 4.12.4,
// 4.12.6) and consent (REQ-PRIV-001, design-lab audit WA-2): the real
// WalkupModal is mounted in jsdom with a routed fake fetch.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import WalkupModal from './WalkupModal.svelte';
import type { ClassDTO } from '@fartola/shared-types';

const COMP = '00000000-0000-4000-8000-00000000c001';
const H21 = '00000000-0000-4000-8000-0000000000a1';
const GUL = '00000000-0000-4000-8000-0000000000a2';

const cls = (id: string, name: string): ClassDTO => ({
  id,
  competition_id: COMP,
  name,
  short_name: null,
  no_timing: false,
  start_method: 'auto',
});

let posts: Array<Record<string, unknown>>;

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
    if (url.endsWith('/fees'))
      return json({
        // The competition day is today: a walk-up.
        date: new Date().toISOString().slice(0, 10),
        card_fee: 30,
        classes: [
          {
            class_id: H21,
            name: 'H21',
            class_kind: 'senior',
            entry_fee: 180,
            youth_entry_fee: null,
            late_fee_pct: 50,
          },
          {
            class_id: GUL,
            name: 'Gul 2,5',
            class_kind: 'oppen',
            entry_fee: 180,
            youth_entry_fee: 90,
            late_fee_pct: 50,
          },
        ],
      });
    if (url === '/api/competitors' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posts.push(body);
      return json({ id: 'x', ...body }, 201);
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

function choose(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('WalkupModal — fee and consent', () => {
  let component: ReturnType<typeof mount> | null = null;

  const open = async (eventorHint: unknown = null): Promise<void> => {
    component = mount(WalkupModal, {
      target: document.body,
      props: {
        cardNumber: 8100002,
        competitionId: COMP,
        classes: [cls(H21, 'H21'), cls(GUL, 'Gul 2,5')],
        onClose: vi.fn(),
        eventorHint: eventorHint as never,
      },
    });
    await settle();
  };

  beforeEach(async () => {
    installFetch();
  });
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('WA-2: consent starts unticked and blocks the save until ticked', async () => {
    await open();
    expect(q<HTMLInputElement>('walkup-consent')!.checked).toBe(false);
    (q('walkup-name') as HTMLInputElement).value = 'Eva Ek';
    q('walkup-name')!.dispatchEvent(new Event('input', { bubbles: true }));
    choose(q<HTMLSelectElement>('walkup-class')!, H21);
    await settle();
    q('walkup-save')!.click();
    await settle();
    expect(q('walkup-error')?.textContent).toBe('Samtycke krävs.');
    expect(posts).toHaveLength(0);
  });

  it('shows the class fee, the surcharge and the card rental', async () => {
    await open();
    expect(q('walkup-fee')).toBeNull();
    choose(q<HTMLSelectElement>('walkup-class')!, H21);
    await settle();
    expect(q('walkup-fee')?.textContent).toMatch(/Att betala: 270 kr/);
    q<HTMLInputElement>('walkup-hired')!.click();
    await settle();
    expect(q('walkup-fee')?.textContent).toMatch(/Att betala: 300 kr/);
    expect(q('walkup-fee')?.textContent).toMatch(/brickhyra 30 kr/);
  });

  it('SOFT TR 4.12.4: paid on site: the choice is sent as paid_method, and only when picked', async () => {
    await open();
    expect(q('walkup-paid')).toBeNull();
    (q('walkup-name') as HTMLInputElement).value = 'Eva Ek';
    q('walkup-name')!.dispatchEvent(new Event('input', { bubbles: true }));
    choose(q<HTMLSelectElement>('walkup-class')!, H21);
    q<HTMLInputElement>('walkup-consent')!.click();
    await settle();
    choose(q<HTMLSelectElement>('walkup-paid')!, 'swish');
    await settle();
    q('walkup-save')!.click();
    await settle();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ paid_method: 'swish' });
  });

  it('open class: the birth year decides the youth fee and is sent', async () => {
    await open();
    choose(q<HTMLSelectElement>('walkup-class')!, GUL);
    await settle();
    expect(q('walkup-fee')?.textContent).toMatch(/Att betala: 270 kr/);
    const year = q<HTMLInputElement>('walkup-birth-year')!;
    // 16 or younger in the competition's year: youth fee, no surcharge.
    year.value = String(new Date().getFullYear() - 16);
    year.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(q('walkup-fee')?.textContent).toMatch(/Att betala: 90 kr/);

    (q('walkup-name') as HTMLInputElement).value = 'Eva Ek';
    q('walkup-name')!.dispatchEvent(new Event('input', { bubbles: true }));
    q<HTMLInputElement>('walkup-consent')!.click();
    await settle();
    q('walkup-save')!.click();
    await settle();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      class_id: GUL,
      birth_year: new Date().getFullYear() - 16,
      consent: true,
    });
  });

  it('an unreadable birth year blocks the save', async () => {
    await open();
    (q('walkup-name') as HTMLInputElement).value = 'Eva Ek';
    q('walkup-name')!.dispatchEvent(new Event('input', { bubbles: true }));
    choose(q<HTMLSelectElement>('walkup-class')!, H21);
    const year = q<HTMLInputElement>('walkup-birth-year')!;
    year.value = '12';
    year.dispatchEvent(new Event('input', { bubbles: true }));
    q<HTMLInputElement>('walkup-consent')!.click();
    await settle();
    q('walkup-save')!.click();
    await settle();
    expect(q('walkup-error')?.textContent).toMatch(/födelseåret/);
    expect(posts).toHaveLength(0);
  });

  it("picking another runner replaces the card hit's birth year, also with none", async () => {
    const youthYear = new Date().getFullYear() - 12;
    const kid = {
      person_id: 1,
      family_name: 'Ek',
      given_name: 'Eva',
      club_id: null,
      club_name: null,
      birth_year: youthYear,
    };
    const adult = {
      person_id: 2,
      family_name: 'Ek',
      given_name: 'Anna',
      club_id: null,
      club_name: null,
      birth_year: null,
    };
    await open({ hit: true, ...kid, alternatives: 1, allCandidates: [kid, adult] });
    expect(q<HTMLInputElement>('walkup-birth-year')!.value).toBe(String(youthYear));
    q('walkup-alternatives-chip')!.click();
    await settle();
    q('walkup-alternative-2')!.click();
    await settle();
    // Anna's year is unknown: the field is empty, not Eva's year.
    expect(q<HTMLInputElement>('walkup-birth-year')!.value).toBe('');
    choose(q<HTMLSelectElement>('walkup-class')!, GUL);
    await settle();
    expect(q('walkup-fee')?.textContent).toMatch(/Att betala: 270 kr/);
  });
});
