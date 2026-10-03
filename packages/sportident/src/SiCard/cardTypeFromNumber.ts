// Authored for fartola. Not ported from upstream.
//
// `inferCardType(cardNumber)` — single source of truth for the card-number to
// card-type mapping used by both record and replay paths. Codex review CR-002
// (.planning/phases/00-hardware-proof/00-REVIEW.md): previously the bin path
// derived card_type from `TYPE_MAP[card.constructor.name]` while
// `replayFixture()` hard-coded 'SI5'. The two paths went out of sync for SI9,
// SI10, and SIAC inserted-card events. This module gives both sides the same
// answer.
//
// The bounds match the detection-registry ranges in
// `src/SiCard/types/SiCard{5,9,10}.ts` + `SIAC.ts`:
//   - SI5: cardNumber <  1_000_000
//   - SI9: 1_000_000 <= cardNumber <  2_000_000
//   - SI10: 7_000_000 <= cardNumber <  8_000_000
//   - SIAC: 8_000_000 <= cardNumber <  9_000_000
// Card numbers outside those ranges fall through to a conservative 'SI5'
// default so a future card-class addition doesn't silently break replay.
//
// See packages/sportident/NOTICE.md for cumulative attribution.

import type { CardType } from '../output/ndjson.ts';

/** Map a card number to its public `CardType` label. Range bounds match the
 * detection-registry registrations in `SiCard/types/*.ts`. */
export const inferCardType = (cardNumber: number): CardType => {
  if (cardNumber < 500_000) return 'SI5';
  if (cardNumber < 1_000_000) return 'SI6';
  if (cardNumber < 2_000_000) return 'SI9';
  if (cardNumber >= 7_000_000 && cardNumber < 8_000_000) return 'SI10';
  if (cardNumber >= 8_000_000 && cardNumber < 9_000_000) return 'SIAC';
  if (cardNumber >= 2_003_000 && cardNumber < 2_004_000) return 'SI6';
  // Conservative fallback: unknown ranges default to SI5 so callers always
  // get a well-typed CardType, never undefined. Phase 1 will add SI11 / PCARD
  // / TCARD / FCARD ranges as the card-class set grows.
  return 'SI5';
};
