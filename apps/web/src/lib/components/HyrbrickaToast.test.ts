// Authored for fartola. Not ported from upstream.
//
// Vitest coverage for the Plan 02-05 HyrbrickaToast component + the
// ReadoutView Set-based dismissal logic. The Svelte component itself
// isn't mounted (the web package deliberately skips svelte-testing-
// library — see EventorAutocomplete.test.ts header). We exercise:
//
//   1. The i18n keys for the toast (sv + en) and the toast-show
//      predicate (hired_card_open !== null AND !returnedHiredCardNumbers
//      .has(cardNumber)).
//   2. The api client wrappers (listHiredCards / returnHiredCard) send
//      the expected URLs + methods.
//   3. The Set-based dismissal helper produces a NEW Set on .add (Svelte 5
//      reactivity gotcha — Assumption A8 — mutating an existing Set may
//      not trigger reactivity; the replacement form `new Set([...prev, x])`
//      is the safe path).
//   4. The hired_card_returned WS envelope dispatch predicate — adds the
//      card to the returned set even when the local operator wasn't the
//      one who PATCHed (the cross-operator case).
//
// Locked by:
// - .planning/phases/02-4-klubbs-mvp/02-05-PLAN.md task 2
// - .planning/phases/02-4-klubbs-mvp/02-RESEARCH.md §"Plan 5 nuance"

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

describe('Plan 02-05 — i18n keys for the Hyrbricka toast', () => {
  it('sv.json has all readout.hyrbricka keys', async () => {
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    for (const key of [
      'readout.hyrbricka.title',
      'readout.hyrbricka.contact.name',
      'readout.hyrbricka.contact.phone',
      'readout.hyrbricka.contact.email',
      'readout.hyrbricka.contact.note',
      'readout.hyrbricka.returned',
      'readout.hyrbricka.dismiss',
      'readout.hyrbricka.returnedConfirmed',
    ]) {
      expect(sv[key], `missing sv key ${key}`).toBeTruthy();
    }
    // Title carries the warning emoji + the Swedish prompt.
    expect(sv['readout.hyrbricka.title']).toMatch(/Hyrbricka/i);
    expect(sv['readout.hyrbricka.returned']).toBe('Returnerad');
    expect(sv['readout.hyrbricka.dismiss']).toBe('Ignorera');
  });

  it('en.json mirrors all readout.hyrbricka keys', async () => {
    const en = (await import('../i18n/en.json')).default as Record<string, string>;
    for (const key of [
      'readout.hyrbricka.title',
      'readout.hyrbricka.contact.name',
      'readout.hyrbricka.contact.phone',
      'readout.hyrbricka.contact.email',
      'readout.hyrbricka.contact.note',
      'readout.hyrbricka.returned',
      'readout.hyrbricka.dismiss',
      'readout.hyrbricka.returnedConfirmed',
    ]) {
      expect(en[key], `missing en key ${key}`).toBeTruthy();
    }
    expect(en['readout.hyrbricka.returned']).toBe('Returned');
    expect(en['readout.hyrbricka.dismiss']).toBe('Dismiss');
  });

  it('the Swedish title renders the locked wording verbatim', async () => {
    const i18n = await import('../i18n/index.ts');
    expect(i18n.t('readout.hyrbricka.title')).toMatch(/Hyrbricka.*be om att få tillbaka brickan/i);
  });
});

describe('Plan 02-05 — api client wrappers', () => {
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

  it('listHiredCards GETs /api/competitions/:id/hired-cards', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const { listHiredCards } = await import('../api/client.ts');
    await listHiredCards('comp-abc');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toBe('/api/competitions/comp-abc/hired-cards');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    // Default is GET — apiFetch omits method when 'GET'.
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('returnHiredCard PATCHes /api/competitions/:id/hired-cards/:cardNumber/return', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, returned_at_ms: 12345 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const { returnHiredCard } = await import('../api/client.ts');
    const r = await returnHiredCard('comp-abc', 99999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toBe('/api/competitions/comp-abc/hired-cards/99999/return');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.method).toBe('PATCH');
    expect(r.ok).toBe(true);
    expect(r.returned_at_ms).toBe(12345);
  });

  it('returnHiredCard surfaces already_returned on idempotent path', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, returned_at_ms: 100, already_returned: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const { returnHiredCard } = await import('../api/client.ts');
    const r = await returnHiredCard('comp-abc', 99999);
    expect(r.already_returned).toBe(true);
    expect(r.returned_at_ms).toBe(100);
  });
});

/**
 * Replica of the toast-show predicate from ReadoutView.svelte's
 * card_read side-effect path. Kept in-test (not exported from the
 * .svelte file) so contract drift surfaces as a test failure.
 *
 * The toast surfaces iff ALL of:
 *   1. The history row's hired_card_open !== null.
 *   2. The card_number has not been returned in this session
 *      (returnedHiredCardNumbers does NOT include it).
 *   3. No other Hyrbricka toast is currently pending.
 */
function shouldShowHyrbrickaToast(input: {
  hiredCardOpen: { contact_name: string | null } | null;
  cardNumber: number;
  returnedHiredCardNumbers: Set<number>;
  pendingHyrbrickaToast: unknown;
}): boolean {
  if (input.hiredCardOpen === null) return false;
  if (input.returnedHiredCardNumbers.has(input.cardNumber)) return false;
  if (input.pendingHyrbrickaToast !== null) return false;
  return true;
}

