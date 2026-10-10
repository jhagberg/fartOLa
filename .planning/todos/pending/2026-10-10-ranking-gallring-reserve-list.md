---
created: 2026-10-10T11:00:00+02:00
title: Ranking, gallring, class split and reserve list (TR 7.3.6, 7.3.7, 7.5.5, 7.5.6)
area: edge
files:
  - apps/edge/src/draw/seeded.ts
  - apps/edge/src/routes/lottning.ts
  - .planning/compliance/soft-regelverk-2026.md
---

## Problem

fartOLa has no ranking data, so four rule rows are SAKNAS in the
compliance matrix: TR 7.3.6/7.3.7 with TA (gallring and seeding with the
Sverigelistan filter, splitting an elite class so the lowest ranked go to
E2, E3), TR 7.5.5 (ranking classes on the same course start one after the
other, no interleaving) and TR 7.5.6 with TA (a reserve list in ranking
order in a ranking class with a limited number of starters; reserves go
in in turn). Seeding groups are chosen by hand (`competitors.seed_group`).

OLA documents the whole workflow (OLA-guiden 1.2, 2024-08-30): ranking
file import and seeding groups (p. 25), gallring with a relegation class,
class split by ranking and the reserve list filled by those cut (p. 28,
ch. 11.1-11.3), "Tillsätt reserver" after a withdrawal (p. 28) and class
splitting (p. 50-51). Mapping in the private OLA lab notes
(`fartOLa-docs/ola-lab/gap/ola-dokumentation.md`); not yet checked in the
running OLA.

## Fix

- Import ranking (IOF 3.0 or Eventor's ranking list; find which format
  Sverigelistan is published in) and store a ranking value per competitor.
- Class capacity per class (also needed for TR 7.3.2: vacancies must be
  drawn in elite classes when entries exceed the places).
- Gallring: cut to capacity by ranking, the cut go to the reserve list or
  a relegation class; class split by ranking.
- Reserve list: on a withdrawal, offer the next reserve in ranking order;
  log who was put in and when.
- Seeding groups from ranking instead of by hand (TR 7.4.5).
- TR 7.5.5 belongs with M3a (start distribution across classes).

Each rule row gets a test named after it, as the matrix requires.
