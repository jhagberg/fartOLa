---
status: accepted
date: 2026-10-12
decision-makers: [Jonas Hagberg]
consulted:
  [
    'MeOS source (class flags FreeStart, RequestStart, IgnoreStart)',
    'OLA 6.6.2, own observation in the lab 2026-10-12 and OLA-guiden 1.2',
    'Codex (review of this ADR and its plan, 2026-10-12)',
  ]
informed: []
---

# One start choice per class, with three answers

## Context and Problem Statement

A class has one setting, "Starttid räknas från", with the values
Automatiskt, Starttid and Startstämpling. It answers where the running
time counts from. Kontroll reads the same setting to decide whether the
class needs start times before the race, and that is a different
question:

- Startstämpling means "never list this class", also when the organiser
  wants a start list that spreads the start (a training race).
- Automatiskt means "list everyone as soon as one runner has a start
  time", so one imported or hand-set time makes a free-start class look
  undrawn. Found in a local test on 2026-10-12: inskolning showed up as
  missing start times until it was drawn.

Automatiskt also decides per runner (the start time if the runner has
one, else the start punch), so the operator cannot tell from the screen
which start a result runs from.

How does the operator say how a class starts, so that Lottning, Kontroll
and the results agree?

## Decision Drivers

- ADR-0016: you always see what will happen. No setting that guesses.
- ADR-0011: SOFT's rules decide. TR 4.18.16 allows the start punch as
  start method. TR 7.4.3 allows free start time in open classes. TR 7.4.2
  forbids it in age classes at nivå 1–3.
- Results of competitions already in the database must not change by
  themselves (ADR-0014).
- More start forms will come (booked free interval start), so the choice
  must be able to grow.

## Considered Options

- **A. Two settings per class**, as MeOS and OLA: how the class gets start
  times, and where the time counts from.
- **B. One choice with three answers**, each saying both things.
- **C. No setting**: guess from how many runners have a start time.
- **D. Ask in Kontroll only**, when a class lacks start times.
- **E. A column in the class table on Tävlingsinfo.**

## Decision Outcome

Chosen option: **B, with D as a shortcut**. Only three combinations are
valid, since free start with time from the start time has no start time
to count from. One choice with three answers offers exactly those three
and names the training case instead of leaving it to be worked out.

"Så startar klassen", stored in `classes.start_method`:

| Answer                             | Stored        | Time counts from               | Kontroll lists runners without a start time  |
| ---------------------------------- | ------------- | ------------------------------ | -------------------------------------------- |
| Lottad starttid                    | `start_time`  | the start time                 | yes                                          |
| Lottad starttid och startstämpling | `start_punch` | the start punch, else the time | yes                                          |
| Fri start med startstämpling       | `free_start`  | the start punch, else the time | no                                           |
| (older competitions)               | `auto`        | the start time, else the punch | as today (listed once one runner has a time) |

- **Rules.** `free_start` is refused for a confirmed age class at nivå 1–3
  (TR 7.4.2). Kontroll keeps listing such a class whatever is stored.
- **Defaults for a new class**, from the class kind (confirmed or
  suggested from the name): open and inskolning get `free_start`; an age
  class gets `start_time`; a class whose kind is unknown gets
  `start_punch`, so nobody ends up without a time and Kontroll asks.
  The operator can change the answer for any class, also a confirmed
  inskolning.
- **Kontroll shortcut.** A class with runners without a start time gets
  "Lotta klassen" (a link to Lottning) and "Fri start" (sets
  `free_start`, with a result line and undo). "Fri start" is not offered
  where TR 7.4.2 forbids it.
- **Older competitions.** `auto` stays a valid stored value and keeps its
  per-runner meaning. No new class gets it, and the screen shows such a
  class as not chosen. Existing `start_punch` classes that were never
  drawn become `free_start`, which does not change their times.

### Consequences

- Good, because Kontroll no longer guesses: it lists a class only when
  its answer says the class has a start list (or the rules demand one).
- Good, because a drawn start list with time from the start punch is a
  named choice.
- Good, because a new start form is one more answer and one more stored
  value.
- Bad, because `start_punch` changes meaning for Kontroll: an existing
  drawn class with Startstämpling is now listed when a runner lacks a
  start time. That is the intended behaviour, but it is a change.
- Bad, because a new age class no longer falls back to the start punch
  for a runner without a start time. Kontroll shows it before the race.
- Neutral: the setting stays in Lottning. A column on Tävlingsinfo
  (option E) can come later without changing the model.

### Confirmation

- Unit tests of the start rule for all four stored values, and of
  Kontroll's "needs start times" rule.
- The two-day replay (ADR-0014): results are identical, since no stored
  `auto`, `start_time` or drawn `start_punch` class changes its timing.
- The rule matrix rows for TR 4.18.16 and TR 7.4.2/7.4.3 are updated.

## Pros and Cons of the Options

### A. Two settings per class

- Good, because it is what MeOS and OLA do, and it scales to start gate
  and wave start.
- Bad, because one of four combinations must be blocked and explained,
  and the operator has two things to understand.

### B. One choice with three answers

- Good, because every answer is valid and says what happens to both the
  start list and the time.
- Bad, because a future start form that combines freely with the timing
  source would multiply the answers.

### C. No setting

- Good, because there is nothing to set.
- Bad, because the guess is what misled Kontroll.

### D. Ask in Kontroll only

- Good, because the question comes when it matters.
- Bad, because Lottning and the results need the answer too.

### E. A column in the class table

- Good, because all classes are seen at once.
- Neutral, because it is the same model in another place; not needed for
  the first step.

## More Information

- MeOS: `FreeStart` skips the draw (oEventDraw.cpp:1123) and the
  missing-start-time report (oReport.cpp:396); `IgnoreStart` turns the
  start punch off (oRunner.cpp:1226); the punch otherwise wins over a
  drawn time.
- OLA 6.6.2 (own observation 2026-10-12): Starttidsfördelning and
  Startmetod are separate per class; a class with Startmetod Stämpel can
  be drawn; there is no separate free-start choice.
- Plan: `.planning/phases/02.1-sanctioned-competition-foundations/02.1-15-START-CHOICE-PLAN.md`.
- Todo this replaces: `2026-10-10-open-classes-start-punch-by-default.md`.
