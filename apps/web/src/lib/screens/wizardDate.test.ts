// Authored for fartola. Not ported from upstream.
import { describe, expect, it } from 'vitest';
import { validDate } from './wizardDate.ts';

describe('validDate', () => {
  it('accepts real days, including a leap day', () => {
    expect(validDate('2026-05-19')).toBe(true);
    expect(validDate('2028-02-29')).toBe(true);
  });
  it('rejects impossible days and wrong shapes', () => {
    expect(validDate('2026-02-30')).toBe(false);
    expect(validDate('2027-02-29')).toBe(false);
    expect(validDate('2026-13-99')).toBe(false);
    expect(validDate('2026-5-19')).toBe(false);
    expect(validDate('')).toBe(false);
  });
});
