// Authored for fartola. Not ported from upstream.
//
// How many controls a SPORTident card can hold, from its number alone; for
// the pre-race check (a long course on an SI5). The capacities are
// SPORTident's published card specifications (sportident.com, the
// SI-Card product pages): SI-Card5 36, SI-Card6 64, SI-Card8 30, SI-Card9
// 50, SI-Card10, SI-Card11 and SIAC 128, SI-pCard 20. An SI-Card5 keeps
// the time only for punches 1-30; 31-36 keep the control code alone (the
// card layout in packages/sportident SiCard5.ts: slots 30-35 are
// codes-only), so the course can still be checked but the splits after 30
// are missing. The number ranges are the detection ranges in
// packages/sportident (inferCardType), which also has the same
// MAX_NUM_PUNCHES per card class.
//
// Unlike inferCardType this returns null for a number it does not know
// (tCard, fCard, anything new), so the check never warns on a guess.

export interface CardCapacity {
  /** Punches the card holds. */
  punches: number;
  /** Of those, the ones stored with a time (fewer only on an SI-Card5). */
  timed: number;
}

const RANGES: ReadonlyArray<readonly [from: number, to: number, punches: number, timed?: number]> =
  [
    [1_000, 500_000, 36, 30], // SI-Card5
    [500_000, 1_000_000, 64], // SI-Card6
    [1_000_000, 2_000_000, 50], // SI-Card9
    [2_003_000, 2_004_000, 64], // SI-Card6* inside the SI-Card8 series
    [2_000_000, 3_000_000, 30], // SI-Card8
    [4_000_000, 5_000_000, 20], // SI-pCard
    [7_000_000, 8_000_000, 128], // SI-Card10
    [8_000_000, 9_000_000, 128], // SIAC
    [9_000_000, 10_000_000, 128], // SI-Card11
  ];

/** Punch slots on the card with this number, or null when the number is in
 * no known series. The first matching range wins, so SI-Card6* comes before
 * SI-Card8. */
export function cardPunchCapacity(cardNumber: number): CardCapacity | null {
  for (const [from, to, punches, timed] of RANGES) {
    if (cardNumber >= from && cardNumber < to) return { punches, timed: timed ?? punches };
  }
  return null;
}
