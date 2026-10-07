// Authored for fartola. Not ported from upstream.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { formatReport, runBenchmark } from './draw-benchmark.ts';

describe('draw benchmark (ADR-0011)', () => {
  const report = runBenchmark(2026, 500, 1500);

  test('SOFT TR 7.5.1/7.5.2: fartOLa beats MeOS drawSOFTMethod and drawMeOSMethod on neighbours and repeats', () => {
    assert.equal(report.excess.fartola.classesWithExcess, 0);
    assert.ok(
      report.excess.meos_soft.classesWithExcess > 0,
      'MeOS SOFT leaves avoidable neighbours'
    );
    for (const s of report.shapes) {
      assert.equal(s.result.fartola.distinct, s.validPatterns, `${s.shape}: every valid pattern`);
      // Chi-square critical value at p = 0.001 (Wilson–Hilferty).
      const df = s.validPatterns - 1;
      const critical = df * Math.pow(1 - 2 / (9 * df) + 3.09 * Math.sqrt(2 / (9 * df)), 3);
      assert.ok(
        s.result.fartola.chi2 < critical,
        `${s.shape}: chi-square ${s.result.fartola.chi2}`
      );
      assert.ok(s.result.meos_soft.distinct < s.validPatterns, `${s.shape}: MeOS SOFT repeats`);
      assert.ok(
        s.result.fartola.topShare < s.result.meos_soft.topShare &&
          s.result.fartola.topShare < s.result.meos.topShare,
        `${s.shape}: most common outcome ${JSON.stringify(s.result)}`
      );
    }
  });

  test('the report is reproducible from its seed', () => {
    assert.equal(
      formatReport(runBenchmark(2026, 50, 100)),
      formatReport(runBenchmark(2026, 50, 100))
    );
  });
});
