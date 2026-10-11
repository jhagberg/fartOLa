// Authored for fartola. Not ported from upstream.
//
// SOFT TR 3.4.2: the class-kind list. The helpers in screens/class-kinds.ts
// decide what is proposed and confirmed; the mounted panel (jsdom, routed
// fake fetch) shows unconfirmed kinds in text and confirms with a PUT.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import ClassKindsPanel from './ClassKindsPanel.svelte';
import {
  confirmItem,
  kindStatus,
  parseAge,
  proposed,
  type ClassKindItem,
} from '#lib/screens/class-kinds.ts';

const item = (over: Partial<ClassKindItem>): ClassKindItem => ({
  class_id: 'c',
  name: 'H21',
  class_kind: null,
  age_class: null,
  class_kind_source: null,
  suggestion: null,
  ...over,
});

const H21 = item({
  class_id: 'h21',
  name: 'H21',
  class_kind: 'senior',
  age_class: 21,
  class_kind_source: 'name',
  suggestion: { class_kind: 'senior', age_class: 21, source: 'name' },
});
const D45 = item({
  class_id: 'd45',
  name: 'D45',
  class_kind: 'veteran',
  age_class: 45,
  class_kind_source: 'eventor',
});
const OPEN = item({ class_id: 'x', name: 'Motion lång' });

describe('SOFT TR 3.4.2 — class-kind helpers', () => {
  it('a name guess is only a suggestion; Eventor and the operator confirm', () => {
    expect(kindStatus(H21)).toBe('name');
    expect(kindStatus(D45)).toBe('eventor');
    expect(kindStatus({ ...H21, class_kind_source: 'operator' })).toBe('operator');
    expect(kindStatus(OPEN)).toBe('missing');
    expect(
      kindStatus(item({ suggestion: { class_kind: 'oppen', age_class: null, source: 'eventor' } }))
    ).toBe('eventor_suggestion');
  });

  it('Eventor’s suggestion wins over a stored name guess', () => {
    const it = {
      ...H21,
      suggestion: { class_kind: 'elit' as const, age_class: 21, source: 'eventor' as const },
    };
    expect(proposed(it)).toEqual({ kind: 'elit', age: 21 });
  });

  it('confirmItem confirms the proposal, not a confirmed or unknown class', () => {
    expect(confirmItem(H21)).toEqual({ class_id: 'h21', class_kind: 'senior', age_class: 21 });
    expect(confirmItem(D45)).toBeNull();
    expect(confirmItem(OPEN)).toBeNull();
    // An age class without its age cannot be confirmed blind.
    expect(
      confirmItem(item({ suggestion: { class_kind: 'veteran', age_class: null, source: 'name' } }))
    ).toBeNull();
  });

  it('parseAge: empty → null, a whole number → it, anything else → undefined', () => {
    expect(parseAge('')).toBeNull();
    expect(parseAge(' 12 ')).toBe(12);
    expect(parseAge('0')).toBeUndefined();
    expect(parseAge('12a')).toBeUndefined();
  });

  it('sv + en carry every status and kind label', async () => {
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    const en = (await import('../i18n/en.json')).default as Record<string, string>;
    for (const s of ['eventor', 'operator', 'eventor_suggestion', 'name', 'missing']) {
      expect(sv[`classKinds.status.${s}`], s).toBeTruthy();
      expect(en[`classKinds.status.${s}`], s).toBeTruthy();
    }
    expect(sv['classKinds.status.name']).toBe('Förslag från klassnamnet, inte bekräftad');
  });
});

