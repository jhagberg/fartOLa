// Authored for fartola. Not ported from upstream.
//
// The competition clock (one fixed offset per competition) across the
// Europe/Stockholm DST switches of 2026, and the civil helper it is chosen
// with.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clockToEpochMs,
  competitionClockOffsetMin,
  defaultClockOffsetMin,
  epochToClockSeconds,
  formatClockDateTime,
  formatClockTime,
  localToEpochMs,
  parseTimeOfDay,
  startBeforeFinishMs,
} from './time.ts';

const utc = (iso: string): number => Date.parse(iso);
const hms = (text: string): number => parseTimeOfDay(text)!;

describe('defaultClockOffsetMin (Europe/Stockholm, local noon of the date)', () => {
  test('CET in winter, CEST in summer', () => {
    assert.equal(defaultClockOffsetMin('2026-01-10'), 60);
    assert.equal(defaultClockOffsetMin('2026-06-01'), 120);
  });

  test('the DST days take the offset in force at noon', () => {
    assert.equal(defaultClockOffsetMin('2026-03-29'), 120);
    assert.equal(defaultClockOffsetMin('2026-10-25'), 60);
  });

  test('an operator override wins, null falls back to the default', () => {
    assert.equal(competitionClockOffsetMin('2026-03-29', 60), 60);
    assert.equal(competitionClockOffsetMin('2026-03-29', null), 120);
  });
});

describe('clockToEpochMs / formatClockTime', () => {
  test('02:00:54 on 2026-03-29 is a real instant at either offset', () => {
    assert.equal(clockToEpochMs('2026-03-29', hms('02:00:54'), 60), utc('2026-03-29T01:00:54Z'));
    assert.equal(clockToEpochMs('2026-03-29', hms('02:00:54'), 120), utc('2026-03-29T00:00:54Z'));
    for (const offset of [60, 120]) {
      assert.equal(
        formatClockTime(clockToEpochMs('2026-03-29', hms('02:00:54'), offset), offset),
        '02:00:54'
      );
    }
  });

  test('past midnight is the next day; seconds since midnight wrap', () => {
    const ms = clockToEpochMs('2026-10-03', 24 * 3600 + 60, 120);
    assert.equal(ms, utc('2026-10-03T22:01:00Z'));
    assert.equal(epochToClockSeconds(ms, 120), 60);
  });

  test('the civil helper still jumps at DST (calendar use only)', () => {
    assert.equal(localToEpochMs('2026-03-29', 3 * 3600), utc('2026-03-29T01:00:00Z'));
  });
});

describe('formatClockDateTime', () => {
  test('the autumn repeated hour: distinct instants stay distinct', () => {
    // At +01:00, 00:50Z and 01:50Z read 01:50 and 02:50 — never the same.
    assert.equal(formatClockDateTime(utc('2026-10-25T00:50:00Z'), 60), '2026-10-25T01:50:00+01:00');
    assert.equal(formatClockDateTime(utc('2026-10-25T01:50:00Z'), 60), '2026-10-25T02:50:00+01:00');
  });

  test('round-trips through Date.parse; sub-second and negative offsets', () => {
    const ms = utc('2026-03-29T01:00:54.5Z');
    assert.equal(formatClockDateTime(ms, 60), '2026-03-29T02:00:54.500+01:00');
    assert.equal(Date.parse(formatClockDateTime(ms, 60)), ms);
    assert.equal(
      formatClockDateTime(utc('2026-03-29T12:00:00Z'), -330),
      '2026-03-29T06:30:00-05:30'
    );
  });
});

describe('parseTimeOfDay', () => {
  test('HH:MM and HH:MM:SS → seconds after midnight', () => {
    assert.equal(parseTimeOfDay('10:21:40'), 10 * 3600 + 21 * 60 + 40);
    assert.equal(parseTimeOfDay(' 9:05 '), 9 * 3600 + 5 * 60);
    assert.equal(parseTimeOfDay('00:00'), 0);
  });

  test('anything else is null', () => {
    for (const text of ['24:00', '10:60', '10:00:60', '1000', 'abc', '', '10:5']) {
      assert.equal(parseTimeOfDay(text), null, text);
    }
  });
});

// Codex third review of #51, finding 4: a start entered as a time of day is
// placed before the finish, on the competition clock.
describe('startBeforeFinishMs', () => {
  test('same day, on the DST days too: 01:50 → 03:10 is 80 minutes', () => {
    for (const day of ['2026-03-29', '2026-10-25']) {
      const offset = defaultClockOffsetMin(day);
      const finish = clockToEpochMs(day, hms('03:10'), offset);
      const start = startBeforeFinishMs(hms('01:50'), finish, offset)!;
      assert.equal(formatClockTime(start, offset), '01:50:00');
      assert.equal(finish - start, 80 * 60_000);
    }
  });

  test('02:00:54 against a finish at 02:30 in the skipped spring hour', () => {
    const finish = clockToEpochMs('2026-03-29', hms('02:30'), 120);
    const start = startBeforeFinishMs(hms('02:00:54'), finish, 120)!;
    assert.equal(finish - start, (29 * 60 + 6) * 1000);
  });

  test('23:50 against a finish at 00:10 is the day before: 20 minutes', () => {
    const finish = clockToEpochMs('2026-10-04', hms('00:10'), 120);
    const start = startBeforeFinishMs(hms('23:50'), finish, 120)!;
    assert.equal(start, clockToEpochMs('2026-10-03', hms('23:50'), 120));
    assert.equal(finish - start, 20 * 60_000);
  });

  test('a start after the finish is null', () => {
    const finish = clockToEpochMs('2026-10-03', hms('10:00'), 120);
    assert.equal(startBeforeFinishMs(hms('10:30'), finish, 120), null);
  });

  test('a start at the finish is a zero run', () => {
    const finish = clockToEpochMs('2026-10-03', hms('10:00'), 120);
    assert.equal(startBeforeFinishMs(hms('10:00'), finish, 120), finish);
  });
});
