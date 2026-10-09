// Authored for fartola. Not ported from upstream.
//
// Component test of CardRebindNotice: says what the card replacement did
// and undoes it (the runner gets the old card back), mounted in jsdom with
// a fake fetch.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import CardRebindNotice from './CardRebindNotice.svelte';
import { noticeProps } from './CardRebindNotice.testprops.svelte.ts';

const rebind = {
  competitor_id: 'eva',
  name: 'Eva Ek',
  card_number: 2222222,
  card_event: { node_id: 'n', local_seq: 7, previous_card_number: 1111111 },
};

let calls: Array<{ url: string; body: unknown }>;

function installFetch(status: number, body: unknown): void {
  calls = [];
  global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await tick();
  }
  flushSync();
};

const q = (testid: string): HTMLElement | null =>
  document.querySelector(`[data-testid="${testid}"]`);

describe('CardRebindNotice', () => {
  let component: ReturnType<typeof mount> | null = null;
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('shows the change and undoes it', async () => {
    installFetch(201, { competitor_id: 'eva', card_number: 1111111, local_seq: 8 });
    const onUndone = vi.fn();
    component = mount(CardRebindNotice, {
      target: document.body,
      props: { competitionId: 'comp-1', rebind, onUndone, onClose: vi.fn() },
    });
    await settle();
    expect(q('card-rebind-notice')?.textContent).toContain(
      'Bricka bytt för Eva Ek: 1111111 → 2222222'
    );

    q('card-rebind-undo')!.click();
    await settle();
    expect(calls).toEqual([
      { url: '/api/competitions/comp-1/card-binds/undo', body: { node_id: 'n', local_seq: 7 } },
    ]);
    expect(onUndone).toHaveBeenCalledOnce();
    expect(q('card-rebind-notice')?.textContent).toContain('Bytet ångrat: Eva Ek har 1111111 igen');
    expect(q('card-rebind-undo')).toBeNull();
  });

  it('a new replacement shown in the same place starts with its own undo', async () => {
    installFetch(201, { competitor_id: 'eva', card_number: 1111111, local_seq: 8 });
    noticeProps.rebind = rebind;
    component = mount(CardRebindNotice, {
      target: document.body,
      props: {
        competitionId: 'comp-1',
        get rebind() {
          return noticeProps.rebind;
        },
        onClose: vi.fn(),
      },
    });
    await settle();
    q('card-rebind-undo')!.click();
    await settle();
    expect(q('card-rebind-undo')).toBeNull();

    noticeProps.rebind = {
      competitor_id: 'bo',
      name: 'Bo Berg',
      card_number: 3333333,
      card_event: { node_id: 'n', local_seq: 9, previous_card_number: null },
    };
    await settle();
    expect(q('card-rebind-notice')?.textContent).toContain(
      'Bricka bytt för Bo Berg: ingen bricka → 3333333'
    );
    expect(q('card-rebind-undo')).not.toBeNull();
  });

  it('says why when the card has been changed again since', async () => {
    installFetch(409, { error: 'card_changed_since' });
    component = mount(CardRebindNotice, {
      target: document.body,
      props: { competitionId: 'comp-1', rebind, onClose: vi.fn() },
    });
    await settle();
    q('card-rebind-undo')!.click();
    await settle();
    expect(q('card-rebind-notice')?.textContent).toContain('Ångra det senare bytet först');
    expect(q('card-rebind-undo')).not.toBeNull();
  });
});