describe('ClassKindsPanel (mounted)', () => {
  let component: ReturnType<typeof mount> | null = null;
  let puts: unknown[];
  let items: ClassKindItem[];
  /** When set, the next GET waits until the test releases it. */
  let holdGet: { release: () => void } | null;
  /** When set, every PUT waits until the test releases it. */
  let holdPut: { release: () => void } | null;
  /** The next GET of the kinds answers 500 (once). */
  let failGet: boolean;

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
      await tick();
    }
    flushSync();
  };

  beforeEach(() => {
    puts = [];
    holdGet = null;
    holdPut = null;
    failGet = false;
    items = [H21, D45, OPEN];
    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as {
          items: Array<{ class_id: string; class_kind: string; age_class: number | null }>;
        };
        puts.push(body);
        if (holdPut) await new Promise<void>((r) => (holdPut!.release = r));
        const missingAge = body.items.find(
          (i) => i.class_kind === 'veteran' && i.age_class === null
        );
        if (missingAge)
          return json({ error: 'age_class_required', class_id: missingAge.class_id }, 400);
        items = items.map((it) => {
          const p = body.items.find((i) => i.class_id === it.class_id);
          return p
            ? {
                ...it,
                class_kind: p.class_kind as never,
                age_class: p.age_class,
                class_kind_source: 'operator',
              }
            : it;
        });
        return json({ updated: body.items.length });
      }
      expect(String(input)).toBe('/api/competitions/comp-1/classes/kinds');
      if (failGet) {
        failGet = false;
        return json({ error: 'boom' }, 500);
      }
      const now = items;
      if (holdGet) await new Promise<void>((r) => (holdGet!.release = r));
      return json({ eventor: 'not_linked', items: now });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const status = (id: string) =>
    document
      .querySelector(`[data-class-id="${id}"] [data-testid="class-kind-status"]`)!
      .textContent!.trim();

  it('a failed load says so in plain words, logs the raw error and retries', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    failGet = true;
    component = mount(ClassKindsPanel, {
      target: document.body,
      props: { competitionId: 'comp-1' },
    });
    await settle();
    const alert = document.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Kunde inte läsa klasstyperna.');
    expect(alert.textContent).not.toMatch(/boom|500|HTTP/);
    expect(log).toHaveBeenCalled();
    alert.querySelector('button')!.click();
    await settle();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(status('h21')).toBe('Förslag från klassnamnet, inte bekräftad');
  });

  it('shows unconfirmed kinds in text and confirms all proposals with one PUT', async () => {
    component = mount(ClassKindsPanel, {
      target: document.body,
      props: { competitionId: 'comp-1' },
    });
    await settle();
    expect(status('h21')).toBe('Förslag från klassnamnet, inte bekräftad');
    expect(status('d45')).toBe('Bekräftad (från Eventor)');
    expect(status('x')).toBe('Saknas, välj klasstyp');
    expect(
      document.querySelector('[data-testid="class-kinds-unconfirmed"]')!.textContent
    ).toContain('Klasser utan bekräftad klasstyp: 2.');

    (
      document.querySelector('[data-testid="class-kinds-confirm-all"]') as HTMLButtonElement
    ).click();
    await settle();
    expect(puts).toEqual([{ items: [{ class_id: 'h21', class_kind: 'senior', age_class: 21 }] }]);
    expect(status('h21')).toBe('Bekräftad');
  });

  it('choosing a kind saves it at once; an age class without age asks for the age next to the row', async () => {
    component = mount(ClassKindsPanel, {
      target: document.body,
      props: { competitionId: 'comp-1' },
    });
    await settle();
    const select = document.querySelector(
      '[data-class-id="x"] [data-testid="class-kind-select"]'
    ) as HTMLSelectElement;
    select.value = 'veteran';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    // No PUT without an age; the error sits in the row.
    expect(puts).toEqual([]);
    expect(
      document.querySelector('[data-class-id="x"] [data-testid="class-kind-error"]')!.textContent
    ).toContain('Ange ålder');

    const age = document.querySelector(
      '[data-class-id="x"] [data-testid="class-kind-age"]'
    ) as HTMLInputElement;
    age.value = '45';
    age.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(puts).toEqual([{ items: [{ class_id: 'x', class_kind: 'veteran', age_class: 45 }] }]);
    expect(status('x')).toBe('Bekräftad');
    expect(
      document.querySelector('[data-class-id="x"] [data-testid="class-kind-error"]')
    ).toBeNull();
  });

  it('confirm-all leaves out a row whose edit is not saved, keeps the edit and its error, and says so', async () => {
    const D10 = item({
      class_id: 'd10',
      name: 'D10',
      class_kind: 'ungdom',
      age_class: 10,
      class_kind_source: 'name',
      suggestion: { class_kind: 'ungdom', age_class: 10, source: 'name' },
    });
    items = [H21, D10];
    component = mount(ClassKindsPanel, {
      target: document.body,
      props: { competitionId: 'comp-1' },
    });
    await settle();
    // The operator clears H21's age: nothing is saved, the row asks for it.
    const age = document.querySelector(
      '[data-class-id="h21"] [data-testid="class-kind-age"]'
    ) as HTMLInputElement;
    age.value = '';
    age.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(puts).toEqual([]);

    expect(document.querySelector('[data-testid="class-kinds-pending"]')!.textContent).toContain(
      'tas inte med: 1'
    );
    (
      document.querySelector('[data-testid="class-kinds-confirm-all"]') as HTMLButtonElement
    ).click();
    await settle();
    expect(puts).toEqual([{ items: [{ class_id: 'd10', class_kind: 'ungdom', age_class: 10 }] }]);
    expect(
      (
        document.querySelector(
          '[data-class-id="h21"] [data-testid="class-kind-age"]'
        ) as HTMLInputElement
      ).value
    ).toBe('');
    expect(
      document.querySelector('[data-class-id="h21"] [data-testid="class-kind-error"]')!.textContent
    ).toContain('Ange ålder');
    expect(status('h21')).toBe('Förslag från klassnamnet, inte bekräftad');
  });

  it('a saved row keeps its choice, and stays out of Bekräfta alla, until the reload lands', async () => {
    component = mount(ClassKindsPanel, {
      target: document.body,
      props: { competitionId: 'comp-1' },
    });
    await settle();
    const select = () =>
      document.querySelector(
        '[data-class-id="h21"] [data-testid="class-kind-select"]'
      ) as HTMLSelectElement;
    holdGet = { release: () => {} };
    select().value = 'elit';
    select().dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(puts).toEqual([{ items: [{ class_id: 'h21', class_kind: 'elit', age_class: 21 }] }]);
    // The PUT is done, the reload is not: still the chosen kind, not confirmable.
    expect(select().value).toBe('elit');
    expect(document.querySelector('[data-testid="class-kinds-confirm-all"]')).toBeNull();
    const held = holdGet;
    holdGet = null;
    held.release();
    await settle();
    expect(select().value).toBe('elit');
    expect(status('h21')).toBe('Bekräftad');
  });

  it('onlyClassId shows that class alone, without the summary', async () => {
    component = mount(ClassKindsPanel, {
      target: document.body,
      props: { competitionId: 'comp-1', onlyClassId: 'h21' },
    });
    await settle();
    expect(document.querySelectorAll('[data-testid="class-kind-row"]')).toHaveLength(1);
    expect(document.querySelector('[data-testid="class-kinds-unconfirmed"]')).toBeNull();
  });

  const rowEl = (id: string, testid: string) =>
    document.querySelector(`[data-class-id="${id}"] [data-testid="${testid}"]`);
  const choose = async (id: string, kind: string) => {
    const select = rowEl(id, 'class-kind-select') as HTMLSelectElement;
    select.value = kind;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  };
  const release = async () => {
    const held = holdPut!;
    holdPut = null;
    held.release();
    await settle();
  };

  it('a kind chosen without its age while a save is in flight is kept, not dropped as saved', async () => {
    component = mount(ClassKindsPanel, {
      target: document.body,
      props: { competitionId: 'comp-1' },
    });
    await settle();
    holdPut = { release: () => {} };
    await choose('x', 'inskolning');
    await choose('x', 'veteran');
    expect(rowEl('x', 'class-kind-error')!.textContent).toContain('Ange ålder');
    await release();
    expect(puts).toEqual([
      { items: [{ class_id: 'x', class_kind: 'inskolning', age_class: null }] },
    ]);
    expect((rowEl('x', 'class-kind-select') as HTMLSelectElement).value).toBe('veteran');
    expect(rowEl('x', 'class-kind-age')).not.toBeNull();
    expect(rowEl('x', 'class-kind-error')!.textContent).toContain('Ange ålder');
    expect(rowEl('x', 'class-kind-note')!.textContent).not.toContain('Sparat');
  });

  it('an age cleared while a save is in flight stays cleared, with its message', async () => {
    component = mount(ClassKindsPanel, {
      target: document.body,
      props: { competitionId: 'comp-1' },
    });
    await settle();
    holdPut = { release: () => {} };
    await choose('h21', 'elit');
    const age = rowEl('h21', 'class-kind-age') as HTMLInputElement;
    age.value = '';
    age.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    await release();
    expect(puts).toHaveLength(1);
    expect((rowEl('h21', 'class-kind-age') as HTMLInputElement).value).toBe('');
    expect(rowEl('h21', 'class-kind-error')!.textContent).toContain('Ange ålder');
    expect(rowEl('h21', 'class-kind-note')!.textContent).not.toContain('Sparat');
  });
});
