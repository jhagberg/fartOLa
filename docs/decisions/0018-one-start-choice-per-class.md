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
Automatiskt, Starttid and Startstämpling. It says where the running time
counts from. Kontroll, the check before the race, reads the same setting
to decide whether the class needs start times, and that is another
question. Two things go wrong:

- With Startstämpling, Kontroll never lists the class, also when the
  organiser wants a start list that spreads the start at a training race.
- With Automatiskt, Kontroll lists every runner as soon as one runner in
  the class has a start time. One imported or hand-set time makes a
  free-start class look undrawn. In a local test on 2026-10-12, inskolning
  showed up as missing start times until it was drawn.

Automatiskt also decides per runner: the start time if the runner has
one, otherwise the start punch. The operator cannot see on the screen
which start a result runs from.

How does the operator say how a class starts, so that Lottning (the
draw), Kontroll and the results agree?

## Decision Drivers

- ADR-0016: the operator always sees what will happen, so a setting must
  not guess.
- ADR-0011: SOFT's rules decide. TR 4.18.16 allows the start punch as
  start method. TR 7.4.3 says an open class has free start time. TR 7.4.2
  forbids free start time in age classes at nivå 1–3.
- A competition already in the database keeps its results (ADR-0014).
- More start forms will come, such as booked free interval start, so the
  choice must be able to grow.

## Considered Options

- **A. Two settings per class**, as in MeOS and OLA: how the class gets
  start times, and where the time counts from.
- **B. One choice with three answers**, each saying both things.
- **C. No setting**: guess from how many runners have a start time.
- **D. Ask in Kontroll only**, when a class lacks start times.
- **E. A column in the class table on Tävlingsinfo.**

## Decision Outcome

Chosen option: **B, with D as a shortcut**. Only three combinations are
valid, because free start with time from the start time has no start time
to count from. One choice with three answers offers those three, and the
training case gets a name of its own.

### The three answers

The choice is called "Så startar klassen" and is stored in
`classes.start_method`.

| Answer                             | Stored        | Time counts from               | Kontroll lists runners without a start time  |
| ---------------------------------- | ------------- | ------------------------------ | -------------------------------------------- |
| Lottad starttid                    | `start_time`  | the start time                 | yes                                          |
| Lottad starttid och startstämpling | `start_punch` | the start punch, else the time | yes                                          |
| Fri start med startstämpling       | `free_start`  | the start punch, else the time | no                                           |
| (older competitions)               | `auto`        | the start time, else the punch | as today (listed once one runner has a time) |

### What the rules refuse

The refusals apply at nivå 1–3 and to a confirmed class kind. A kind that
is only suggested from the class name refuses nothing, as elsewhere in
fartOLa (`kindConfirmed`); the operator confirms the kind in Lottning.

- An age class cannot take free start (TR 7.4.2).
- An open class takes only free start. TR 7.4.3 reads "I öppen klass ska
  startordningen fri starttid tillämpas", and inskolning counts as an open
  class (TR 3.4.9).
- A class that has free start, or must have it, cannot be drawn.

At nivå 4 the organiser has a free hand (TR 3.3.1), and a training race
is outside the levels. There every class may take any answer, so a
training race can draw "Gul" to spread the start and still time from the
start punch.

A stored answer can become wrong later, when the kind is confirmed or the
level is set after the answer was chosen. fartOLa does not rewrite the
answer then, because that would change times. Kontroll lists the class as
a conflict until the operator picks an allowed answer, whether or not its
runners have start times. A class with no starting runner is not listed,
as in Kontroll's other class checks. An older open class without a choice (`auto`)
is such a conflict at nivå 1–3.

### Defaults for a new class

The default follows the class kind, confirmed or suggested from the
name, and for an age class also the level of the competition:

- Open classes and inskolning get free start.
- An age class at nivå 1–3 gets "Lottad starttid", which is what TR 7.4.2
  asks for: the start order is drawn, and a runner without a start time
  is not timed from the start punch.
