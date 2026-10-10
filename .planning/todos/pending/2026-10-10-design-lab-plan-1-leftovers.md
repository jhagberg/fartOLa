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

Plan 2 (`docs/design-lab/plan-2-screen-passes.md`) closed most of the small
findings from the plan 1 reviews. What is left sits in files other tracks
own, or in the readout, and waits for them.

## What

Visual and wording:

- 12–13 px text plan 1 did not reach: WalkupModal alternatives chip (m2-fees).
- WalkupModal scrim: use `var(--scrim)` (m2-fees).
- Hyrbrickor rows HY-1 … HY-5 in `docs/design-lab/audit.md` (m2-fees).
- Double edge (border plus `--shadow-md` ring): `LatestReadCard .dnf-pop`
  (sekretariat).
- `LatestReadCard .blink mono`, `.btn.lg` 13–17 px rules (sekretariat).
- `ReceiptMirror .tpl-tab` focus ring may clip in its `overflow: hidden` box
  (sekretariat).
- Green text `var(--ok, #107a57)` in AddRunnerSheet and RunnersListView: use
  `var(--ok)` without the fallback (m2-bibs / m2-prerace).
- AddRunnerSheet's redundant `:focus` outline (m2-bibs / m2-prerace).
- Walk-up search components (ClubAutocomplete, SmartClubSearch,
  SmartRunnerSearch, EventorAutocomplete): their `:focus` outlines are
  redundant with the global ring. Delete them when that code is next touched.
- Wording: "Bröt loppet" tooltip vs "Utgått"; `ro.dnf` "Bryt";
  `ro.missingStart.hint` and `tw.contrast` still English in sv.json; audit row
  WA-10 should use the existing `--mp-fg` (sekretariat).

Code and tests:

- `readout-long-course.spec.ts`: `+ 0` noise; `pageScroll` ignores `.main`.
- PunchGrid: test struck/extra with `verdict=false`; guard an empty punch area.
- `StatusLabel.test.ts` asserts the style string, not the resolved colour; axe
  does not force the "connecting" state.
- `check-icons.mjs`: comment stripping is line-based (trailing `//` comments
  and `/* */` inside strings). It has caused no false result.

## Tests

Each item that changes behaviour gets its own test where it is done.
