---
created: 2026-10-12T14:00:00+02:00
title: Idea - rule profiles, so fartOLa can follow another federation's rules than SOFT's
area: edge
files:
  - docs/decisions/0011-follow-soft-rulebook-over-meos-with-gated-rule-matrix.md
  - .planning/compliance/soft-regelverk-2026.md
  - scripts/check-compliance.mjs
---

## Idea (Jonas, 2026-10-12)

fartOLa follows SOFT's rules (ADR-0011), and the rule matrix is SOFT's
2026 rulebook. A club outside Sweden has another rulebook: IOF's rules
or its own federation's. If fartOLa is to be used there, the rules must
be a choice per competition, not built in.

Not to build now. Nobody outside Sweden uses fartOLa yet, and a rule set
that no one runs competitions with will not stay correct.

## What differs between rulebooks

To be checked against the actual rulebooks before anything is built; this
is a list of where fartOLa decides by rule today, not of known
differences:

- time resolution and rounding (SOFT TR 4.20.7), ties (TR 4.20.8);
- maximum time and when it locks (TR 4.21);
- the draw: club neighbours, start clashes, vacancies (TR 7.5, TA 6.5);
- class kinds, which classes need start times, open classes (TR 7.4);
- fees, late-entry surcharges, youth fees (TR 4.12);
- statuses and what they are called in lists and exports (TA 7.8.2);
- what the organiser must check before and after the race.

Language is a separate matter (the texts are already in two languages).

## How it could be done

- A rule profile per competition, "SOFT 2026" by default. Every rule
  decision in code reads the profile instead of a constant.
- One rule matrix per profile, each gated like today's
  (`scripts/check-compliance.mjs`): a profile without a matrix and tests
  is not offered.
- A new SOFT rulebook (2027) is then also a profile, which is the first
  real use: an old competition keeps the rules it was run under.

## A cheap first step

Keep doing what the code mostly does already: one named function per
rule decision, citing the rule (`officialMs`, the start-clash check, the
fee rules), found through the matrix. Then a profile can be put in later
without hunting for the rules.
