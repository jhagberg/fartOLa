// Authored for fartola. Not ported from upstream.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatGap, formatStartTime } from './templates.ts';

test('formatGap uses printer-safe text for the leader row', () => {
  assert.equal(formatGap(0), 'Leder');
});

test('formatStartTime renders epoch ms on the competition wall clock (02.1-14 Task 1)', () => {
  assert.equal(formatStartTime(Date.parse('2026-10-03T08:00:00Z')), '10:00:00');
});
