// Authored for fartola. Not ported from upstream.
//
// How many controls a SPORTident card can hold, from its number alone; for
// the pre-race check (a long course on an SI5). The capacities are
// SPORTident's published card specifications (sportident.com, the
// SI-Card product pages): SI-Card5 30 punches with time (31-36 are kept
// without time, so no split times), SI-Card6 64, SI-Card8 30, SI-Card9 50,
// SI-Card10, SI-Card11 and SIAC 128, SI-pCard 20. The number ranges are the
// detection ranges in packages/sportident (inferCardType), which also has
// the same MAX_NUM_PUNCHES per card class.
//
// Unlike inferCardType this returns null for a number it does not know
// (tCard, fCard, anything new), so the check never warns on a guess.

const RANGES: ReadonlyArray<readonly [from: number, to: number, punches: number]> = [
  [1_000, 500_000, 30], // SI-Card5
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
export function cardPunchCapacity(cardNumber: number): number | null {
  for (const [from, to, punches] of RANGES) {
    if (cardNumber >= from && cardNumber < to) return punches;
  }
  return null;
}
