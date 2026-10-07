// Authored for fartola. Not ported from upstream.
//
// "Skogis" — procedural collectible critter generator for the Kids receipt
// template.
//
// MOVED to packages/shared-types/src/skogis.ts in plan 15 Task 2a so the
// apps/edge ESC/POS kids template can consume the same generator. This file
// is now a thin re-export to preserve plan-13's import path:
// `#lib/skogis/skogis.ts` still resolves for Kids.svelte + the determinism
// tests (skogis.test.ts), no source changes needed there.
//
// Consumers that need the type system entry point should prefer importing
// directly from `@fartola/shared-types`; this re-export is retained only to
// keep plan-13's Kids.svelte + tests compiling.
//
// Locked by:
// - 01-13-PLAN.md task 1 (original home — preserved import path)
// - 01-15-PLAN.md task 2a (move to shared-types)

export {
  skogisFromInput,
  skogisGeometry,
  skogisDisplayName,
  skogisHash,
  skogisRng,
  SKOGIS_INK,
  SKOGIS_PAPER,
  SKOGIS_PALETTES,
  SKOGIS_SPECIES,
} from '@fartola/shared-types';
export type {
  SkogisInput,
  SkogisDescriptor,
  SkogisPalette,
  SkogisGeometry,
  SkogisStats,
} from '@fartola/shared-types';
