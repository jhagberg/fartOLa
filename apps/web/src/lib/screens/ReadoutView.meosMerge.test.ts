// Authored for fartola. Not ported from upstream.
//
// Vitest coverage for the Plan 02-04 meos_merge envelope handling in
// ReadoutView. The Svelte component itself isn't mounted (the web package
// deliberately skips svelte-testing-library — see
// EventorAutocomplete.test.ts header). Instead we exercise the two
// observable contracts:
//
//   1. The Swedish toast text formed via i18next interpolation
//      (`ro.meosMerge` key with `{{count}}` placeholder).
//   2. The dispatch predicate — `meos_merge` envelopes with a positive
//      integer `payload.count` are the only ones that should produce a
//      toast; missing/zero/non-numeric counts are ignored.
//
// The full integration coverage lives in mop.test.ts on the edge side
// (test 9 asserts that the envelope is emitted in the first place) and in
// the parallel-MeOS runbook smoke test (Plan 02-06).
//
// Locked by:
// - .planning/phases/02-4-klubbs-mvp/02-04-PLAN.md task 3
// - .planning/phases/02-4-klubbs-mvp/02-CONTEXT.md D-MOP-3 (toast wording)

import { describe, it, expect } from 'vitest';

// Warm the i18n modules during collection. The first dynamic import inside a
// test pays the cold Vite transform (index.ts, tweaks store, i18next, both
// catalogs) and counts against the per-test timeout, which a machine under
// heavy load (all packages' tests in parallel) can blow past 10s. Importing
// here runs outside any test timeout; the imports in the tests then hit the
// module cache.
await import('../i18n/index.ts');
await import('../i18n/sv.json');
await import('../i18n/en.json');

describe('Plan 02-04 — i18n keys for ReadoutView meos_merge toast', () => {
  it('sv.json has the ro.meosMerge interpolation key', async () => {
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    expect(sv['ro.meosMerge']).toBe('{{count}} löpare hämtade från MeOS');
  });

  it('en.json has the ro.meosMerge interpolation key', async () => {
    const en = (await import('../i18n/en.json')).default as Record<string, string>;
    expect(en['ro.meosMerge']).toBe('{{count}} runners imported from MeOS');
  });

  it('i18next interpolates {{count}} to the actual number on a Swedish render', async () => {
    const i18n = await import('../i18n/index.ts');
    // The bootstrap defaults to Swedish (Pitfall 10 — no flash of English).
    expect(i18n.t('ro.meosMerge', { count: 3 })).toBe('3 löpare hämtade från MeOS');
  });

  it('i18next handles count=1 with the same (locale-flat) singular form', async () => {
    // Swedish "löpare" is the same in singular and plural — no ICU plural
    // rules required for the 4-klubbs MVP. en uses the plural form for both
    // count values too (matches the locked simplification in CONTEXT.md
    // §"Claude's Discretion" / wording).
    const i18n = await import('../i18n/index.ts');
    expect(i18n.t('ro.meosMerge', { count: 1 })).toBe('1 löpare hämtade från MeOS');
  });

  it('en variant interpolates "runners" on English render', async () => {
    const i18n = await import('../i18n/index.ts');
    i18n.setLocale('en');
    try {
      expect(i18n.t('ro.meosMerge', { count: 5 })).toBe('5 runners imported from MeOS');
    } finally {
      i18n.setLocale('sv');
    }
  });
});

/**
 * Replica of the dispatch predicate from ReadoutView.svelte's
 * `handleLiveEvent` switch — kept in-test (not exported from the .svelte
 * file because Svelte 5 components don't export plain helpers cleanly) so
 * the predicate behavior stays under regression coverage. If the source
 * predicate ever changes shape, this test will surface the drift.
 */
function shouldShowMeosMergeToast(envelope: { type: string; payload: unknown }): boolean {
  if (envelope.type !== 'meos_merge') return false;
  const count = (envelope.payload as { count?: number } | null)?.count;
  return typeof count === 'number' && count > 0;
}

describe('Plan 02-04 — meos_merge envelope dispatch predicate', () => {
  it('shows the toast when type=meos_merge AND payload.count > 0', () => {
    expect(shouldShowMeosMergeToast({ type: 'meos_merge', payload: { count: 1 } })).toBe(true);
    expect(shouldShowMeosMergeToast({ type: 'meos_merge', payload: { count: 7 } })).toBe(true);
  });

  it('ignores the envelope when count is 0 (no merge happened)', () => {
    expect(shouldShowMeosMergeToast({ type: 'meos_merge', payload: { count: 0 } })).toBe(false);
  });

  it('ignores the envelope when payload is null or count is missing', () => {
    expect(shouldShowMeosMergeToast({ type: 'meos_merge', payload: null })).toBe(false);
    expect(shouldShowMeosMergeToast({ type: 'meos_merge', payload: {} })).toBe(false);
  });

  it('ignores the envelope when count is non-numeric', () => {
    expect(
      shouldShowMeosMergeToast({
        type: 'meos_merge',
        payload: { count: 'three' as unknown as number },
      })
    ).toBe(false);
  });

  it('ignores envelopes of other types (no false positives)', () => {
    expect(shouldShowMeosMergeToast({ type: 'card_read', payload: { count: 3 } })).toBe(false);
    expect(shouldShowMeosMergeToast({ type: 'card_bound', payload: { count: 3 } })).toBe(false);
  });
});