- An age class at nivå 4, at a training race or with no level set gets
  "Lottad starttid och startstämpling". The organiser has a free hand
  there, and a small race that never draws its classes still gets a time
  for everyone who punched the start.
- A class of unknown kind gets "Lottad starttid och startstämpling" too.

The level is read when the class is created. Setting the level later
does not change classes that already exist. The operator can change the
answer within what the rules allow for the class and level.

### Changing the answer

A new answer changes the times for the whole class, also for runners
already read out, because the class is scored again. Lottning says so
when the race has started.

### The shortcut in Kontroll

A class with runners without a start time gets "Lotta klassen", a link
to Lottning. It also gets "Fri start", which sets free start, says what
it did and links to Lottning, where the answer can be changed again.

"Fri start" is offered only when nothing of the class can be rescored:
the race has not started, and no runner of the class has a card read, a
manual finish or a hand-set status. A withdrawn runner (Återbud, Ej
start) does not count, since nothing about that runner is timed. A race that was started and reset
keeps such data, so "not started" alone is not enough. The server decides
this, both when it builds the list and when it takes the click, so a page
left open cannot change results. Kontroll does not offer "Fri start"
where TR 7.4.2 forbids it.

### Older competitions

fartOLa rewrites nothing that is stored, so there is no migration. `auto`
stays a valid value with its per-runner meaning. No new class gets it,
and the screen shows such a class as not chosen. An existing class with
Startstämpling keeps its times, and Kontroll now treats it as a class
with a start list. If it is a free-start class, the operator says so with
the shortcut or in Lottning. Choosing free start does not remove start
times the class already has: they stay, and a runner without a start
punch is timed from them.

### Consequences

- Good, because Kontroll no longer guesses: it lists a class only when
  its answer says the class has a start list, or the rules demand one.
- Good, because a drawn start list with time from the start punch is a
  named choice.
- Good, because a new start form is one more answer and one more stored
  value. Booked free interval start also needs rule data that the rule
  matrix does not have yet.
- Bad, because Startstämpling changes meaning for Kontroll: an existing
  class with it is now listed when a runner lacks a start time. This is
  intended, but it is a change.
- Bad, because a new age class at nivå 1–3 no longer falls back to the
  start punch for a runner without a start time. The result shows "saknar
  start" and no time until the runner gets a start time or the class gets
  another answer. Kontroll shows it before the race, and the punches are
  stored, so nothing is lost.
- Neutral, because the shortcut has no undo of its own. The answer is
  a visible setting, and the operator changes it back in Lottning.
- Neutral, because the setting stays in Lottning. A column on
  Tävlingsinfo (option E) can come later without changing the model.

### Confirmation

- Unit tests of the start rule for all four stored values, of Kontroll's
  rule for which classes need start times, and of the conflict list.
- A class that keeps its stored value scores the same: time, status,
  place, "saknar start" and the late and early start warnings.
- The two-day replay (ADR-0014). An upgraded database must give identical
  results. The replay imports its classes afresh, so they get the new
  defaults. Each difference from the baseline is listed and compared with
  the official result.
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
- Neutral, because it is the same model in another place, and the first
  step does not need it.

## More Information

- MeOS: `FreeStart` skips the draw (oEventDraw.cpp:1123) and the report of
  missing start times (oReport.cpp:396). `IgnoreStart` turns the start
  punch off (oRunner.cpp:1226); otherwise the punch wins over a drawn
  time.
- OLA 6.6.2 (own observation 2026-10-12): Starttidsfördelning and
  Startmetod are separate settings per class. A class with Startmetod
  Stämpel can be drawn. OLA has no separate free-start choice.
- Plan: `.planning/phases/02.1-sanctioned-competition-foundations/02.1-15-START-CHOICE-PLAN.md`.
- Todo this replaces: `2026-10-10-open-classes-start-punch-by-default.md`.
