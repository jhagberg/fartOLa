// Authored for fartola. Not ported from upstream.
//
// Component test of the "Är det någon som är anmäld?" step that WalkupModal
// shows first for an unknown card: the real component is mounted in jsdom
// with a routed fake fetch.
//   - A suggested entered runner → show before ("Byt bricka för …") →
//     confirm sends the card replacement and reports it for undo.
//   - Search by name among the entries.
//   - Not entered → the direct-entry form, as before.
//   - No unread entries at all → straight to the form.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import WalkupModal from './WalkupModal.svelte';
import type { CardRebind } from '#lib/api/client.ts';

const COMP = 'comp-1';
const EVA = '00000000-0000-4000-8000-0000000000e1';
const BO = '00000000-0000-4000-8000-0000000000b1';

function runner(id: string, name: string, card: number | null, suggested: boolean) {
  return {
    competitor_id: id,
    name,
    club: name === 'Eva Ek' ? 'OK Ek' : 'IK Bo',
    class_id: 'cls-1',
    class_name: 'H21',
    card_number: card,
    start_time_ms: null,
    missing: suggested ? 0 : 4,
    extra: 0,
    start_diff_ms: null,
    suggested,
  };
}

let entries: unknown[];
let posts: Array<{ url: string; body: Record<string, unknown> }>;

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
      return json({ card_number: 2222222, clock_offset_min: 120, runners: entries });
    if (url === '/api/competitors' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posts.push({ url, body });
      return json({
        id: body['replace_card_for_competitor_id'],
        name: 'Eva Ek',
        card_number: body['card_number'],
        card_event: { node_id: 'n', local_seq: 7, previous_card_number: 1111111 },
      });
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

const q = (testid: string): HTMLElement | null =>
  document.querySelector(`[data-testid="${testid}"]`);
const all = (testid: string): HTMLElement[] =>
  Array.from(document.querySelectorAll(`[data-testid="${testid}"]`));

describe('WalkupModal — is the runner entered?', () => {
  let component: ReturnType<typeof mount> | null = null;
  let onClose: ReturnType<typeof vi.fn<(saved: boolean) => void>>;
  let onRebound: ReturnType<typeof vi.fn<(r: CardRebind) => void>>;

  const open = async (): Promise<void> => {
    onClose = vi.fn<(saved: boolean) => void>();
    onRebound = vi.fn<(r: CardRebind) => void>();
    component = mount(WalkupModal, {
      target: document.body,
      props: { cardNumber: 2222222, competitionId: COMP, classes: [], onClose, onRebound },
    });
    await settle();
  };

  beforeEach(() => {
    entries = [runner(EVA, 'Eva Ek', 1111111, true), runner(BO, 'Bo Berg', null, false)];
    installFetch();
  });
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('suggests the entered runner; confirm shows before and rebinds the card', async () => {
    await open();
    expect(document.querySelector('h2')?.textContent).toBe('Är det någon som är anmäld?');
    const suggestions = all('entered-suggestion');
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.textContent).toContain('Eva Ek');
    expect(suggestions[0]!.textContent).toContain('Banan stämmer');

    suggestions[0]!.click();
    await settle();
    expect(q('entered-confirm')?.textContent).toContain('Byt bricka för Eva Ek: 1111111 → 2222222');
    expect(posts).toHaveLength(0);

    q('entered-save')!.click();
    await settle();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toMatchObject({
      competition_id: COMP,
      card_number: 2222222,
      replace_card_for_competitor_id: EVA,
      hired_card: false,
    });
    expect(onRebound).toHaveBeenCalledWith({
      competitor_id: EVA,
      name: 'Eva Ek',
      card_number: 2222222,
      card_event: { node_id: 'n', local_seq: 7, previous_card_number: 1111111 },
    });
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('searches the entries by name; a runner without a card shows "ingen bricka"', async () => {
    await open();
    const search = q('entered-search') as HTMLInputElement;
    search.value = 'berg';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    const results = all('entered-result');
    expect(results.map((r) => r.querySelector('.runner-name')?.textContent)).toEqual(['Bo Berg']);
    results[0]!.click();
    await settle();
    expect(q('entered-confirm')?.textContent).toContain(
      'Byt bricka för Bo Berg: ingen bricka → 2222222'
    );
  });

  it('a hired card needs a phone or e-mail before anything is sent', async () => {
    await open();
    all('entered-suggestion')[0]!.click();
    await settle();
    (q('entered-hired') as HTMLInputElement).click();
    await settle();
    q('entered-save')!.click();
    await settle();
    expect(q('entered-error')?.textContent).toMatch(/telefon|e-post/i);
    expect(posts).toHaveLength(0);
  });

  it('not entered → the direct-entry form as before', async () => {
    await open();
    expect(q('walkup-name')).toBeNull();
    q('walkup-not-entered')!.click();
    await settle();
    expect(q('walkup-name')).not.toBeNull();
    expect(q('walkup-save')).not.toBeNull();
  });

  it('no unread entries → straight to the form', async () => {
    entries = [];
    await open();
    expect(q('entered-step')).toBeNull();
    expect(q('walkup-name')).not.toBeNull();
  });
});
