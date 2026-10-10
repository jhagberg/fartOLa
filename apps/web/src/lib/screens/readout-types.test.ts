// Authored for fartola. Not ported from upstream.
//
// Vitest coverage for the readout view's helpers. Its running time is the
// backend's (the /readout row's elapsed_time_ms); the web no longer
// rebuilds it from the card (readElapsedMs, removed with the fixed-offset
// competition clock, ADR-0017).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { clockToEpochMs, defaultClockOffsetMin, softStatus } from '@fartola/shared-types';
import {
  rawPunchesToReceipt,
  classifyPunches,
  classBehind,
  toReceiptRead,
  softStatusLabel,
  resultRowCells,
  missingStartHint,
  startWarning,
  setStartFromInput,
  type ReadoutHistoryRow,
} from './readout-types.ts';

const row = (over: Partial<ReadoutHistoryRow>): ReadoutHistoryRow =>
  ({
    card_type: 'SIAC',
    manual_finish_ms: null,
    manual_finish_reason: null,
    manual_punches: [],
    punches: [{ code: 31, seconds_in_half_day: 10 * 3600 + 120, half_day: 0 }],
    start_seconds_in_half_day: 10 * 3600 + 60,
    start_half_day: 0,
    finish_seconds_in_half_day: 10 * 3600 + 45 * 60,
    finish_half_day: 0,
    ...over,
  }) as ReadoutHistoryRow;

const OFFSET = 120; // the competition clock of 2026-10-03 (CEST)
const at = (sec: number, day = '2026-10-03', offset = OFFSET): number =>
  clockToEpochMs(day, sec, offset);

// 02.1-14 Task 9: a class without timing shows no running or split time on
// the readout receipt (MeOS readout shows "Godkänd" instead of a time).
describe('toReceiptRead — class without timing', () => {
  const input = {
    row: row({ card_number: 1, competitor_name: 'Anna', status: 'OK', event_time_ms: 0 }),
    className: 'Inskolning',
    classId: 'ins',
    club: null,
    competitionName: 'X',
    competitionDate: '2026-10-04',
    elapsedMs: 45 * 60 * 1000,
  };

  it('timed class keeps the times', () => {
    const read = toReceiptRead(input);
    expect(read.elapsed).toBe('45:00');
    expect(read.punches[0]!.time).not.toBe('—');
  });

  it('untimed class → no elapsed, no split or cumulative times', () => {
    const read = toReceiptRead({ ...input, noTiming: true });
    expect(read.elapsed).toBe('—');
    expect(read.punches.length).toBeGreaterThan(0);
    for (const p of read.punches) expect([p.split, p.time]).toEqual(['—', '—']);
  });
});

// The results screen and the receipts are published: they use SOFT's names,
// the operator's own views keep Felstämplad, Utgått … (status.*).
describe('SOFT status names on published surfaces', () => {
  it('SOFT TA till TR 7.8.2: results screen labels — "Ej godkänd", "Diskad", "Ej start", "Ej utläst"', () => {
    const label = (s: Parameters<typeof softStatus>[0]): string => softStatusLabel(softStatus(s));
    for (const s of ['MP', 'DNF', 'MAX'] as const) expect(label(s)).toBe('Ej godkänd');
    expect(label('DQ')).toBe('Diskad');
    expect(label('DNS')).toBe('Ej start');
    expect(label('PEND')).toBe('Ej utläst');
  });

  it("SOFT TA till TR 7.8.2: results-table rows — a status row shows SOFT's name and no time or place", () => {
    const cells = (status: Parameters<typeof softStatus>[0], noTiming = false) =>
      resultRowCells({
        soft_status: softStatus(status, { noTiming }),
        place: status === 'OK' && !noTiming ? 1 : null,
        elapsed_time_ms: noTiming ? null : 900_000,
      });
    expect(cells('OK')).toEqual({ place: '1', time: '15:00', label: 'Godkänd' });
    for (const s of ['MP', 'DNF', 'MAX'] as const)
      expect(cells(s)).toEqual({ place: '—', time: '—', label: 'Ej godkänd' });
    expect(cells('DQ')).toEqual({ place: '—', time: '—', label: 'Diskad' });
    expect(cells('DNS')).toEqual({ place: '—', time: '—', label: 'Ej start' });
    expect(cells('PEND')).toEqual({ place: '—', time: '—', label: 'Ej utläst' });
    expect(cells('OK', true)).toEqual({ place: '—', time: '—', label: 'Deltagit' });
  });

  it('SOFT TA till TR 7.8.2: the receipt preview prints the SOFT name, "Deltagit" when untimed (TR 4.21.3)', () => {
    const base = {
      className: 'H21',
      classId: 'h21',
      club: null,
      competitionName: 'X',
      competitionDate: '2026-10-04',
    };
    const mp = toReceiptRead({
      ...base,
      row: row({ card_number: 1, status: 'MP', event_time_ms: 0 }),
    });
    expect(mp.statusLabel).toBe('Ej godkänd');
    const ok = toReceiptRead({
      ...base,
      row: row({ card_number: 1, status: 'OK', event_time_ms: 0 }),
      noTiming: true,
    });
    expect(ok.statusLabel).toBe('Deltagit');
  });
});

