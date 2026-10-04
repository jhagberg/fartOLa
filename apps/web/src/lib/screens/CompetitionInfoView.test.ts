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
