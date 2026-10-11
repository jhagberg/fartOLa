---
created: 2026-10-10T00:00:00+02:00
title: Design lab, small leftovers from plan 1 for plan 2
area: web
files:
  - docs/design-lab/audit.md
  - apps/web/src/lib/components/LatestReadCard.svelte
  - apps/web/src/lib/components/PunchGrid.svelte
  - apps/web/src/lib/screens/ReadoutView.svelte
  - apps/web/src/lib/tokens.css
  - apps/web/src/lib/i18n/sv.json
---

## Problem

Plans 2 and 3 closed most of the small findings from the plan 1 reviews.
What is left sits in files other tracks
own, or in the readout, and waits for them.

## What

Visual and wording:

- `LatestReadCard .blink mono`, `.btn.lg` 13–17 px rules (sekretariat).
- `ReceiptMirror .tpl-tab` focus ring may clip in its `overflow: hidden` box
  (sekretariat).
- AddRunnerSheet's redundant `:focus` outline (m2-bibs / m2-prerace).
- Walk-up search components (ClubAutocomplete, SmartClubSearch,
  SmartRunnerSearch, EventorAutocomplete): their `:focus` outlines are
  redundant with the global ring. Delete them when that code is next touched.

Code and tests:

- `readout-long-course.spec.ts`: `+ 0` noise; `pageScroll` ignores `.main`.
- PunchGrid: test struck/extra with `verdict=false`; guard an empty punch area.
- `StatusLabel.test.ts` asserts the style string, not the resolved colour; axe
  does not force the "connecting" state.
- `check-icons.mjs`: comment stripping is line-based (trailing `//` comments
  and `/* */` inside strings). It has caused no false result.

## Tests

Each item that changes behaviour gets its own test where it is done.