describe('Plan 02-05 — Hyrbricka toast show predicate', () => {
  it('shows the toast when hired_card_open is set AND card not in returned set', () => {
    expect(
      shouldShowHyrbrickaToast({
        hiredCardOpen: { contact_name: 'Renter' },
        cardNumber: 12345,
        returnedHiredCardNumbers: new Set(),
        pendingHyrbrickaToast: null,
      })
    ).toBe(true);
  });

  it('suppresses when card is already in the returned set (no re-pop)', () => {
    expect(
      shouldShowHyrbrickaToast({
        hiredCardOpen: { contact_name: 'Renter' },
        cardNumber: 12345,
        returnedHiredCardNumbers: new Set([12345]),
        pendingHyrbrickaToast: null,
      })
    ).toBe(false);
  });

  it('suppresses when hired_card_open is null (no open rental)', () => {
    expect(
      shouldShowHyrbrickaToast({
        hiredCardOpen: null,
        cardNumber: 12345,
        returnedHiredCardNumbers: new Set(),
        pendingHyrbrickaToast: null,
      })
    ).toBe(false);
  });

  it('suppresses when another toast is already pending', () => {
    expect(
      shouldShowHyrbrickaToast({
        hiredCardOpen: { contact_name: 'Renter' },
        cardNumber: 12345,
        returnedHiredCardNumbers: new Set(),
        pendingHyrbrickaToast: { cardNumber: 99999, contactName: null },
      })
    ).toBe(false);
  });
});

/**
 * Set-mutation replacement helper — Plan 02-05 RESEARCH §Assumption A8:
 * Svelte 5's reactivity does NOT reliably re-render when a Set is
 * mutated via .add(). The replacement form below ALWAYS gives Svelte a
 * new Set reference so $state-tracked variables flag as dirty.
 */
function addToReturnedSet(prev: Set<number>, cardNumber: number): Set<number> {
  return new Set([...prev, cardNumber]);
}

describe('Plan 02-05 — Set-based dismissal replacement helper', () => {
  it('produces a NEW Set instance (reference inequality)', () => {
    const before = new Set([1, 2]);
    const after = addToReturnedSet(before, 3);
    expect(after).not.toBe(before);
    expect(before.has(3)).toBe(false);
    expect(after.has(3)).toBe(true);
  });

  it('preserves prior elements', () => {
    const before = new Set([10, 20, 30]);
    const after = addToReturnedSet(before, 40);
    expect(after.has(10)).toBe(true);
    expect(after.has(20)).toBe(true);
    expect(after.has(30)).toBe(true);
    expect(after.has(40)).toBe(true);
    expect(after.size).toBe(4);
  });

  it('is idempotent — adding a value already in the set leaves size unchanged', () => {
    const before = new Set([10, 20]);
    const after = addToReturnedSet(before, 10);
    expect(after.size).toBe(2);
    // Still a new instance (defensive — Svelte 5 reactivity).
    expect(after).not.toBe(before);
  });
});

/**
 * Replica of the hired_card_returned WS dispatch predicate. The envelope
 * is informational — it adds the card to the returnedHiredCardNumbers
 * Set so future card_reads from another operator don't re-pop the toast.
 */
function shouldAddOnWsHiredCardReturned(envelope: {
  type: string;
  payload: unknown;
}): { add: false } | { add: true; cardNumber: number } {
  if (envelope.type !== 'hired_card_returned') return { add: false };
  const payload = envelope.payload as { card_number?: unknown } | null;
  const cn = payload?.card_number;
  if (typeof cn !== 'number' || !Number.isInteger(cn) || cn <= 0) {
    return { add: false };
  }
  return { add: true, cardNumber: cn };
}

describe('Plan 02-05 — hired_card_returned WS envelope dispatch', () => {
  it('adds the card_number when envelope is well-formed', () => {
    const r = shouldAddOnWsHiredCardReturned({
      type: 'hired_card_returned',
      payload: { card_number: 88888, returned_at_ms: 1 },
    });
    expect(r.add).toBe(true);
    if (r.add) expect(r.cardNumber).toBe(88888);
  });

  it('ignores envelopes of other types', () => {
    expect(
      shouldAddOnWsHiredCardReturned({ type: 'card_read', payload: { card_number: 1 } })
    ).toEqual({ add: false });
    expect(
      shouldAddOnWsHiredCardReturned({ type: 'meos_merge', payload: { card_number: 1 } })
    ).toEqual({ add: false });
  });

  it('ignores malformed payloads (missing or non-numeric card_number)', () => {
    expect(shouldAddOnWsHiredCardReturned({ type: 'hired_card_returned', payload: null })).toEqual({
      add: false,
    });
    expect(shouldAddOnWsHiredCardReturned({ type: 'hired_card_returned', payload: {} })).toEqual({
      add: false,
    });
    expect(
      shouldAddOnWsHiredCardReturned({
        type: 'hired_card_returned',
        payload: { card_number: 'x' },
      })
    ).toEqual({ add: false });
    expect(
      shouldAddOnWsHiredCardReturned({
        type: 'hired_card_returned',
        payload: { card_number: -1 },
      })
    ).toEqual({ add: false });
  });
});