// 02.1-14 Task 13: "Saknar starttid" on the read-out card. The web package
// does not mount Svelte components in tests (see EventorAutocomplete.test.ts),
// so the card's logic lives in these helpers: the warning text, the edited
// time field, and the PATCH start-time call LatestReadCard triggers.
describe('missing start (02.1-14 Task 13)', () => {
  const check = at(10 * 3600 + 19 * 60 + 37);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hint: check time + median → suggested start', () => {
    const r = row({
      missing_start: true,
      suggested_start_ms: check + 114_000,
      suggested_start_offset_ms: 114_000,
    });
    expect(missingStartHint(r, OFFSET)).toEqual({
      check: '10:19:37',
      offset: '1:54',
      suggested: '10:21:31',
    });
  });

  // Codex third review of #51, finding 4: the hint is the card's clock, also
  // in the hour skipped when DST starts (stations on +01:00 here).
  it('hint: station times in the skipped spring hour stay as they are', () => {
    const r = row({
      missing_start: true,
      suggested_start_ms: Date.parse('2026-03-29T01:00:54Z'),
      suggested_start_offset_ms: 114_000,
    });
    expect(missingStartHint(r, 60)).toEqual({
      check: '01:59:00',
      offset: '1:54',
      suggested: '02:00:54',
    });
  });

  it('hint: none without a suggestion or without a missing start', () => {
    const noCheck = row({
      missing_start: true,
      suggested_start_ms: null,
      suggested_start_offset_ms: null,
    });
    expect(missingStartHint(noCheck, OFFSET)).toBeNull();
    expect(
      missingStartHint(
        row({
          missing_start: false,
          suggested_start_ms: check,
          suggested_start_offset_ms: 0,
        }),
        OFFSET
      )
    ).toBeNull();
  });

  const patchBody = async (
    text: string,
    finishMs: number,
    offset = OFFSET
  ): Promise<{ result: string; body: unknown }> => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 'r1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const result = await setStartFromInput('comp-1', 'r1', text, finishMs, offset);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit] | undefined;
    if (call !== undefined) {
      expect(call[0]).toBe('/api/competitions/comp-1/competitors/r1/start-time');
      expect(call[1].method).toBe('PATCH');
    }
    return { result, body: call === undefined ? null : JSON.parse(call[1].body as string) };
  };

  const finish1055 = at(10 * 3600 + 55 * 60);

  it('"Sätt starttid" PATCHes the edited start (competition clock) before the finish', async () => {
    expect(await patchBody('10:21:40', finish1055)).toEqual({
      result: 'ok',
      body: { start_time_ms: at(10 * 3600 + 21 * 60 + 40) },
    });
    expect((await patchBody(' 10:22 ', finish1055)).body).toEqual({
      start_time_ms: at(10 * 3600 + 22 * 60),
    });
  });

  it('DST days: 03:00 against a finish at 03:10 is saved as 03:00', async () => {
    for (const day of ['2026-03-29', '2026-10-25']) {
      const offset = defaultClockOffsetMin(day);
      expect((await patchBody('03:00', at(3 * 3600 + 10 * 60, day, offset), offset)).body).toEqual({
        start_time_ms: at(3 * 3600, day, offset),
      });
    }
  });

  it('23:50 against a finish at 00:10 is saved on the day before', async () => {
    expect((await patchBody('23:50', at(10 * 60, '2026-10-04'))).body).toEqual({
      start_time_ms: at(23 * 3600 + 50 * 60),
    });
  });

  it('an invalid time, or a start after the finish, is not sent', async () => {
    for (const text of ['25:00', '10:61:00', 'abc', '']) {
      expect(await patchBody(text, finish1055)).toEqual({
        result: 'invalid',
        body: null,
      });
    }
    expect(await patchBody('11:00', finish1055)).toEqual({
      result: 'after_finish',
      body: null,
    });
  });

  it('sv + en have the read-out card keys', async () => {
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    const en = (await import('../i18n/en.json')).default as Record<string, string>;
    expect(sv['ro.missingStart']).toBe('Saknar starttid');
    expect(sv['ro.missingStart.set']).toBe('Sätt starttid');
    for (const key of ['ro.missingStart', 'ro.missingStart.hint', 'ro.missingStart.set']) {
      expect(en[key], `missing en key ${key}`).toBeTruthy();
    }
    expect(sv['ro.missingStart.hint']).toContain('{{check}}');
  });
});

