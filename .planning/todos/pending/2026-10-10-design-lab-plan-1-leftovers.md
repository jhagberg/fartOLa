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

The reviews of design-lab plan 1 (`docs/design-lab/plan-1-building-blocks.md`)
left small findings that did not block it. Plan 2 (screen passes from
`docs/design-lab/audit.md`) should fold them in.

## What

Visual and wording:

- 12–13 px text plan 1 did not reach: WalkupModal alternatives chip.
- Double edges (border plus `--shadow-md` ring): `LatestReadCard .dnf-pop`,
  `CompetitionCard .comp-card:hover`.
- Leftovers from removed symbols: `ActiveCompetitionPill .row-check` 10 px,
  DropZone `.icon` sizes, `LatestReadCard .blink mono`, `.btn.lg` 13–17 px rules.
- `ReceiptMirror .tpl-tab` focus ring may clip in its `overflow: hidden` box.
- Competition-pill `.panel` (max-height 320 px) shows fewer 44 px rows.
- Green text `var(--ok, #107a57)` in AddRunnerSheet and RunnersListView: use
  the token without the fallback.
- Bright-sun amber (`--mp-fg` #8a4a00, 6.86:1) and `--punch-ok-line` (6.48) are
  weaker than default; consider darker bright-sun values.
- Wording: `registration.cancelRegistration` "Avregistrera (Återbud)" and
  `registration.cancelling`; "Bröt loppet" tooltip vs "Utgått"; `ro.dnf` "Bryt";
  `ro.missingStart.hint` and `tw.contrast` still English in sv.json; audit row
  WA-10 should use the existing `--mp-fg`.

Code and tests:

- A `--focus-ring` token (the ring is repeated about 15 times); drop the
  duplicate `.input:focus`/`.select:focus` rules; use or delete `--icon-sm/md/lg`.
- `ui/Icon.svelte`: derive `IconName` from the map (`keyof typeof ICONS`).
- Contrast test: add `--fg-faint` on `--bg-sunken`/`--pend-soft`, `--fg-muted` on
  `--bg-elev`, `--ok` and `--mp-fg` on `--bg`; drop the unused `ratio` export.
- `targets.spec.ts`: a `seedCompetition(..., { start: false })` option instead of
  the inline copy.
- `readout-long-course.spec.ts`: `+ 0` noise; `pageScroll` ignores `.main`.
- PunchGrid: test struck/extra with `verdict=false`; guard an empty punch area.
- `StatusLabel.test.ts` asserts the style string, not the resolved colour; axe
  does not force the "connecting" state.
- `check-icons.mjs`: comment stripping is line-based (trailing `//` comments
  and `/* */` inside strings).
- README: a note that bright-sun rows for `--dns/--dq/--cancel/--max` equal the
  default (not overridden).

## Tests

Each item that changes behaviour gets its test in the plan-2 task that does it.
