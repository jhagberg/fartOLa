---
created: 2026-10-10T19:20:00+02:00
title: Tävlingsinfo - one save model, with "Sparat" shown at the field
area: web
files:
  - apps/web/src/lib/screens/CompetitionInfoView.svelte
  - apps/web/src/lib/components/ClassKindsPanel.svelte
  - apps/web/src/lib/components/FeesPanel.svelte
---

## Problem

Seen 2026-10-10 testing main: on Tävlingsinfo the details (name, date,
level, distance) and Maxtid each have a Spara button, while Klasser
(class kinds) and Avgifter save on change with no feedback. The operator
asked whether a save button is missing. Audit row TI-2 (two Spara
buttons) in `docs/design-lab/audit.md` is the same problem.

## Fix

ADR-0016 rule 3 (no unsaved edit mode): save on change everywhere and
show "Sparat" next to the field that was saved (and the error there if
it failed). Maxtid keeps an explicit button, since it locks at the first
start (TR 4.21.2), with that said beside it.

Part of design-lab plan 3 (Avläsning, Direktanmälan, Resultat, Lottning,
Tävlingsinfo, Anmälda, Hyrbrickor). The Lottning half of the same
testing round, "Starttid räknas från" placed by the class header, is in
`2026-10-10-open-classes-start-punch-by-default.md`.
