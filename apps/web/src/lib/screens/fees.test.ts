// Authored for fartola. Not ported from upstream.

import { describe, expect, it } from 'vitest';

import { ApiError } from '#lib/api/client.ts';
import {
  eventorErrorKey,
  hasYouthFee,
  parseWhole,
  walkupCapPct,
  walkupFee,
  parseBirthYear,
} from './fees.ts';

describe('fees helpers (SOFT TR 4.12.4, TR 4.12.6)', () => {
  it('parseWhole: empty is null, digits a number, anything else invalid', () => {
    expect(parseWhole('')).toBe(null);
    expect(parseWhole(' 180 ')).toBe(180);
    expect(parseWhole('12,5')).toBe(undefined);
    expect(parseWhole('-1')).toBe(undefined);
    expect(parseWhole('150', 100)).toBe(undefined);
  });

  it('only open classes and inskolning have a youth fee', () => {
    expect(hasYouthFee('oppen')).toBe(true);
    expect(hasYouthFee('inskolning')).toBe(true);
    expect(hasYouthFee('senior')).toBe(false);
    expect(hasYouthFee(null)).toBe(false);
  });

  it('the walk-up cap shown per class type', () => {
    expect(walkupCapPct('senior')).toBe(100);
    expect(walkupCapPct('ungdom')).toBe(50);
    expect(walkupCapPct('oppen')).toBe(50);
    expect(walkupCapPct('inskolning')).toBe(0);
    expect(walkupCapPct(null)).toBe(0);
  });

  it('eventorErrorKey names why the Eventor fetch failed', () => {
    const err = (eventor: string) =>
      new ApiError(409, 'x', { error: 'eventor_unavailable', eventor }, '');
    expect(eventorErrorKey(err('no_key'))).toBe('fees.eventor.no_key');
    expect(eventorErrorKey(err('not_linked'))).toBe('fees.eventor.not_linked');
    expect(eventorErrorKey(new Error('boom'))).toBe('fees.eventor.failed');
  });
});

describe('walkupFee: what the desk shows matches what the edge records', () => {
  const fees = {
    date: '2026-10-10',
    card_fee: 30,
    classes: [
      {
        class_id: 'h21',
        name: 'H21',
        class_kind: 'senior' as const,
        entry_fee: 180,
        youth_entry_fee: null,
        late_fee_pct: 100,
      },
      {
        class_id: 'gul',
        name: 'Gul 2,5',
        class_kind: 'oppen' as const,
        entry_fee: 180,
        youth_entry_fee: 90,
        late_fee_pct: 50,
      },
      {
        class_id: 'd21',
        name: 'D21',
        class_kind: 'senior' as const,
        entry_fee: null,
        youth_entry_fee: null,
        late_fee_pct: null,
      },
    ],
  };
  const onTheDay = Date.parse('2026-10-10T08:00:00Z');
  const dayBefore = Date.parse('2026-10-09T08:00:00Z');

  it('walk-up on the day with a hired card', () => {
    expect(walkupFee(fees, 'h21', null, true, onTheDay)).toEqual({
      entry: 180,
      late: 180,
      card: 30,
      total: 390,
    });
  });

  it('a late entry the day before is capped at 50 %', () => {
    expect(walkupFee(fees, 'h21', null, false, dayBefore)?.late).toBe(90);
  });

  it('born 2010 in an open class: youth fee, no surcharge; born 2009: adult', () => {
    expect(walkupFee(fees, 'gul', 2009, false, onTheDay)?.total).toBe(270);
    expect(walkupFee(fees, 'gul', 2010, false, onTheDay)).toEqual({
      entry: 90,
      late: 0,
      card: 0,
      total: 90,
    });
  });

  it('no class fee: only the card fee, or nothing', () => {
    expect(walkupFee(fees, 'd21', null, true, onTheDay)?.total).toBe(30);
    expect(walkupFee(fees, 'd21', null, false, onTheDay)).toBe(null);
  });

  it('parseBirthYear: empty is null, a four-digit year a number, else invalid', () => {
    expect(parseBirthYear('')).toBe(null);
    expect(parseBirthYear('2010')).toBe(2010);
    expect(parseBirthYear('10')).toBe(undefined);
    expect(parseBirthYear('20x0')).toBe(undefined);
  });
});
