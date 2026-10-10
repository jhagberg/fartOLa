// Authored for fartola. Not ported from upstream.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { entryFeeFor, isYouthByBirthYear, surchargeCapPct } from './index.ts';

describe('surchargeCapPct (SOFT TR 4.12.6)', () => {
  test('age class, adult: 50 % late, 100 % on the competition day', () => {
    for (const kind of ['elit', 'junior', 'senior', 'veteran'] as const) {
      assert.equal(surchargeCapPct(kind, false, 'late'), 50, kind);
      assert.equal(surchargeCapPct(kind, false, 'walkup'), 100, kind);
    }
  });

  test('age class, youth: 50 % late and on the day', () => {
    assert.equal(surchargeCapPct('ungdom', true, 'late'), 50);
    assert.equal(surchargeCapPct('ungdom', true, 'walkup'), 50);
  });

  test('open class, adult: 50 % late and on the day', () => {
    assert.equal(surchargeCapPct('oppen', false, 'late'), 50);
    assert.equal(surchargeCapPct('oppen', false, 'walkup'), 50);
  });

  test('open class, youth and inskolning: no surcharge', () => {
    assert.equal(surchargeCapPct('oppen', true, 'late'), 0);
    assert.equal(surchargeCapPct('oppen', true, 'walkup'), 0);
    assert.equal(surchargeCapPct('inskolning', false, 'walkup'), 0);
  });

  test('a class without a kind gets no surcharge', () => {
    assert.equal(surchargeCapPct(null, false, 'walkup'), 0);
  });
});

describe('entryFeeFor', () => {
  const h21 = { classKind: 'senior', entryFee: 180, youthEntryFee: null, lateFeePct: 50 } as const;
  const open = { classKind: 'oppen', entryFee: 180, youthEntryFee: 90, lateFeePct: 50 } as const;

  test('walk-up in an adult age class pays the fee plus the surcharge', () => {
    assert.deepEqual(entryFeeFor(h21, false, 'walkup'), { entry: 180, late: 90, capped: false });
  });

  test('the cap lowers a surcharge above it', () => {
    const c = { ...h21, lateFeePct: 150 };
    assert.deepEqual(entryFeeFor(c, false, 'walkup'), { entry: 180, late: 180, capped: true });
    assert.deepEqual(entryFeeFor(c, false, 'late'), { entry: 180, late: 90, capped: true });
  });

  test('youth in an open class pays the youth fee and no surcharge', () => {
    assert.deepEqual(entryFeeFor(open, true, 'walkup'), { entry: 90, late: 0, capped: true });
    assert.deepEqual(entryFeeFor(open, false, 'walkup'), { entry: 180, late: 90, capped: false });
  });

  test('inskolning pays the youth fee and no surcharge for anyone', () => {
    const c = { ...open, classKind: 'inskolning' } as const;
    assert.deepEqual(entryFeeFor(c, false, 'walkup'), { entry: 90, late: 0, capped: true });
  });

  test('the surcharge rounds down to whole kronor', () => {
    const c = { classKind: 'ungdom', entryFee: 95, youthEntryFee: null, lateFeePct: 50 } as const;
    assert.equal(entryFeeFor(c, true, 'walkup').late, 47);
  });

  test('no fee set means nothing to pay', () => {
    const c = {
      classKind: 'senior',
      entryFee: null,
      youthEntryFee: null,
      lateFeePct: null,
    } as const;
    assert.deepEqual(entryFeeFor(c, false, 'walkup'), { entry: 0, late: 0, capped: false });
  });
});

describe('isYouthByBirthYear (TR 3.4.6, 16 and younger)', () => {
  test('born 2010 is youth in 2026, born 2009 is not', () => {
    assert.equal(isYouthByBirthYear(2010, '2026-10-10'), true);
    assert.equal(isYouthByBirthYear(2009, '2026-10-10'), false);
  });
});
