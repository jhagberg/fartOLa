---
status: accepted
date: 2026-10-12
decision-makers: [Jonas Hagberg]
consulted:
  [
    'MeOS source (class flags FreeStart, RequestStart, IgnoreStart)',
    'OLA 6.6.2, own observation in the lab 2026-10-12 and OLA-guiden 1.2',
    'Codex (review of this ADR and its plan, 2026-10-12: 13 findings, taken)',
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

- **Rules.**
  - `free_start` is refused for a confirmed age class at nivå 1–3
    (TR 7.4.2), and a draw is refused for a class stored as `free_start`.
  - The stored answer can become wrong later: the kind is confirmed, or
    the level is set, after free start was chosen. Nothing is rewritten
    then, since that would change times. Kontroll lists the class itself
    as a conflict until the operator picks an allowed answer, whether or
    not its runners have start times.
  - A kind that is only suggested from the name does not refuse anything,
    as elsewhere (`kindConfirmed`); Kontroll already asks for the kind to
    be confirmed.
  - TR 7.4.3: "I öppen klass ska startordningen fri starttid tillämpas",
    and inskolning counts as an open class (TR 3.4.9). So at nivå 1–3 a
    confirmed open class or inskolning takes only "Fri start med
    startstämpling": the two drawn answers are refused, and a stored drawn
    answer shows as a conflict in Kontroll, in the same way as free start
    in an age class. At nivå 4 the organiser has a free hand (TR 3.3.1),
    and a training race is outside the levels: there every class may take
    any answer, so a training race can draw "Gul" to spread the start and
    still time from the start punch.
- **Defaults for a new class**, from the class kind (confirmed or
  suggested from the name): open and inskolning get `free_start`; an age
  class gets `start_time`; a class whose kind is unknown gets
  `start_punch`, which times a runner from whichever start exists, and
  Kontroll asks. The operator can change the answer within what the rules allow
  for the class and level.
- **Changing the answer changes times for the whole class**, also for
  runners already read out (the class is scored again). Lottning says so
  when the race has started. The answer is saved with the value the
  screen had seen, and the save is refused if someone else changed it in
  between.
- **Kontroll shortcut.** Before the race has started, a class with
  runners without a start time gets "Lotta klassen" (a link to Lottning)
  and "Fri start" (sets `free_start`, with a result line and "Ångra").
  "Fri start" is not offered where TR 7.4.2 forbids it. Once the race has
  started only the link is offered, since the change would rescore
  results. "Ångra" puts back the value that was stored before, and is
  refused if the answer was changed again meanwhile.
- **Older competitions.** Nothing stored is rewritten: no migration.
  `auto` stays a valid value with its per-runner meaning; no new class
  gets it, and the screen shows such a class as not chosen. An existing
  `start_punch` class keeps its times and is now a class with a start
  list in Kontroll's eyes; if it is a free-start class the operator says
  so with the shortcut.

### Consequences

- Good, because Kontroll no longer guesses: it lists a class only when
  its answer says the class has a start list (or the rules demand one).
- Good, because a drawn start list with time from the start punch is a
  named choice.
- Good, because a new start form is one more answer and one more stored
  value. (Booked free interval start also needs rule data the matrix
  does not have yet.)
- Bad, because `start_punch` changes meaning for Kontroll: an existing
  class with Startstämpling is now listed when a runner lacks a start
  time. That is the intended behaviour, but it is a change.
- Bad, because a new age class no longer falls back to the start punch
  for a runner without a start time: the result shows "saknar start" and
  no time until the runner gets a start time or the class another
  answer. Kontroll shows it before the race, and nothing is lost, since
  the punches are stored.
- Bad, because "Ångra" in Kontroll lives on the page only; it is not the
  lasting list of recent changes ADR-0016 rule 2 asks for. The answer is
  always visible and changeable in Lottning.
- Neutral: the setting stays in Lottning. A column on Tävlingsinfo
  (option E) can come later without changing the model.

### Confirmation

- Unit tests of the start rule for all four stored values, of Kontroll's
  "needs start times" rule and of the conflict row.
- Projection tests that a class keeping its stored value scores the same:
  time, status, place, "saknar start" and the late and early start
  warnings.
- The two-day replay (ADR-0014). An upgraded database must give identical
  results. The replay imports its classes afresh, so they get the new
  defaults: every difference from the baseline is listed and judged
  against the official result, not assumed away.
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
