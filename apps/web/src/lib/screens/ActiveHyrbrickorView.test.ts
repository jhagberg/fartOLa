// Authored for fartola. Not ported from upstream.
//
// Vitest coverage for ActiveHyrbrickorView (Plan 02-05 Task 3) and the
// Sidebar nav-item presence. Pure-helper style — no svelte-testing-library
// mount (matches the project convention; see EventorAutocomplete.test.ts
// header).
//
// We exercise the four observable contracts:
//   1. The new i18n keys (sv + en) for hyrbrickor.* + nav.hyrbrickor.
//   2. The api client wrapper listHiredCards already covered in
//      HyrbrickaToast.test.ts; here we check the view's render-logic
//      via pure helpers that mirror the component's Svelte derivations.
//   3. The empty-state predicate (open === 0 AND returned === 0).
//   4. The Sidebar nav-item shape (route id "hyrbrickor", icon, label).
//
// Locked by:
// - .planning/phases/02-4-klubbs-mvp/02-05-PLAN.md task 3
// - .planning/phases/02-4-klubbs-mvp/02-CONTEXT.md D-HB-2 (admin backstop view)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

// Warm the i18n modules during collection. The first dynamic import inside a
// test pays the cold Vite transform (index.ts, tweaks store, i18next, both
// catalogs) and counts against the per-test timeout, which a machine under
// heavy load (all packages' tests in parallel) can blow past 10s. Importing
// here runs outside any test timeout; the imports in the tests then hit the
// module cache.
await import('../i18n/index.ts');
await import('../i18n/sv.json');
await import('../i18n/en.json');
await import('./ActiveHyrbrickorView.svelte');

describe('Plan 02-05 — i18n keys for ActiveHyrbrickorView + Sidebar', () => {
  it('sv.json has all hyrbrickor.* + nav.hyrbrickor keys', async () => {
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    for (const key of [
      'nav.hyrbrickor',
      'hyrbrickor.title',
      'hyrbrickor.empty',
      'hyrbrickor.openSection',
      'hyrbrickor.returnedSection',
      'hyrbrickor.markedAt',
      'hyrbrickor.returnedAt',
    ]) {
      expect(sv[key], `missing sv key ${key}`).toBeTruthy();
    }
    expect(sv['nav.hyrbrickor']).toBe('Hyrbrickor');
    expect(sv['hyrbrickor.title']).toBe('Aktiva hyrbrickor');
    expect(sv['hyrbrickor.empty']).toBe(
      'Inga hyrbrickor ute just nu. Hyrbrickor som lånas ut vid direktanmälan visas här tills de lämnas tillbaka.'
    );
  });

  it('en.json mirrors all hyrbrickor.* + nav.hyrbrickor keys', async () => {
    const en = (await import('../i18n/en.json')).default as Record<string, string>;
    for (const key of [
      'nav.hyrbrickor',
      'hyrbrickor.title',
      'hyrbrickor.empty',
      'hyrbrickor.openSection',
      'hyrbrickor.returnedSection',
      'hyrbrickor.markedAt',
      'hyrbrickor.returnedAt',
    ]) {
      expect(en[key], `missing en key ${key}`).toBeTruthy();
    }
    expect(en['nav.hyrbrickor']).toBe('Hired cards');
  });

  it('hyrbrickor.markedAt + hyrbrickor.returnedAt accept {{time}} interpolation', async () => {
    const i18n = await import('../i18n/index.ts');
    expect(i18n.t('hyrbrickor.markedAt', { time: '14:25' })).toMatch(/14:25/);
    expect(i18n.t('hyrbrickor.returnedAt', { time: '15:30' })).toMatch(/15:30/);
  });

  it('SOFT TR 4.12.4: hyrbrickor.fee shows the rental fee in kronor', async () => {
    const i18n = await import('../i18n/index.ts');
    expect(i18n.t('hyrbrickor.fee', { fee: 30 })).toMatch(/30 kr/);
  });
});

