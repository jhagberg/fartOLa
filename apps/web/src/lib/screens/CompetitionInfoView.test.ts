// Authored for fartola. Not ported from upstream.
//
// Vitest coverage for the course-wide "Makulera kontroll" toggle in
// CompetitionInfoView (02.1-14 Task 5). Pure-helper style like
// SettingsView.test.ts: i18n keys + the client calls the toggle makes.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const KEYS = ['info.courses.voidControl', 'info.courses.unvoidControl'] as const;

describe('02.1-14 Task 5 — voided-control toggle', () => {
  it('sv + en have the toggle keys', async () => {
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    const en = (await import('../i18n/en.json')).default as Record<string, string>;
    for (const key of KEYS) {
      expect(sv[key], `missing sv key ${key}`).toBeTruthy();
      expect(en[key], `missing en key ${key}`).toBeTruthy();
    }
    expect(sv['info.courses.voidControl']).toBe('Makulera kontroll');
  });

  describe('client', () => {
    beforeEach(() => {
      global.fetch = vi.fn(
        async () => new Response(JSON.stringify({ control_codes: [32] }), { status: 200 })
      ) as unknown as typeof fetch;
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('listVoidedControls GETs /api/competitions/:id/voided-controls', async () => {
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
      const { listVoidedControls } = await import('../api/client.ts');
      expect(await listVoidedControls('c 1')).toEqual({ control_codes: [32] });
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/competitions/c%201/voided-controls');
    });

    it('setControlVoided POSTs to void and DELETEs to unvoid', async () => {
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
      const { setControlVoided } = await import('../api/client.ts');
      await setControlVoided('c1', 32, true);
      await setControlVoided('c1', 32, false);
      const calls = fetchMock.mock.calls.map((c) => [
        String(c[0]),
        (c[1] as RequestInit | undefined)?.method,
      ]);
      expect(calls).toEqual([
        ['/api/competitions/c1/voided-controls/32', 'POST'],
        ['/api/competitions/c1/voided-controls/32', 'DELETE'],
      ]);
    });
  });
});

// SOFT TR 4.21.1 / 4.21.2: the competition max time field (minutes) on the
// competition page, with the rule as its hint.
describe('competition max time (SOFT TR 4.21.1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('SOFT TR 4.21.1: the max time is entered in whole minutes for the whole competition', async () => {
    const { maxTimeMinutesToSec } = await import('../api/client.ts');
    expect(maxTimeMinutesToSec('150')).toBe(9000);
    expect(maxTimeMinutesToSec(' 90 ')).toBe(5400);
    expect(maxTimeMinutesToSec('')).toBeNull();
    expect(maxTimeMinutesToSec('0')).toBeUndefined();
    expect(maxTimeMinutesToSec('1:30')).toBeUndefined();
    expect(maxTimeMinutesToSec('abc')).toBeUndefined();
  });

  it('setCompetitionMaxTime PATCHes /api/competitions/:id/max-time', async () => {
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify({ max_time_sec: 9000 }), { status: 200 })
    ) as unknown as typeof fetch;
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const { setCompetitionMaxTime } = await import('../api/client.ts');
    await setCompetitionMaxTime('c1', 9000);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/competitions/c1/max-time');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ max_time_sec: 9000 });
  });

  it('the hint carries the rule: same for all classes, 2 × or 4 × the winning time', async () => {
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    const en = (await import('../i18n/en.json')).default as Record<string, string>;
    for (const key of ['info.maxTime.label', 'info.maxTime.hint', 'info.maxTime.locked']) {
      expect(sv[key], key).toBeTruthy();
      expect(en[key], key).toBeTruthy();
    }
    expect(sv['info.maxTime.hint']).toContain('densamma för alla klasser');
    expect(sv['info.maxTime.hint']).toMatch(/2 ×.*4 ×/);
  });
});
