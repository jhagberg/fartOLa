---
created: 2026-10-09T00:00:00+02:00
title: Axe violations left after design-lab plan 1, and modal focus
area: web
files:
  - tests/e2e/a11y-known.json
  - apps/web/src/lib/ui/Modal.svelte
---

## Problem

`tests/e2e/a11y.spec.ts` allows the violations in `a11y-known.json`
(each listed below with screen and selector). The first run found none on
the five main screens in default and bright-sun mode, so the list is empty.
Modals never take focus, trap it or restore it, and have no
`aria-labelledby` (audit X5); axe's colour/target rules do not cover that.
The run also only sees what is on screen at load, not opened modals,
pickers or drawers.

## What

- Empty `a11y-known.json` during plan 2's screen passes (already empty).
- X5: focus first field, trap, restore, `aria-labelledby`, one
  `requestClose()` with a dirty check (WalkupModal, wizard onto Modal).
- Then widen the axe run from two rules to the full WCAG 2.2 AA set, and
  to opened modals, the status picker and the drawer.

## Known violations

None at the end of plan 1.