describe('Plan 02-05 — ActiveHyrbrickorView api fetch wires', () => {
  beforeEach(() => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ open: [], returned: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('listHiredCards uses the right URL for a given competition id', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const { listHiredCards } = await import('../api/client.ts');
    await listHiredCards('abc-123');
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toBe('/api/competitions/abc-123/hired-cards');
  });

  it('returnHiredCard uses the right URL + PATCH method', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, returned_at_ms: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const { returnHiredCard } = await import('../api/client.ts');
    await returnHiredCard('comp-x', 12345);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      '/api/competitions/comp-x/hired-cards/12345/return'
    );
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.method).toBe('PATCH');
  });
});

/**
 * Replica of the view's empty-state predicate. The view shows
 * t('hyrbrickor.empty') iff BOTH open and returned arrays are empty
 * AND loading has finished AND no error.
 */
function shouldShowEmptyState(input: {
  open: unknown[];
  returned: unknown[];
  loading: boolean;
  error: string | null;
}): boolean {
  if (input.loading) return false;
  if (input.error !== null) return false;
  return input.open.length === 0 && input.returned.length === 0;
}

describe('Plan 02-05 — empty-state predicate', () => {
  it('shows empty state when both arrays are empty AND not loading AND no error', () => {
    expect(shouldShowEmptyState({ open: [], returned: [], loading: false, error: null })).toBe(
      true
    );
  });

  it('hides empty state while loading', () => {
    expect(shouldShowEmptyState({ open: [], returned: [], loading: true, error: null })).toBe(
      false
    );
  });

  it('hides empty state on error', () => {
    expect(shouldShowEmptyState({ open: [], returned: [], loading: false, error: 'oops' })).toBe(
      false
    );
  });

  it('hides empty state when open has rows', () => {
    expect(
      shouldShowEmptyState({
        open: [{ card_number: 1 }],
        returned: [],
        loading: false,
        error: null,
      })
    ).toBe(false);
  });

  it('hides empty state when returned has rows', () => {
    expect(
      shouldShowEmptyState({
        open: [],
        returned: [{ card_number: 1 }],
        loading: false,
        error: null,
      })
    ).toBe(false);
  });
});

/**
 * Per-row refetch after Returnerad: the view filters out the returned
 * card from `open` and pushes it onto `returned` with the new timestamp.
 * Mirrors the in-component refetch helper.
 */
function applyLocalReturn(
  state: {
    open: Array<{ card_number: number; marked_at_ms: number; returned_at_ms: number | null }>;
    returned: Array<{ card_number: number; marked_at_ms: number; returned_at_ms: number | null }>;
  },
  cardNumber: number,
  returnedAtMs: number
): typeof state {
  const moved = state.open.find((r) => r.card_number === cardNumber);
  if (!moved) return state;
  const open = state.open.filter((r) => r.card_number !== cardNumber);
  const returned = [{ ...moved, returned_at_ms: returnedAtMs }, ...state.returned];
  return { open, returned };
}

describe('Plan 02-05 — applyLocalReturn (per-row local update after PATCH)', () => {
  it('moves the row from open → returned with the new timestamp', () => {
    const before = {
      open: [
        { card_number: 11111, marked_at_ms: 1_000, returned_at_ms: null },
        { card_number: 22222, marked_at_ms: 2_000, returned_at_ms: null },
      ],
      returned: [],
    };
    const after = applyLocalReturn(before, 11111, 9_999);
    expect(after.open.length).toBe(1);
    expect(after.open[0]?.card_number).toBe(22222);
    expect(after.returned.length).toBe(1);
    expect(after.returned[0]?.card_number).toBe(11111);
    expect(after.returned[0]?.returned_at_ms).toBe(9_999);
  });

  it('is a no-op when the card is not in open (idempotent)', () => {
    const before = {
      open: [{ card_number: 22222, marked_at_ms: 2_000, returned_at_ms: null }],
      returned: [{ card_number: 11111, marked_at_ms: 1_000, returned_at_ms: 5_000 }],
    };
    const after = applyLocalReturn(before, 11111, 9_999);
    // Same arrays, returned timestamp preserved.
    expect(after.open.length).toBe(1);
    expect(after.returned.length).toBe(1);
    expect(after.returned[0]?.returned_at_ms).toBe(5_000);
  });
});

