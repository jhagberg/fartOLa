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

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
      await tick();
    }
    flushSync();
  };

  beforeEach(() => {
    puts = [];
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
      return json({ eventor: 'not_linked', items });
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

  it('onlyClassId shows that class alone, without the summary', async () => {
    component = mount(ClassKindsPanel, {
      target: document.body,
      props: { competitionId: 'comp-1', onlyClassId: 'h21' },
    });
    await settle();
    expect(document.querySelectorAll('[data-testid="class-kind-row"]')).toHaveLength(1);
    expect(document.querySelector('[data-testid="class-kinds-unconfirmed"]')).toBeNull();
  });
});
