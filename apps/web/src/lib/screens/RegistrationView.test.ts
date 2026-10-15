// Authored for fartola. Not ported from upstream.
//
// Cancelling the registration of a card that is already bound, when the
// server refuses with its own text, says "Något gick fel"; the raw text
// goes to the console only.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

type Opts = { onCardRead: (card: number, hint: string | null, c: 'known' | 'unknown') => void };
const captured: { opts: Opts | null } = { opts: null };

vi.mock('#lib/services/cardSubscription.ts', () => ({
  createCardSubscription: (opts: Opts) => {
    captured.opts = opts;
    return { connect: () => {}, disconnect: () => {} };
  },
}));

import RegistrationView from './RegistrationView.svelte';

describe('RegistrationView', () => {
  let component: ReturnType<typeof mount> | null = null;
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
      await tick();
    }
    flushSync();
  };

  it('a refused cancel with server text says Något gick fel, never the text', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (init?.method !== undefined && init.method !== 'GET' && String(input).includes('status'))
        return json({ error: 'SQLITE_BUSY: database is locked' }, 500);
      if (String(input).includes('card_number='))
        return json({
          competitors: [{ id: 'k1', name: 'Eva Ek', club: null, class_id: 'x', card_number: 5 }],
        });
      return json({ classes: [] });
    }) as unknown as typeof fetch;
    component = mount(RegistrationView, {
      target: document.body,
      props: { competitionId: 'c1' },
    });
    await settle();
    captured.opts!.onCardRead(5, 'Eva Ek', 'known');
    await settle();
    document.querySelector<HTMLElement>('[data-testid="reg-known-cancel"]')!.click();
    await settle();
    expect(document.querySelector('.known-err')!.textContent).toBe('Något gick fel');
    expect(document.body.textContent).not.toContain('SQLITE_BUSY');
    expect(log).toHaveBeenCalled();
  });
});
