// Authored for fartola. Not ported from upstream.
//
// EditCompetitorModal: a new competitor object for the same runner (every
// card read on /readout hands one in) keeps a half-typed edit; a failed save
// says something plain and logs the raw error.

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
  let patchFails: 'network' | 'server';

  beforeEach(() => {
    patchFails = 'server';
    global.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
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
        onSaved: () => {},
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