// 02.1-14 Task 14: late / early start punch against the start time, a
// warning for the jury on the read-out card (SOFT TR 4.18.9 (2026-07-01)).
describe('startWarning (02.1-14 Task 14)', () => {
  it('late start → "Sen start +3:12"', () => {
    expect(startWarning(row({ late_start_ms: 192_000, early_start_ms: null }))).toEqual({
      key: 'ro.lateStart',
      diff: '3:12',
    });
  });

  it('early start → "Tjuvstart? −0:05"', () => {
    expect(startWarning(row({ late_start_ms: null, early_start_ms: 5_000 }))).toEqual({
      key: 'ro.earlyStart',
      diff: '0:05',
    });
  });

  it('none → null', () => {
    expect(startWarning(row({ late_start_ms: null, early_start_ms: null }))).toBeNull();
  });

  it('sv + en have the warning keys', async () => {
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    const en = (await import('../i18n/en.json')).default as Record<string, string>;
    expect(sv['ro.lateStart']).toBe('Sen start +{{diff}}');
    expect(sv['ro.earlyStart']).toBe('Tjuvstart? −{{diff}}');
    for (const key of ['ro.lateStart', 'ro.earlyStart']) {
      expect(en[key], `missing en key ${key}`).toBeTruthy();
    }
  });
});

