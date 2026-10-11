// Authored for fartola. Not ported from upstream.
//
// Component test of FeesPanel (SOFT TR 4.12.4, 4.12.6): each field saves on
// change and says so at its row (ADR-0016 r3). A row sends its last saved
// values plus the change; an edit made while the row saves waits for it,
// so it never sends old values back; a failure shows the saved value again.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import FeesPanel from './FeesPanel.svelte';

const COMP = 'comp-1';

let cardFee: number | null;
let puts: Array<Record<string, unknown>>;
/** When set, the next PUT waits until the test releases it. */
let holdPut: { release: () => void } | null;
let failPut: boolean;

function installFetch(): void {
  puts = [];
  global.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { card_fee?: number | null };
      puts.push(body);
      if (holdPut) await new Promise<void>((r) => (holdPut!.release = r));
      if (failPut) return json({ error: 'boom' }, 500);
      if (body.card_fee !== undefined) cardFee = body.card_fee;
      return json({ updated: 0 });
    }
    return json({
      date: '2026-10-10',
      card_fee: cardFee,
      classes: [
        {
          class_id: 'h21',
          name: 'H21',
          class_kind: 'senior',
          entry_fee: 180,
          youth_entry_fee: null,
          late_fee_pct: 50,
        },
      ],
    });
  }) as unknown as typeof fetch;
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
    await tick();
  }
  flushSync();
};

const cardInput = () => document.querySelector<HTMLInputElement>('[data-testid="fees-card-fee"]')!;
const entry = () =>
  document.querySelector<HTMLInputElement>('input[aria-label^="Avgift för H21"]')!;
const late = () =>
  document.querySelector<HTMLInputElement>('input[aria-label^="Tillägg för H21"]')!;
const rowNote = () =>
  document
    .querySelector('[data-class-id="h21"] [data-testid="fees-row-note"]')!
    .textContent!.trim();
const change = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
const H21 = { class_id: 'h21', entry_fee: 180, youth_entry_fee: null, late_fee_pct: 50 };

describe('FeesPanel', () => {
  let component: ReturnType<typeof mount> | null = null;

  beforeEach(async () => {
    cardFee = 30;
    holdPut = null;
    failPut = false;
    installFetch();
    component = mount(FeesPanel, {
      target: document.body,
      props: { competitionId: COMP, eventorLinked: false },
    });
    await settle();
  });
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('the card fee goes alone; a class row sends its saved row plus the change, and says Sparat', async () => {
    expect(cardInput().value).toBe('30');
    change(cardInput(), '40');
    await settle();
    expect(puts).toEqual([{ card_fee: 40 }]);
    change(late(), '100');
    await settle();
    expect(puts[1]).toEqual({ classes: [{ ...H21, late_fee_pct: 100 }] });
    expect(rowNote()).toBe('Sparat');
  });

  it('an edit made while the row saves waits, then goes out on the saved row', async () => {
    holdPut = { release: () => {} };
    change(entry(), '200');
    await settle();
    // Not disabled while it saves: the next edit queues.
    expect(late().disabled).toBe(false);
    change(late(), '60');
    await settle();
    expect(puts).toHaveLength(1);
    const first = holdPut;
    holdPut = null;
    first.release();
    await settle();
    expect(puts).toEqual([
      { classes: [{ ...H21, entry_fee: 200 }] },
      { classes: [{ ...H21, entry_fee: 200, late_fee_pct: 60 }] },
    ]);
    expect(rowNote()).toBe('Sparat');
  });

  it('a failed save says so at the row and shows the saved value again', async () => {
    failPut = true;
    change(entry(), '999');
    await settle();
    expect(rowNote()).toBe('Det gick inte att spara avgiften.');
    expect(entry().value).toBe('180');
  });
});
