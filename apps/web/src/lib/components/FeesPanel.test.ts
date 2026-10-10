// Authored for fartola. Not ported from upstream.
//
// Component test of FeesPanel (SOFT TR 4.12.4, 4.12.6): each field saves on
// change, and the fields stay disabled until the reload after a save has
// landed, so the next edit never sends the old values back (ADR-0016 r3).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import FeesPanel from './FeesPanel.svelte';

const COMP = 'comp-1';

let cardFee: number | null;
let puts: Array<Record<string, unknown>>;
/** When set, the next GET waits until the test releases it. */
let holdGet: { release: () => void } | null;

function installFetch(): void {
  puts = [];
  global.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { card_fee: number | null };
      puts.push(body);
      cardFee = body.card_fee;
      return json({ updated: 0 });
    }
    if (holdGet) await new Promise<void>((r) => (holdGet!.release = r));
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

describe('FeesPanel', () => {
  let component: ReturnType<typeof mount> | null = null;

  beforeEach(async () => {
    cardFee = 30;
    holdGet = null;
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

  it('stays disabled until the reload after a save, then edits build on the saved value', async () => {
    expect(cardInput().value).toBe('30');
    holdGet = { release: () => {} };
    cardInput().value = '40';
    cardInput().dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(puts).toEqual([{ card_fee: 40, classes: [] }]);
    // The PUT is done but the reload is not: still disabled.
    expect(cardInput().disabled).toBe(true);
    holdGet.release();
    holdGet = null;
    await settle();
    expect(cardInput().disabled).toBe(false);

    const late = document.querySelector<HTMLInputElement>('input[aria-label^="Tillägg för H21"]')!;
    late.value = '100';
    late.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(puts[1]).toMatchObject({ card_fee: 40 });
  });
});
