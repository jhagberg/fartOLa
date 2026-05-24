// Authored for fartola. Not ported from upstream.
//
// LOCKED 35-word Swedish O-feature wordlist for event admin codes.
//
// Source: SOFT 2024 kontrollbeskrivningar (pages 6-15 of the PDF in
// .reference/d5561844-Kontrollbeskrivningar_2024__20240112.pdf).
// Curated for spoken memorability — definite-article form, 1-2
// syllables, distinct consonants, no homophones, no compounds.
// 35 entries × 900 numbers (100-999) = 31 500 combinations ≈ 14.9 bits.
//
// LOCKED: removing or adding entries requires a plan revision (entropy
// + brute-force math is keyed to length 35). See:
//   - .planning/phases/02-4-klubbs-mvp/02-08-PLAN.md §Code format + entropy
//   - .planning/adr/0010-event-admin-codes-trust-model.md
//
// Locked by:
//   - .planning/phases/02.1-sanctioned-competition-foundations/02.1-12-PLAN.md
//   - D-18 (event codes shape — word-NNN from locked wordlist)

export const EVENT_CODE_WORDS = [
  // Topografi (1.x) — 6 words
  'åsen',
  'sänkan',
  'höjden',
  'sadeln',
  'gropen',
  'fåran',
  // Branter och stenar (2.x) — 8 words
  'branten',
  'klippan',
  'grottan',
  'stenen',
  'blocket',
  'skrevan',
  'värnet',
  'berget',
  // Vatten och sankmarker (3.x) — 5 words
  'sjön',
  'gölen',
  'bäcken',
  'källan',
  'brunnen',
  // Vegetation (4.x) — 6 words
  'gläntan',
  'dungen',
  'häcken',
  'hörnet',
  'trädet',
  'stubben',
  // Människoframställda föremål (5.x) — 10 words
  'stigen',
  'bron',
  'muren',
  'stängslet',
  'ruinen',
  'röset',
  'tornet',
  'masten',
  'trappan',
  'terrassen',
] as const;

export type EventCodeWord = (typeof EVENT_CODE_WORDS)[number];
