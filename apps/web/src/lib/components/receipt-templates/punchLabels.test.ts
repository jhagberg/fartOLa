// Authored for fartola. Not ported from upstream.
//
// The readout's "x/y" punch count: a finish punch counts as ok, struck
// controls and extra punches count in neither. Synthetic data only.

import { describe, it, expect } from 'vitest';
import { punchProgress } from './punchLabels.ts';
import type { ReceiptPunch } from './types.ts';

const ok = (code: number): ReceiptPunch => ({ code, split: '1:00', time: '1:00', ok: true });
const finish: ReceiptPunch = { code: 'F', split: '1:00', time: '9:00', finish: true };

describe('punchProgress', () => {
  it('a clean run with 15 controls and a finish is 16/16', () => {
    const punches = [...Array.from({ length: 15 }, (_, i) => ok(31 + i)), finish];
    expect(punchProgress(punches)).toEqual({ ok: 16, total: 16 });
  });

  it('a missed control and no finish: 2/3', () => {
    const punches: ReceiptPunch[] = [
      ok(31),
      { code: 32, split: '—', time: '—', ok: false },
      ok(33),
    ];
    expect(punchProgress(punches)).toEqual({ ok: 2, total: 3 });
  });

  it('struck controls and extra punches count in neither', () => {
    const punches: ReceiptPunch[] = [
      ok(31),
      { ...ok(32), kind: 'struck' },
      { ...ok(99), ok: false, kind: 'extra' },
      finish,
    ];
    expect(punchProgress(punches)).toEqual({ ok: 2, total: 2 });
  });
});
