// Authored for fartola. Not ported from upstream.

import { describe, it, expect } from 'vitest';
import { formatMaxTime, parseMaxTime } from './max-time.ts';

describe('parseMaxTime', () => {
  it('takes whole minutes, mm:ss and h:mm:ss', () => {
    expect(parseMaxTime('150')).toBe(9000);
    expect(parseMaxTime(' 150 ')).toBe(9000);
    expect(parseMaxTime('150:00')).toBe(9000);
    expect(parseMaxTime('2:30:00')).toBe(9000);
    expect(parseMaxTime('1:30')).toBe(90);
  });
  it('empty clears; the rest is invalid', () => {
    expect(parseMaxTime('')).toBeNull();
    for (const bad of ['150:60', '0', '0:00', 'abc', '1.5', '-5', '1500'])
      expect(parseMaxTime(bad), bad).toBe('invalid');
  });
  it('shows a stored value as mm:ss', () => {
    expect(formatMaxTime(9000)).toBe('150:00');
    expect(formatMaxTime(null)).toBe('');
  });
});
