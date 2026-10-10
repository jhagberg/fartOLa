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

// Warm the i18n modules during collection. The first dynamic import inside a
// test pays the cold Vite transform (index.ts, tweaks store, i18next, both
// catalogs) and counts against the per-test timeout, which a machine under
// heavy load (all packages' tests in parallel) can blow past 10s. Importing
// here runs outside any test timeout; the imports in the tests then hit the
// module cache.
await import('../i18n/index.ts');
await import('../i18n/sv.json');
await import('../i18n/en.json');

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
    expect(sv['hyrbrickor.empty']).toBe('Inga öppna hyrbrickor');
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
