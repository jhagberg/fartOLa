// Authored for fartola. Not ported from upstream.
//
// EditCompetitorModal: a new competitor object for the same runner (every
// card read on /readout hands one in) keeps a half-typed edit; a failed save
// says something plain and logs the raw error; a card change that takes a
// result away is shown first and confirmed with its own button.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { CompetitorDTO } from '@fartola/shared-types';

import EditCompetitorModal from './EditCompetitorModal.svelte';

const runner = (over: Partial<CompetitorDTO> = {}): CompetitorDTO =>
  ({
    id: 'r1',
    competition_id: 'c1',
    name: 'Anna Test',
    club: 'OK Test',
    class_id: 'h21',
    card_number: 1234,
    paid_amount: 0,
    ...over,
  }) as CompetitorDTO;

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
    await tick();
  }
  flushSync();
};
const q = <T extends Element>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);

const props = $state({ competitor: runner() });

describe('EditCompetitorModal', () => {
  let component: ReturnType<typeof mount> | null = null;
  let patchFails: 'network' | 'server' | 'has_result';
  let patches: Array<Record<string, unknown>>;
  /** When set, a PATCH waits until the test releases it. */
  let hold: { release: () => void } | null;
  const onSaved = vi.fn();
  const LOSE = { card_number: 1234, card_seq: 0, status: 'OK', reads: 1, last_read_seq: 9 };

  beforeEach(() => {
    patchFails = 'server';
    patches = [];
    hold = null;
    onSaved.mockReset();
    global.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        patches.push(body);
        if (hold) await new Promise<void>((r) => (hold!.release = r));
        if (patchFails === 'has_result') {
          const json = (b: unknown, status: number) =>
            new Response(JSON.stringify(b), {
              status,
              headers: { 'content-type': 'application/json' },
            });
          return body['lose_result'] === undefined
            ? json(
                { error: 'has_result', competitor_id: 'r1', name: 'Anna Test', lose_result: LOSE },
                409
              )
            : json(
                { ok: true, competitor: runner({ card_number: body['card_number'] as number }) },
                200
              );
        }
        if (patchFails === 'network') throw new TypeError('Failed to fetch');
        return new Response(JSON.stringify({ error: 'boom' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    props.competitor = runner();
    component = mount(EditCompetitorModal, {
      target: document.body,
      props: {
        open: true,
        get competitor() {
          return props.competitor;
        },
        competitionId: 'c1',
        classes: [{ id: 'h21', name: 'H21' }] as never,
        onClose: () => {},
        onSaved,
      },
    });
  });
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const typeName = async (value: string) => {
    const el = q<HTMLInputElement>('edit-name')!;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  };

  it('a new object for the same runner keeps a half-typed edit and the withdraw confirm', async () => {
    await settle();
    await typeName('Anna Halvskriven');
    q<HTMLButtonElement>('edit-withdraw-btn')!.click();
    await settle();
    expect(q('edit-withdraw-confirm')).not.toBeNull();
    props.competitor = runner({ card_number: 5555 });
    await settle();
    expect(q<HTMLInputElement>('edit-name')!.value).toBe('Anna Halvskriven');
    expect(q('edit-withdraw-confirm')).not.toBeNull();
  });

  it('another runner does re-seed the form', async () => {
    await settle();
    await typeName('Anna Halvskriven');
    props.competitor = runner({ id: 'r2', name: 'Bo Test' });
    await settle();
    expect(q<HTMLInputElement>('edit-name')!.value).toBe('Bo Test');
  });

  it('a failed save says something went wrong and logs the raw error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await settle();
    await typeName('Anna Ny');
    q<HTMLButtonElement>('edit-save-btn')!.click();
    await settle();
    expect(q('edit-error')!.textContent).toBe('Något gick fel');
    expect(log).toHaveBeenCalled();
  });

  const typeCard = async (value: string) => {
    const el = q<HTMLInputElement>('edit-card')!;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  };

  it('a new card for a runner with a result: warned first, and only the warning confirms', async () => {
    patchFails = 'has_result';
    await settle();
    await typeCard('5678');
    expect(q('edit-lose-result')).toBeNull();
    q<HTMLButtonElement>('edit-save-btn')!.click();
    await settle();
    expect(q('edit-lose-result')!.textContent).toContain(
      'Anna Test har redan ett resultat. Byter du bricknummer gäller resultatet inte längre för Anna Test.'
    );
    expect(onSaved).not.toHaveBeenCalled();

    // "Spara" again (a double click) asks again; it does not confirm.
    q<HTMLButtonElement>('edit-save-btn')!.click();
    await settle();
    expect(patches).toEqual([{ card_number: 5678 }, { card_number: 5678 }]);
    expect(onSaved).not.toHaveBeenCalled();

    // The warning's own button sends what the warning named, once: a
    // second click while the request is on its way sends nothing.
    hold = { release: () => {} };
    q<HTMLButtonElement>('edit-lose-confirm')!.click();
    q<HTMLButtonElement>('edit-lose-confirm')!.click();
    await settle();
    expect(patches.slice(2)).toEqual([{ card_number: 5678, lose_result: LOSE }]);
    hold.release();
    await settle();
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('the warning is for one runner and one card number: gone when either changes', async () => {
    patchFails = 'has_result';
    await settle();
    await typeCard('5678');
    q<HTMLButtonElement>('edit-save-btn')!.click();
    await settle();
    expect(q('edit-lose-result')).not.toBeNull();

    await typeCard('5679');
    expect(q('edit-lose-result')).toBeNull();
    // Typed back: asked again, not confirmed from memory.
    await typeCard('5678');
    expect(q('edit-lose-result')).toBeNull();
    q<HTMLButtonElement>('edit-save-btn')!.click();
    await settle();
    expect(q('edit-lose-result')).not.toBeNull();

    props.competitor = runner({ id: 'r2', name: 'Bo Annan', card_number: 4321 });
    await settle();
    expect(q('edit-lose-result')).toBeNull();
  });

  it('a network failure says so in plain words', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    patchFails = 'network';
    await settle();
    await typeName('Anna Ny');
    q<HTMLButtonElement>('edit-save-btn')!.click();
    await settle();
    expect(q('edit-error')!.textContent).toBe('Nätverksfel — försök igen');
  });
});
