---
created: 2026-10-05T11:30:00+02:00
title: Skogis story receipts in fartOLa — replace the phase-1 critter generator
area: print
files:
  - apps/edge/src/print/templates/kids.ts
  - apps/edge/src/print/kids-svg-to-bitmap.ts
  - packages/shared-types/src/skogis.ts
  - apps/web/src/lib/components/receipt-templates/Kids.svelte
---

## Problem

fartOLa's Kids receipt ("Skogis") is still the phase-1 procedural critter
(`packages/shared-types/src/skogis.ts`): identity from the runner, but the
accessory, stats and level come from status, place and punches. The newer
Skogis lives only in the separate MeOS tool `fartOLa-tools/skogis`
(commits 1bdc4d8, df36fb3, d122acf, 395e658, 2026-10-03):

- 15 drawn figures (Bäckis … Stigis, `assets/figures/*.png`, cut from
  `assets/skogisar-sheet.png`), Nunito font (OFL).
- A story receipt separate from the result: one Skogis "was with you",
  two short sentences to read aloud. Nothing about time, place or
  mispunch; a test checks `src/story.ts` imports nothing.
- All 15 equally common, chosen by a seed from (competition, runner);
  reprint gives the same Skogis and sentences.
- Texts in `assets/skogisar.json`, two tones (`enkel` for Inskolning/Vit,
  `äventyr` for Gul); only `"status": "approved"` lines print.
- Everyone who reads out in a chosen class gets one, also MP/DNF; DNS
  gets none.
- Background: `docs/v1-brief.md`, `docs/research-report.md`.

The phase-1 design rewards the result, which the new brief rules out, so
this is a replacement, not a sixth template next to the old one.

## What

- Move the story generator, `skogisar.json` and the figure PNGs into
  fartOLa (shared-types for the generator and texts, edge for the
  bitmaps). Keep the import-free story test.
- `kids.ts`: print figure + name + the two sentences; dither the PNG for
  ESC/POS like the tool does. Web `Kids.svelte`: same layout for preview.
- Class selection per competition (which classes get a Skogis), as on the
  tool's web page; default the open beginner classes.
- Remove the procedural generator and `data.skogisStats` once nothing uses
  them.
- Site demo (`docs/demo/print-app.jsx`) shows the new receipt.

## Figures: origin and licence

The figure sheet was sketched by Marie Hagberg and drawn from those
sketches with ChatGPT image generation (owner, 2026-10-07). Before the
figures go into the public repo and the site:

- Get Marie's written OK to publish them, and credit them: "Skisser:
  Marie Hagberg. Bilder ritade med ChatGPT."
- Put the images under their own licence, not the code's AGPL; CC BY 4.0
  is the simple choice. Add `assets/LICENSE` (or a section in
  `apps/edge/NOTICE.md`) naming the files, the credit and the licence.
- OpenAI's terms assign the output to the user, so nothing blocks
  publishing; purely AI-generated images may get weak or no copyright
  protection, which only limits what we can stop others from doing.
  (Not legal advice.)

## Tests

- Same (competition, runner) → same Skogis and sentences; different
  status/time/place → still the same.
- MP and DNF get a receipt; DNS does not.
- Only approved lines are ever chosen.
- Kids template prints without the network (bitmap from bundled assets).
