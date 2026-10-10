// Authored for fartola. Not ported from upstream.
//
// Logic for the fee list (components/FeesPanel.svelte) and the walk-up fee
// line (WalkupModal), SOFT TR 4.12.4 and TR 4.12.6. The rules themselves
// live in @fartola/shared-types fees.ts, shared with the edge, so the
// amount the desk shows is the amount the edge records.

import {
  entryFeeFor,
  isYouthByBirthYear,
  localToEpochMs,
  surchargeCapPct,
  type ClassKind,
} from '@fartola/shared-types';
import { ApiError, type ClassFeeItem, type FeesResponse } from '#lib/api/client.ts';

export type { ClassFeeItem };

/** Whole kronor or percent from a text field: '' → null, invalid →
 * undefined. */
export function parseWhole(text: string, max = Number.MAX_SAFE_INTEGER): number | null | undefined {
  const s = text.trim();
  if (s === '') return null;
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  return n <= max ? n : undefined;
}

/** Open classes and inskolning can have a youth fee (TR 4.12.1). */
export const hasYouthFee = (kind: ClassKind | null): boolean =>
  kind === 'oppen' || kind === 'inskolning';

/** The highest walk-up surcharge SOFT allows for an adult runner in the
 * class (an open class's youth get none). */
export const walkupCapPct = (kind: ClassKind | null): number =>
  surchargeCapPct(kind, false, 'walkup');

/** The i18n key for a failed Eventor fee fetch. */
export function eventorErrorKey(e: unknown): string {
  if (e instanceof ApiError && e.body !== null && typeof e.body === 'object') {
    const b = e.body as { eventor?: string };
    if (b.eventor === 'not_linked' || b.eventor === 'no_key' || b.eventor === 'failed')
      return `fees.eventor.${b.eventor}`;
  }
  return 'fees.eventor.failed';
}

export interface FeeLine {
  entry: number;
  late: number;
  card: number;
  total: number;
}

/** What a walk-up pays, as the edge records it (routes/competitors.ts):
 * class fee and capped surcharge, a late entry before the competition day,
 * plus the card fee for a hired card. The birth year decides youth in an
 * open class. Null when nothing is charged. */
export function walkupFee(
  fees: FeesResponse,
  classId: string,
  birthYear: number | null,
  hiredCard: boolean,
  nowMs: number
): FeeLine | null {
  const c = fees.classes.find((x) => x.class_id === classId);
  const timing = nowMs < localToEpochMs(fees.date, 0) ? 'late' : 'walkup';
  const { entry, late } =
    c === undefined || c.entry_fee === null
      ? { entry: 0, late: 0 }
      : entryFeeFor(
          {
            classKind: c.class_kind,
            entryFee: c.entry_fee,
            youthEntryFee: c.youth_entry_fee,
            lateFeePct: c.late_fee_pct,
          },
          birthYear !== null && isYouthByBirthYear(birthYear, fees.date),
          timing
        );
  const card = hiredCard ? (fees.card_fee ?? 0) : 0;
  const total = entry + late + card;
  return total === 0 ? null : { entry, late, card, total };
}

/** A birth year from the desk's text field: '' → null, invalid →
 * undefined. */
export function parseBirthYear(text: string): number | null | undefined {
  const y = parseWhole(text);
  return y === null || y === undefined ? y : y >= 1900 && y <= 2100 ? y : undefined;
}