// ---------------------------------------------------------------------------
// Mounted view: return result, load errors, return errors, empty state.
// Synthetic cards only. One endpoint returns both lists.
// ---------------------------------------------------------------------------
describe('ActiveHyrbrickorView mounted', () => {
  const ROW = {
    competition_id: '00000000-0000-4000-8000-000000000001',
    marked_at_ms: 1_000,
    returned_at_ms: null,
    contact_name: 'Anna Andersson',
    contact_phone: '0701234567',
    contact_email: null,
    note: null,
  };
  const open = [
    { ...ROW, card_number: 7501853 },
    { ...ROW, card_number: 1428824, contact_name: 'Cia Carlsson' },
  ];
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  type Handler = (url: string, init?: RequestInit) => Promise<Response>;
  let target: HTMLElement;
  let handle: Handler;
  let view: ReturnType<typeof mount> | undefined;

  async function show(): Promise<void> {
    const mod = await import('./ActiveHyrbrickorView.svelte');
    view = mount(mod.default, { target, props: { competitionId: 'c1' } });
    await settle();
  }
  async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
      await tick();
      flushSync();
    }
  }
  const q = (id: string): HTMLElement | null => target.querySelector(`[data-testid="${id}"]`);
  const text = (): string => target.textContent ?? '';

  beforeEach(() => {
    target = document.createElement('div');
    document.body.appendChild(target);
    global.fetch = vi.fn(async (u: RequestInfo | URL, init?: RequestInit) =>
      handle(String(u), init)
    ) as unknown as typeof fetch;
  });
  afterEach(async () => {
    if (view) await unmount(view);
    view = undefined;
    target.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('return moves the card to Återlämnade and shows the result', async () => {
    let done = false;
    handle = async (url, init) => {
      if (init?.method === 'PATCH') {
        done = true;
        return json({ ok: true, returned_at_ms: 5_000 });
      }
      return done
        ? json({ open: [open[1]], returned: [{ ...open[0], returned_at_ms: 5_000 }] })
        : json({ open, returned: [] });
    };
    await show();
    expect(target.querySelectorAll('[data-testid=hyrbrickor-open-row]').length).toBe(2);
    (target.querySelector('[data-testid=hyrbrickor-row-return]') as HTMLButtonElement).click();
    await settle();
    expect(q('hyrbrickor-toast')?.textContent).toBe('Bricka 7501853 återlämnad');
    expect(q('hyrbrickor-toast')?.getAttribute('role')).toBe('status');
    expect(q('hyrbrickor-returned-row')?.textContent).toContain('7501853');
    expect(target.querySelectorAll('[data-testid=hyrbrickor-open-row]').length).toBe(1);
  });

  it('the toast goes away after 3 s', async () => {
    vi.useFakeTimers();
    handle = async (url, init) =>
      init?.method === 'PATCH'
        ? json({ ok: true, returned_at_ms: 5_000 })
        : json({ open, returned: [] });
    await show();
    (target.querySelector('[data-testid=hyrbrickor-row-return]') as HTMLButtonElement).click();
    await settle();
    expect(q('hyrbrickor-toast')).not.toBeNull();
    vi.advanceTimersByTime(3_000);
    await settle();
    expect(q('hyrbrickor-toast')).toBeNull();
  });

  it('a failed first load shows one LoadError with a retry that loads the lists', async () => {
    let fail = true;
    handle = async () => (fail ? json({ error: 'boom' }, 500) : json({ open, returned: [] }));
    await show();
    expect(target.querySelectorAll('[role=alert]').length).toBe(1);
    expect(text()).toContain('Kunde inte hämta hyrbrickor.');
    expect(text()).not.toContain('boom');
    fail = false;
    const retry = [...target.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Försök igen')
    );
    retry!.click();
    await settle();
    expect(q('hyrbrickor-error')).toBeNull();
    expect(target.querySelectorAll('[data-testid=hyrbrickor-open-row]').length).toBe(2);
  });

  it('a failed reload keeps the cached lists, says so, and retries', async () => {
    let fail = false;
    handle = async (url, init) =>
      init?.method === 'PATCH'
        ? json({ ok: true, returned_at_ms: 5_000 })
        : fail
          ? json({ error: 'boom' }, 500)
          : json({ open, returned: [] });
    await show();
    fail = true;
    (target.querySelector('[data-testid=hyrbrickor-row-return]') as HTMLButtonElement).click();
    await settle();
    expect(text()).toContain('Kunde inte uppdatera listan. Visar senast hämtade.');
    expect(target.querySelectorAll('[data-testid=hyrbrickor-open-row]').length).toBe(1);
    expect(target.querySelectorAll('[data-testid=hyrbrickor-returned-row]').length).toBe(1);
    fail = false;
    handle = async () =>
      json({ open: [open[1]], returned: [{ ...open[0], returned_at_ms: 5_000 }] });
    const retry = [...q('hyrbrickor-reload-error')!.querySelectorAll('button')][0]!;
    retry.click();
    await settle();
    expect(q('hyrbrickor-reload-error')).toBeNull();
  });

  it('a retry from the stale warning shows that it is fetching until the answer is in', async () => {
    let mode: 'ok' | 'fail' | 'hold' = 'ok';
    let release: (r: Response) => void = () => {};
    handle = (url, init) => {
      if (init?.method === 'PATCH')
        return Promise.resolve(json({ ok: true, returned_at_ms: 5_000 }));
      if (mode === 'fail') return Promise.resolve(json({ error: 'boom' }, 500));
      if (mode === 'hold') return new Promise((r) => (release = r));
      return Promise.resolve(json({ open, returned: [] }));
    };
    await show();
    mode = 'fail';
    (target.querySelector('[data-testid=hyrbrickor-row-return]') as HTMLButtonElement).click();
    await settle();
    expect(q('hyrbrickor-reload-error')).not.toBeNull();
    mode = 'hold';
    q('hyrbrickor-reload-error')!.querySelector('button')!.click();
    await settle();
    expect(q('hyrbrickor-reloading')).not.toBeNull();
    expect(q('hyrbrickor-reload-error')).toBeNull();
    release(json({ open, returned: [] }));
    await settle();
    expect(q('hyrbrickor-reloading')).toBeNull();
    expect(q('hyrbrickor-reload-error')).toBeNull();
  });

  it('an older load does not overwrite newer data', async () => {
    const resolvers: Array<(r: Response) => void> = [];
    let n = 0;
    handle = (url, init) => {
      if (init?.method === 'PATCH')
        return Promise.resolve(json({ ok: true, returned_at_ms: 5_000 }));
      n++;
      if (n === 1) return Promise.resolve(json({ open, returned: [] }));
      return new Promise((res) => resolvers.push(res));
    };
    await show();
    // Return a card: its reload (#2) hangs. Returning the other card starts
    // a second reload (#3) that hangs too.
    (target.querySelector('[data-testid=hyrbrickor-row-return]') as HTMLButtonElement).click();
    await settle();
    expect(resolvers.length).toBe(1);
    // Newest response arrives first, the older one afterwards.
    const after = { open: [open[1]], returned: [{ ...open[0], returned_at_ms: 5_000 }] };
    (target.querySelector('[data-testid=hyrbrickor-row-return]') as HTMLButtonElement).click();
    await settle();
    expect(resolvers.length).toBe(2);
    resolvers[1]!(
      json({ open: [], returned: [{ ...open[1], returned_at_ms: 6_000 }, after.returned[0]] })
    );
    await settle();
    resolvers[0]!(json(after));
    await settle();
    expect(target.querySelectorAll('[data-testid=hyrbrickor-returned-row]').length).toBe(2);
    expect(target.querySelectorAll('[data-testid=hyrbrickor-open-row]').length).toBe(0);
  });

  it('a failed return shows the error on that row and keeps the lists', async () => {
    handle = async (url, init) =>
      init?.method === 'PATCH' ? json({ error: 'sqlite_busy' }, 500) : json({ open, returned: [] });
    await show();
    (target.querySelector('[data-testid=hyrbrickor-row-return]') as HTMLButtonElement).click();
    await settle();
    const rows = target.querySelectorAll('[data-testid=hyrbrickor-open-row]');
    expect(rows.length).toBe(2);
    expect(rows[0]!.querySelector('[data-testid=hyrbrickor-row-error]')?.textContent).toContain(
      'Kunde inte markera brickan som återlämnad'
    );
    expect(rows[1]!.querySelector('[data-testid=hyrbrickor-row-error]')).toBeNull();
    expect(text()).not.toContain('sqlite_busy');
    expect(q('hyrbrickor-error')).toBeNull();
  });

  it('shows the empty state when there are no cards', async () => {
    handle = async () => json({ open: [], returned: [] });
    await show();
    expect(q('hyrbrickor-empty')?.textContent).toBe(
      'Inga hyrbrickor ute just nu. Hyrbrickor som lånas ut vid direktanmälan visas här tills de lämnas tillbaka.'
    );
  });

  describe('edit the contact', () => {
    let patches: Array<{ url: string; body: Record<string, unknown> }>;
    let patchStatus: number;
    const edit = (id: string): HTMLInputElement => q(`hyrbrickor-edit-${id}`) as HTMLInputElement;
    async function type(id: string, value: string): Promise<void> {
      edit(id).value = value;
      edit(id).dispatchEvent(new Event('input', { bubbles: true }));
      await settle();
    }
    async function click(id: string): Promise<void> {
      q(id)!.click();
      await settle();
    }
    async function showEditing(): Promise<void> {
      patches = [];
      patchStatus = 200;
      handle = async (url, init) => {
        if (init?.method === 'PATCH') {
          patches.push({ url, body: JSON.parse(String(init.body)) });
          return patchStatus === 200
            ? json({ ok: true })
            : json({ error: 'SQLITE_BUSY: db locked' }, patchStatus);
        }
        return json({ open, returned: [] });
      };
      await show();
      await click('hyrbrickor-row-edit');
    }

    it('Ändra opens the fields filled in; Spara sends them and shows the new contact', async () => {
      await showEditing();
      expect(edit('name').value).toBe('Anna Andersson');
      expect(edit('phone').value).toBe('0701234567');
      await type('name', 'Anna Berg');
      await type('phone', '+46 70 999 99 99');
      await click('hyrbrickor-edit-save');
      expect(patches).toHaveLength(1);
      expect(patches[0]!.url).toBe('/api/competitions/c1/hired-cards/7501853');
      expect(patches[0]!.body).toMatchObject({
        marked_at_ms: 1_000,
        name: 'Anna Berg',
        phone: '+46 70 999 99 99',
      });
      expect(q('hyrbrickor-edit-phone')).toBeNull();
      const row = target.querySelector('[data-testid=hyrbrickor-open-row]')!;
      expect(row.textContent).toContain('Anna Berg');
      expect(row.textContent).toContain('+46 70 999 99 99');
    });

    it('a card hired out again meanwhile: plain message, stale form dropped, list reloaded', async () => {
      await showEditing();
      patchStatus = 409;
      const loads = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
      await click('hyrbrickor-edit-save');
      expect(q('hyrbrickor-toast')?.textContent).toContain('ändrats av någon annan');
      expect(q('hyrbrickor-edit-phone')).toBeNull();
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
        loads + 1
      );
      expect(text()).not.toContain('SQLITE_BUSY');
    });

    it('while one row saves, Ändra on the others and Avbryt are off, so no edit is lost', async () => {
      await showEditing();
      let release: () => void = () => {};
      const inner = handle;
      handle = async (url, init) => {
        if (init?.method === 'PATCH') {
          await new Promise<void>((r) => (release = r));
          return json({ ok: true });
        }
        return inner(url, init);
      };
      await type('name', 'Anna Berg');
      q('hyrbrickor-edit-save')!.click();
      await settle();
      const others = [
        ...target.querySelectorAll<HTMLButtonElement>('[data-testid=hyrbrickor-row-edit]'),
      ];
      expect(others.length).toBeGreaterThan(0);
      expect(others.every((b) => b.disabled)).toBe(true);
      expect((q('hyrbrickor-edit-cancel') as HTMLButtonElement).disabled).toBe(true);
      release();
      await settle();
      expect(q('hyrbrickor-edit-name')).toBeNull();
      expect(text()).toContain('Anna Berg');
      // Now B can be opened and keeps its edits.
      target.querySelectorAll<HTMLButtonElement>('[data-testid=hyrbrickor-row-edit]')[1]!.click();
      await settle();
      expect(edit('name').value).toBe('Cia Carlsson');
    });

    it('Avbryt closes the fields without sending', async () => {
      await showEditing();
      await type('name', 'Någon annan');
      await click('hyrbrickor-edit-cancel');
      expect(q('hyrbrickor-edit-name')).toBeNull();
      expect(patches).toHaveLength(0);
      expect(text()).toContain('Anna Andersson');
    });

    it('a bad phone number is flagged on blur and blocks Spara', async () => {
      await showEditing();
      await type('phone', 'abc');
      edit('phone').dispatchEvent(new FocusEvent('blur'));
      await settle();
      const err = q('hyrbrickor-edit-phone-error')!;
      expect(err.textContent).toContain('telefonnummer');
      expect(edit('phone').getAttribute('aria-invalid')).toBe('true');
      expect(edit('phone').getAttribute('aria-describedby')).toBe(err.id);
      await click('hyrbrickor-edit-save');
      expect(patches).toHaveLength(0);
      await type('phone', '');
      expect(q('hyrbrickor-edit-phone-error')).toBeNull();
    });

    it('emptying both phone and e-mail blocks Spara with a plain message', async () => {
      await showEditing();
      await type('phone', '');
      await click('hyrbrickor-edit-save');
      expect(patches).toHaveLength(0);
      expect(q('hyrbrickor-edit-error')?.textContent).toContain('telefon eller e-post');
    });

    it('a failed save says so in plain words, never the server text', async () => {
      await showEditing();
      patchStatus = 500;
      await click('hyrbrickor-edit-save');
      expect(q('hyrbrickor-edit-error')?.textContent).toContain('Kunde inte spara');
      expect(text()).not.toContain('SQLITE_BUSY');
      expect(q('hyrbrickor-edit-phone')).not.toBeNull();
    });
  });

  describe('phone number', () => {
    const stubPointer = (coarse: boolean): void => {
      window.matchMedia = vi.fn((query: string) => ({
        matches: query === '(pointer: coarse)' && coarse,
      })) as unknown as typeof window.matchMedia;
    };
    const phone = (): HTMLElement => q('hyrbrickor-row-phone')!;

    it('is a tel: link on a touch screen', async () => {
      stubPointer(true);
      handle = async () => json({ open, returned: [] });
      await show();
      expect(phone().tagName).toBe('A');
      expect(phone().getAttribute('href')).toBe('tel:0701234567');
    });

    it('is plain text with a mouse', async () => {
      stubPointer(false);
      handle = async () => json({ open, returned: [] });
      await show();
      expect(phone().tagName).not.toBe('A');
      expect(phone().textContent).toBe('0701234567');
    });
  });
});
