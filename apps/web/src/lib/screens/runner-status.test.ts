// Authored for fartola. Not ported from upstream.
//
// Vitest coverage for the Anmälda status filters (runner-status.ts).

import { describe, it, expect } from 'vitest';
import type { RunnerStatus } from '#lib/api/client.ts';
import { isStatusFilter, matchesStatus } from './runner-status.ts';

const classById = new Map([
  ['h21', { no_timing: false }],
  ['inskolning', { no_timing: true }],
]);
const st = (over: Partial<RunnerStatus>): RunnerStatus => ({
  competitor_id: 'x',
  status: 'PEND',
  manual_status: null,
  missing_start: false,
  ...over,
});

describe('status filters', () => {
  it('match the projection and the class', () => {
    const h21 = { class_id: 'h21' };
    expect(matchesStatus('notRead', h21, st({}), classById)).toBe(true);
    expect(
      matchesStatus('notRead', h21, st({ status: 'DNS', manual_status: 'DNS' }), classById)
    ).toBe(false);
    expect(
      matchesStatus('manual', h21, st({ status: 'DNS', manual_status: 'DNS' }), classById)
    ).toBe(true);
    expect(matchesStatus('mp', h21, st({ status: 'MP' }), classById)).toBe(true);
    expect(
      matchesStatus('missingStart', h21, st({ status: 'OK', missing_start: true }), classById)
    ).toBe(true);
    expect(matchesStatus('noTiming', h21, st({}), classById)).toBe(false);
    expect(matchesStatus('noTiming', { class_id: 'inskolning' }, undefined, classById)).toBe(true);
    expect(matchesStatus('notRead', h21, undefined, classById)).toBe(false);
  });

  it('accept only known filter names from the URL', () => {
    expect(isStatusFilter('mp')).toBe(true);
    expect(isStatusFilter('nope')).toBe(false);
    expect(isStatusFilter(null)).toBe(false);
  });
});
