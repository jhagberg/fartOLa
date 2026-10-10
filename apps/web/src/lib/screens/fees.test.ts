// Authored for fartola. Not ported from upstream.

import { describe, expect, it } from 'vitest';

import { ApiError } from '#lib/api/client.ts';
import { eventorErrorKey, hasYouthFee, parseWhole, walkupCapPct } from './fees.ts';

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
