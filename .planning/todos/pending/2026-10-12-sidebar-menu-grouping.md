---
created: 2026-10-12T00:00:00+02:00
title: Group the sidebar so exports and integrations are easy to find
area: layout
files:
  - apps/web/src/lib/layout/Sidebar.svelte
---

## Problem

Jonas, local test 2026-10-12: he looked for "send results to Eventor" under
Export (which only downloads a result file) and found it later under Eventor.
The sidebar has 14 flat entries; related things sit apart (Export, Eventor,
Liveresultat settings under Inställningar).

## Idea

Group by when the volunteer needs it, with a heading per group (ADR-0016):
before the race (Anmälda, Lottning, Kontroll), during (Avläsning,
Registrering, Resultat, Speaker, Kvar i skogen, Hyrbrickor), after and
integrations (Export, Eventor, Liveresultat). Export should at least link to
"Skicka resultat till Eventor". Needs a short design pass before code.
