// Authored for fartola. Not ported from upstream.
//
// Vitest coverage for readElapsedMs (02.1-14 follow-up, item F): the readout
// view's running time uses the drawn start when present, else the start
// punch, and shows nothing otherwise (no first-punch fallback).

import { describe, it, expect } from 'vitest';
import { localToEpochMs } from '@fartola/shared-types';
import { readElapsedMs, type ReadoutHistoryRow } from './readout-types.ts';

const row = (over: Partial<ReadoutHistoryRow>): ReadoutHistoryRow =>
  ({
    card_type: 'SIAC',
    punches: [{ code: 31, seconds_in_half_day: 10 * 3600 + 120, half_day: 0 }],
    start_seconds_in_half_day: 10 * 3600 + 60,
    start_half_day: 0,
    finish_seconds_in_half_day: 10 * 3600 + 45 * 60,
    finish_half_day: 0,
    ...over,
  }) as ReadoutHistoryRow;

const drawn10 = localToEpochMs('2026-10-03', 10 * 3600);

describe('readElapsedMs', () => {
  it('drawn start wins over the start punch', () => {
    expect(readElapsedMs(row({}), drawn10)).toBe(45 * 60 * 1000);
  });

  it('no drawn start → start punch', () => {
    expect(readElapsedMs(row({}), null)).toBe(44 * 60 * 1000);
  });

  it('neither drawn start nor start punch → null (no first-punch fallback)', () => {
    expect(readElapsedMs(row({ start_seconds_in_half_day: null }), null)).toBeNull();
  });

  it('no finish → null', () => {
    expect(readElapsedMs(row({ finish_seconds_in_half_day: null }), drawn10)).toBeNull();
  });

  it('run across noon from a drawn start: 11:50 → 12:20 PM is 30 min', () => {
    const drawn = localToEpochMs('2026-10-03', 11 * 3600 + 50 * 60);
    const r = row({ finish_seconds_in_half_day: 20 * 60, finish_half_day: 1 });
    expect(readElapsedMs(r, drawn)).toBe(30 * 60 * 1000);
  });
});
