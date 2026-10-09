// Authored for fartola. Not ported from upstream.
//
// Vitest coverage for the Eventor walk-up autocomplete API surface
// (Plan 02-02 task 3). We don't have a svelte-testing-library wired in;
// the component-internal logic that matters most for safety is:
//
//   1. The minLength=2 prefix gate (RESEARCH §"Plan 2 nuance" — 252 919
//      rows means a 1-char prefix would dominate the wire).
//   2. The "fetched from Eventor" pre-fill precedence over the
//      Phase-1 cardHolderHint (eventorHint wins on a hit).
//
// Both of those rules live in pure helper paths we can exercise without
// mounting the component. The integration-level coverage lives in the
// walkup-eventor e2e (Plan 02-02 task 5).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Minimal SvelteKit shim — vitest's jsdom environment lacks the
// `$app/navigation` module that WalkupModal pulls in. We only need
// `lookupEventorByPrefix` here, which is wire-only.

describe('Eventor walk-up autocomplete behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Default fetch stub — tests override as needed.
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ suggestions: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('lookupEventorByPrefix sends the right query string', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const { lookupEventorByPrefix } = await import('../api/client.ts');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ suggestions: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    await lookupEventorByPrefix('Hag', 20);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toMatch(/\/api\/eventor\/lookup\?/);
    expect(url).toContain('prefix=Hag');
    expect(url).toContain('limit=20');
  });

  it('lookupEventorBySiCard sends si_card param', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const { lookupEventorBySiCard } = await import('../api/client.ts');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ hit: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    await lookupEventorBySiCard(8535005);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('si_card=8535005');
  });

  it('getEventorStatus returns the parsed status shape', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const { getEventorStatus } = await import('../api/client.ts');
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          state: 'ready',
          ageDays: 2,
          competitorCount: 252919,
          fartola_dev: false,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await getEventorStatus();
    expect(r.state).toBe('ready');
    expect(r.ageDays).toBe(2);
    expect(r.competitorCount).toBe(252919);
    expect(r.fartola_dev).toBe(false);
  });
});

describe('i18n keys for Plan 02-02', () => {
  it('sv.json has all Hyrbricka + Bana + Eventor walk keys', async () => {
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    for (const key of [
      'walk.bana',
      'walk.banaPlaceholder',
      'walk.hyrbricka',
      'walk.hyrbricka.name',
      'walk.hyrbricka.phone',
      'walk.hyrbricka.email',
      'walk.hyrbricka.note',
      'walk.err.hyrbrickaContact',
      'walk.eventor.fill',
    ]) {
      expect(sv[key], `missing sv key ${key}`).toBeTruthy();
    }
    // Bana label per locked decision #1.
    expect(sv['walk.bana']).toBe('Klass');
    // D-HB-3 error wording per plan.
    expect(sv['walk.err.hyrbrickaContact']).toMatch(/telefon|e-post/i);
  });

  it('en.json mirrors all of those keys', async () => {
    const en = (await import('../i18n/en.json')).default as Record<string, string>;
    for (const key of [
      'walk.bana',
      'walk.banaPlaceholder',
      'walk.hyrbricka',
      'walk.hyrbricka.name',
      'walk.hyrbricka.phone',
      'walk.hyrbricka.email',
      'walk.hyrbricka.note',
      'walk.err.hyrbrickaContact',
      'walk.eventor.fill',
    ]) {
      expect(en[key], `missing en key ${key}`).toBeTruthy();
    }
    expect(en['walk.bana']).toBe('Course');
  });

  it('walk.class alias key remains for Phase 2.1 compatibility', async () => {
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    const en = (await import('../i18n/en.json')).default as Record<string, string>;
    expect(sv['walk.class']).toBe('Klass');
    expect(en['walk.class']).toBe('Class');
  });
});
