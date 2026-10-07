---
created: 2026-10-06T10:00:00+02:00
title: SVG icons (Lucide) instead of emoji and Unicode symbols in the web UI
area: web
files:
  - apps/web/package.json
  - apps/web/src/lib/components/LatestReadCard.svelte
  - apps/web/src/lib/screens/ReadoutView.svelte
  - apps/web/src/lib/i18n/sv.json
  - apps/web/src/lib/i18n/en.json
---

## Problem

The web UI uses emoji and Unicode symbols as icons: 129 occurrences in 39
files under `apps/web/src` (2026-10-06 count, tests excluded). Most are
arrows (`→` ×87, mostly "Nästa →"), then `⚠` ×7, `✓` ×6, `▢` ×5, `★` ×4,
`▶`, `●`, `☐`, `✗`, `✎`, `▾`, `🖨`, `📁`. The phase-1 UI spec put some of
them into button labels ("🖨 Skriv ut kvitto", "▶ Starta avläsning").
Emoji are drawn differently on every OS and browser, cannot follow the
theme colours or the bright-sun mode, and vary in size and baseline
(ui-ux-pro-max `no-emoji-icons`, `icon-style-consistent`).

## What

- Add **Lucide** for Svelte 5 (`@lucide/svelte`, ISC licence, one
  component per icon, tree-shaken). One icon set, one stroke width, sizes
  as tokens (e.g. 16/20/24).
- A small `Icon` wrapper or direct imports. Decorative icons get
  `aria-hidden="true"`. An icon-only button gets an `aria-label`.
- Replace the symbols screen by screen, starting with the readout
  (`LatestReadCard`, `ReadoutView`, `StationCard`). Status icons go next
  to the status text, never instead of it (ADR-0016 rule 7: never colour
  or symbol alone).
- Move symbols out of the i18n strings (`sv.json`, `en.json`): the
  string holds the text, and the component places the icon.
- Text arrows in running prose may stay; "Nästa →" buttons get a
  chevron icon.
- Out of scope: receipt templates (ESC/POS prints text), and the site
  demo under `docs/demo` (do it when the demo is redone).

## Tests

- A lint/grep check: no emoji or pictographic symbol (U+1F300–U+1FAFF,
  U+2600–U+27BF) in `apps/web/src/**/*.svelte` or the i18n files.
- Existing e2e tests that find buttons by their label still pass (labels
  stay text).
- The axe check from ADR-0016: every icon-only button has a name.
