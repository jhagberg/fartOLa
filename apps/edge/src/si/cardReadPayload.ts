// Authored for fartola. Not ported from upstream.
//
// Builds the events.payload column body for `card_read` events. Mirrors
// `NdjsonEmitter.card_read` EXACTLY (packages/sportident/src/output/ndjson.ts
// lines 241-296) so the events.payload JSON shape is byte-equal between the
// real SI bridge (apps/edge/src/si/bridge.ts) and the NDJSON CLI (Phase 0's
// `fartola-readout`).
//
// Codex review C-H2 (HIGH): the prior plan-03 stub dropped
// start/finish/check/clear/card_holder/punch_count. Plan 07's reducer then
// reasoned "start = punch with code=1 OR 4" — wrong, because those special
// codes are control-station punches in Phase 0's surface, not start/finish
// events. This helper produces the FULL CardReadEvent shape so plan 07 reads
// `payload.start` / `payload.finish` directly with no punch-code guessing.
//
// T-PAYLOAD-DRIFT mitigation: the return type is the schema's `card_read`
// discriminated union arm (Extract<EventPayload, { event_type: 'card_read' }>),
// which in turn imports `NdjsonPunch` + `HalfDayClock` from @fartola/sportident.
// Any future field rename / removal in Phase 0's types surfaces here as a TS
// compile error.
//
// snakeCaseKeys mirrors the helper in `packages/sportident/src/output/ndjson.ts`
// lines 146-160 (one-level snake_case conversion of an arbitrary record). The
// Phase 0 cardHolder is a flat dict so one level suffices. Duplicating this
// 6-line helper (rather than re-exporting it from Phase 0) keeps the surface
// stable; if Phase 0 ever switches to recursive conversion, both copies must
// move in lockstep.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-06-PLAN.md task 1
// - .planning/phases/01-single-laptop-training-mvp/01-REVIEWS.md §C-H2
//   (full CardReadEvent shape — top-level start/finish/check/clear,
//   card_holder, punch_count)
// - packages/sportident/src/output/ndjson.ts (FULL FILE — primary
//   source-of-truth: lines 175-180 toHalfDayClock, lines 241-296 emitter body,
//   lines 265-279 top-level field assignment)
// - REQ-EVT-CMP-005 (card_read payload shape preserved end-to-end)

import type { BaseSiCard, NdjsonPunch } from '@fartola/sportident';
import { toHalfDayClock } from '@fartola/sportident';
import type { EventPayload } from '../db/schema.ts';
import { cardTypeFromNumber } from './cardType.ts';

/** The events.payload union arm produced for `card_read` events. */
export type CardReadPayload = Extract<EventPayload, { event_type: 'card_read' }>;

/** One-level snake_case key conversion (no recursion — Phase 0's cardHolder
 * is a flat dict so a single pass suffices). Mirrors
 * `packages/sportident/src/output/ndjson.ts` line 155 `snakeCaseKeys`. */
function snakeCaseKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    out[k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())] = obj[k];
  }
  return out;
}

/** Optional fields carried by ModernSiCard / SiCard5 instances but not present
 * on BaseSiCard's static surface. Matches NdjsonEmitter's `WithCounts` cast in
 * `packages/sportident/src/output/ndjson.ts` line 248. */
type WithExtras = BaseSiCard & {
  punchCount?: number;
  uid?: number;
};

/**
 * Construct a `card_read` events.payload body from a Phase 0 BaseSiCard.
 *
 * The returned shape omits NdjsonEmitter's `_base()` fields
 * (schema_version, ts_ms, device_path, device_serial) — those are NDJSON-
 * stream specific. The events row already carries equivalent metadata
 * (recorded_at_ms, node_id) via its outer columns. The discriminant
 * `event_type: 'card_read'` is included so the EventPayload union narrows.
 *
 * Drift detection: the return type is the schema's `card_read` union arm
 * which imports HalfDayClock + NdjsonPunch from @fartola/sportident. A field
 * rename in Phase 0 fails the assignment at TS-compile time
 * (T-PAYLOAD-DRIFT mitigation, codex C-H2).
 */
export function buildCardReadPayload(card: BaseSiCard): CardReadPayload {
  const raceResult = card.raceResult;
  const c = card as WithExtras;
  const punches: NdjsonPunch[] = (raceResult.punches ?? []).map((p) => {
    const clock = toHalfDayClock(p.time);
    return {
      code: p.code,
      seconds_in_half_day: clock?.seconds_in_half_day ?? 0,
      half_day: clock?.half_day ?? 0,
      weekday: clock?.weekday ?? null,
    };
  });
  const cardNumber = raceResult.cardNumber ?? card.cardNumber;
  const payload: CardReadPayload = {
    event_type: 'card_read',
    card_type: cardTypeFromNumber(cardNumber),
    card_number: cardNumber,
    start: toHalfDayClock(raceResult.startTime, raceResult.startCode, raceResult.startTouchFree),
    finish: toHalfDayClock(
      raceResult.finishTime,
      raceResult.finishCode,
      raceResult.finishTouchFree
    ),
    check: toHalfDayClock(raceResult.checkTime, raceResult.checkCode, raceResult.checkTouchFree),
    clear: toHalfDayClock(raceResult.clearTime),
    punch_count: c.punchCount ?? punches.length,
    punches,
    card_holder:
      raceResult.cardHolder === undefined
        ? null
        : snakeCaseKeys(raceResult.cardHolder as Record<string, unknown>),
  };
  if (card.cardSeriesByte !== undefined) payload.card_series_byte = card.cardSeriesByte;
  if (c.uid !== undefined) payload.uid = c.uid;
  return payload;
}
