// Authored for fartola. Not ported from upstream.
//
// Vitest coverage for the "Saknade starttider" panel (02.1-14 Task 15).
// Components are not mounted in this package's tests; the panel's logic
// lives in missing-starts.ts: the header numbers, the resulting time for an
// edited start, and the batch apply call.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { clockToEpochMs, defaultClockOffsetMin } from '@fartola/shared-types';
import {
  applyMissingStartRows,
  initialStartText,
  resultingTimeMs,
  statsLabel,
  type MissingStartItem,
} from './missing-starts.ts';

const OFFSET = 120; // the competition clock of 2026-10-03 (CEST)
const at = (sec: number, day = '2026-10-03', offset = OFFSET): number =>
  clockToEpochMs(day, sec, offset);
const item = (over: Partial<MissingStartItem> = {}): MissingStartItem => ({
  competitor_id: 'x',
  name: 'Xenia',
  club: null,
  class_id: 'cls',
  class_name: 'H21',
  card_number: 1,
  status: 'OK',
  check_ms: at(10 * 3600 + 19 * 60 + 37),
  suggested_start_ms: at(10 * 3600 + 21 * 60 + 31),
  finish_ms: at(10 * 3600 + 55 * 60),
  ...over,
});

describe('missing starts panel (02.1-14 Task 15)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('header: median, mean, n — or the 1:54 default under 10 runners', () => {
    expect(
      statsLabel({ n: 213, median_ms: 114_000, mean_ms: 127_000, offset_ms: 114_000 })
    ).toEqual({ key: 'ms.stats', vars: { median: '1:54', mean: '2:07', n: 213 } });
    expect(statsLabel({ n: 3, median_ms: 90_000, mean_ms: 95_000, offset_ms: 114_000 })).toEqual({
      key: 'ms.statsFallback',
      vars: { offset: '1:54', n: 3 },
    });
  });

  it('the start field starts at the suggestion, or empty without one', () => {
    expect(initialStartText(item(), OFFSET)).toBe('10:21:31');
    expect(initialStartText(item({ suggested_start_ms: null, check_ms: null }), OFFSET)).toBe('');
  });

  it('resulting time = finish − edited start; null for an invalid or later start', () => {
    expect(resultingTimeMs(item(), '10:21:31', OFFSET)).toBe((33 * 60 + 29) * 1000);
    expect(resultingTimeMs(item(), '10:25', OFFSET)).toBe(30 * 60 * 1000);
    expect(resultingTimeMs(item(), 'xx', OFFSET)).toBeNull();
    expect(resultingTimeMs(item(), '11:00', OFFSET)).toBeNull();
  });

  it('"Sätt alla" POSTs every row in one batch', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ updated: 2 }), { status: 200 })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const res = await applyMissingStartRows(
      'comp-1',
      [
        { item: item(), text: '10:21:31' },
        { item: item({ competitor_id: 'y' }), text: '10:22' },
      ],
      OFFSET
    );
    expect(res).toEqual({ ok: true, updated: 2 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/competitions/comp-1/missing-starts/apply');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      items: [
        { competitor_id: 'x', start_time_ms: at(10 * 3600 + 21 * 60 + 31) },
        { competitor_id: 'y', start_time_ms: at(10 * 3600 + 22 * 60) },
      ],
    });
  });

  it('an invalid time anywhere sends nothing and names the rows', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const res = await applyMissingStartRows(
      'comp-1',
      [
        { item: item(), text: '10:21:31' },
        { item: item({ competitor_id: 'y' }), text: '' },
      ],
      OFFSET
    );
    expect(res).toEqual({ ok: false, invalid: ['y'], error: 'invalid' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Codex third review of #51, finding 4: the preview and the saved start
  // must match the backend, which times on the competition clock (one fixed
  // offset per competition, ADR-0012).
  it('DST days: 01:50 → 03:10 previews 80 minutes and saves 03:00 as one instant', async () => {
    for (const day of ['2026-03-29', '2026-10-25']) {
      const offset = defaultClockOffsetMin(day);
      const dst = item({
        suggested_start_ms: at(3600 + 50 * 60, day, offset),
        finish_ms: at(3 * 3600 + 10 * 60, day, offset),
      });
      expect(resultingTimeMs(dst, initialStartText(dst, offset), offset)).toBe(80 * 60 * 1000);
      expect(resultingTimeMs(dst, '03:00', offset)).toBe(10 * 60 * 1000);
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify({ updated: 1 }), { status: 200 })
      );
      global.fetch = fetchMock as unknown as typeof fetch;
      await applyMissingStartRows('comp-1', [{ item: dst, text: '03:00' }], offset);
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({
        items: [{ competitor_id: 'x', start_time_ms: at(3 * 3600, day, offset) }],
      });
    }
  });

  it('no suggestion: 23:50 against a finish at 00:10 is the day before', async () => {
    const late = item({
      check_ms: null,
      suggested_start_ms: null,
      finish_ms: at(10 * 60, '2026-10-04'),
    });
    expect(resultingTimeMs(late, '23:50', OFFSET)).toBe(20 * 60 * 1000);
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ updated: 1 }), { status: 200 })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    await applyMissingStartRows('comp-1', [{ item: late, text: '23:50' }], OFFSET);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      items: [{ competitor_id: 'x', start_time_ms: at(23 * 3600 + 50 * 60) }],
    });
  });

  it('a start after the finish is rejected and not sent', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const res = await applyMissingStartRows('comp-1', [{ item: item(), text: '11:00' }], OFFSET);
    expect(res).toEqual({ ok: false, invalid: ['x'], error: 'after_finish' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('listMissingStarts GETs the listing', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            n: 0,
            median_ms: null,
            mean_ms: null,
            offset_ms: 114_000,
            clock_offset_min: 120,
            items: [],
          }),
          { status: 200 }
        )
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const { listMissingStarts } = await import('../api/client.ts');
    expect((await listMissingStarts('c 1')).items).toEqual([]);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      '/api/competitions/c%201/missing-starts'
    );
  });

  it('sv + en have the panel keys', async () => {
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    const en = (await import('../i18n/en.json')).default as Record<string, string>;
    expect(sv['ms.title']).toBe('Saknade starttider');
    expect(sv['ms.setAll']).toBe('Sätt alla');
    expect(sv['ms.stats']).toBe('median {{median}} (medel {{mean}}, n={{n}})');
    expect(sv['ms.startAfterFinish']).toBe('Starttiden är efter målgången.');
    for (const key of [
      'ms.title',
      'ms.stats',
      'ms.statsFallback',
      'ms.name',
      'ms.class',
      'ms.check',
      'ms.suggested',
      'ms.result',
      'ms.set',
      'ms.setAll',
      'ms.startAfterFinish',
    ]) {
      expect(sv[key], `missing sv key ${key}`).toBeTruthy();
      expect(en[key], `missing en key ${key}`).toBeTruthy();
    }
  });
});
