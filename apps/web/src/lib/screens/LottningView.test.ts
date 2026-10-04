// Authored for fartola. Not ported from upstream.
//
// Vitest coverage for the per-class "Starttid räknas från" select in
// LottningView (02.1-14 Task 14, replaces Task 11's "Ej startstämpling"
// checkbox). Pure-helper style like CompetitionInfoView.test.ts: i18n keys
// + the client call the select makes.

import { describe, it, expect, vi, afterEach } from 'vitest';

describe('02.1-14 Task 14 — start method per class', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sv + en have the select keys; the old checkbox key is gone', async () => {
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    const en = (await import('../i18n/en.json')).default as Record<string, string>;
    expect(sv['lottning.startMethod']).toBe('Starttid räknas från');
    expect(sv['lottning.startMethod.auto']).toBe('Automatiskt');
    expect(sv['lottning.startMethod.start_time']).toBe('Starttid');
    expect(sv['lottning.startMethod.start_punch']).toBe('Startstämpling');
    for (const key of [
      'lottning.startMethod',
      'lottning.startMethod.auto',
      'lottning.startMethod.start_time',
      'lottning.startMethod.start_punch',
    ]) {
      expect(en[key], `missing en key ${key}`).toBeTruthy();
    }
    expect(sv['lottning.ignoreStartPunch']).toBeUndefined();
  });

  it('patchClass sends start_method to the class PATCH route', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const { patchClass } = await import('../api/client.ts');
    await patchClass('comp-1', 'cls-1', { start_method: 'start_punch' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/competitions/comp-1/classes/cls-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ start_method: 'start_punch' });
  });
});
