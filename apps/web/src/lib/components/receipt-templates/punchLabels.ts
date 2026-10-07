// Authored for fartola. Not ported from upstream.
//
// How a punch tile is labelled wherever the course is listed (punch grid,
// splits table, web receipts). A struck (voided) control and an extra or
// out-of-order punch are named in text, never by colour alone (ADR-0016
// rule 7). See also the printed twin in apps/edge/src/print/templates.ts.

import { t } from '#lib/i18n/index.ts';
import type { ReceiptPunch } from './types.ts';

const LABEL_KEY = { struck: 'ro.struck', extra: 'ro.extra', order: 'ro.order' } as const;

/** "struken" / "extra" / "fel ordn." for a labelled tile, else null. */
export function punchLabel(p: Pick<ReceiptPunch, 'kind'>): string | null {
  return p.kind === undefined ? null : t(LABEL_KEY[p.kind]);
}

/** Running number of tile `i`: course controls count 1., 2., …; a struck
 * control shows '–' and an extra / out-of-order punch '+'. */
export function punchNo(punches: readonly ReceiptPunch[], i: number): string {
  const p = punches[i] as ReceiptPunch;
  if (p.kind === 'struck') return '–';
  if (p.kind !== undefined) return '+';
  return `${punches.slice(0, i + 1).filter((q) => q.kind === undefined).length}.`;
}

/** ok / total over the tiles someone has to punch (and the finish); struck
 * controls and extra punches count in neither. */
export function punchProgress(punches: readonly ReceiptPunch[]): { ok: number; total: number } {
  const counted = punches.filter((p) => p.kind === undefined);
  return { ok: counted.filter((p) => p.ok).length, total: counted.length };
}