// Display labels: OK / struken / extra / fel ordn. (synthetic data).
describe('classifyPunches', () => {
  const at = (code: number, sec: number) => ({
    code,
    seconds_in_half_day: 36_000 + sec,
    half_day: 0,
  });
  const classify = (
    punched: number[],
    expected: number[],
    voided: number[] = [],
    manual: number[] = []
  ) => {
    const raw = punched.map((c, i) => at(c, 60 * (i + 1)));
    return classifyPunches(
      rawPunchesToReceipt(raw, 36_000, 36_900, expected),
      expected,
      voided,
      manual
    );
  };
  const kinds = (p: { kind?: string }[]) => p.map((x) => x.kind ?? 'ok');

  it('plain run: every tile OK, finish last', () => {
    const out = classify([31, 32, 33], [31, 32, 33]);
    expect(kinds(out)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(out.every((p) => p.ok !== false)).toBe(true);
  });

  it('a voided control keeps its course position as struck and is not missing', () => {
    const out = classify([31, 33], [31, 32, 33], [32]);
    expect(out.map((p) => p.code)).toEqual([31, 32, 33, 'F']);
    expect(kinds(out)).toEqual(['ok', 'struck', 'ok', 'ok']);
    expect(out[1]?.ok).toBe(true);
  });

  it('a voided control that was punched anyway is struck, not extra', () => {
    const out = classify([31, 32, 33], [31, 32, 33], [32]);
    expect(kinds(out)).toEqual(['ok', 'struck', 'ok', 'ok']);
  });

  it('a punch not on the course is extra', () => {
    const out = classify([31, 99, 32], [31, 32]);
    expect(kinds(out)).toEqual(['ok', 'ok', 'extra', 'ok']);
    expect(out[2]?.code).toBe(99);
  });

  it('a course control punched out of order is fel ordn.; its course slot stays a miss', () => {
    // course 31,32,33; punched 31,33,32. The subsequence match (as the edge's
    // matchCourse) takes 32 after 33, so 33 is the one out of order.
    const out = classify([31, 33, 32], [31, 32, 33]);
    expect(out[2]).toMatchObject({ code: 33, ok: false });
    expect(out[2]?.kind).toBeUndefined();
    expect(out[3]).toMatchObject({ code: 33, kind: 'order' });
    expect(kinds(out)).toEqual(['ok', 'ok', 'ok', 'order', 'ok']);
  });

  it('a genuinely missing control stays a miss (ok: false, no kind)', () => {
    const out = classify([31, 33], [31, 32, 33]);
    expect(out[1]).toMatchObject({ code: 32, ok: false });
    expect(out[1]?.kind).toBeUndefined();
  });

  it('a missed control punched by hand is OK and manual; numbering is unchanged', () => {
    const out = classify([31, 33], [31, 32, 33, 32], [], [32]);
    expect(out[1]).toMatchObject({ code: 32, ok: true, manual: true });
    expect(out[1]?.kind).toBeUndefined();
    // Only the first missed 32 is taken; the second stays missing.
    expect(out[3]).toMatchObject({ code: 32, ok: false });
    expect(out[3]?.manual).toBeUndefined();
  });

  it('without a course the tiles are returned unchanged', () => {
    const tiles = rawPunchesToReceipt([at(31, 60)], 36_000, null, []);
    expect(classifyPunches(tiles, [])).toBe(tiles);
  });
});

describe('toReceiptRead untimed', () => {
  const base = {
    row: row({}),
    className: 'D21',
    classId: 'c',
    club: null,
    competitionName: 'T',
    competitionDate: '2026-10-03',
  };
  it('flags a class without timing', () => {
    expect(toReceiptRead({ ...base, noTiming: true }).untimed).toBe(true);
    expect(toReceiptRead(base).untimed).toBe(false);
  });
});

describe('class standing on the receipt read', () => {
  const standing = {
    class_place: 2,
    class_behind_leader_ms: 34_000,
    class_finished_count: 5,
    class_starters_count: 8,
  };
  const base = {
    className: 'D21',
    classId: 'c',
    club: null,
    competitionName: 'T',
    competitionDate: '2026-10-03',
  };

  it('carries place, time behind and class progress', () => {
    const r = toReceiptRead({ ...base, row: row(standing) });
    expect(r.place).toBe(2);
    expect(r.progress).toMatchObject({
      place: 2,
      behind: '+0:34',
      finishedInClass: 5,
      startersInClass: 8,
    });
  });

  it('the leader has a place but no "behind"', () => {
    const r = toReceiptRead({
      ...base,
      row: row({ ...standing, class_place: 1, class_behind_leader_ms: 0 }),
    });
    expect(r.place).toBe(1);
    expect(r.progress.behind).toBeNull();
  });

  it('MP / untimed / unplaced runners have no place or behind', () => {
    const none = { class_place: null, class_behind_leader_ms: null };
    const r = toReceiptRead({ ...base, row: row({ ...standing, ...none }) });
    expect(r.place).toBeNull();
    expect(r.progress.behind).toBeNull();
    expect(classBehind(row({ ...standing, ...none }))).toBeNull();
  });
});
