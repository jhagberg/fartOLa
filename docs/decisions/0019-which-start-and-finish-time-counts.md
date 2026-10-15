---
status: proposed
date: 2026-10-14
decision-makers: [Jonas Hagberg]
consulted: ['SPORTident (Thomas), 2026-10-09 and 2026-10-13', 'SOFT (question drafted 2026-10-14)']
informed: []
---

# Which start and finish time counts: the first valid punch, every candidate kept, decisions as events

## Context and Problem Statement

A SIAC keeps two records each for start and finish: a reserve record,
written by the first punch after a clear and never overwritten, and the
main record, which holds the last one (SPORTident, Thomas, 2026-10-13).
The library now reports both in the card-read event (`start_first`,
`finish_first`), but the projection still takes only the main records
into the read history and the result, so a runner who punches the
finish twice is timed to the later punch and nothing shows it. The rules
do not mention the records: TR 4.20.6 (2026-07-01, same as 5.7.5 in 2022) times the runner when they end the race by punching the finish
unit, and TR 4.18.9 keeps the drawn start time for a runner who is late
by their own fault. Which punch counts, who may change it, and how is
that kept?

## Decision Drivers

- SOFT's rules over any program's default (ADR-0011).
- A result must be explainable afterwards: which punch, why, and who
  changed it.
- The event log is append-only (ADR-0003); originals are never edited.
- A new read-out must not silently undo a person's decision.
- No personal data we do not need (ADR-0008).
- The class's start choice (ADR-0018) decides where the time runs from;
  this ADR must not change that by the back door.

## Considered Options

1. **The first valid punch counts; every available candidate is kept
   and shown; a change is a new event with a reason.**
2. The last punch counts (today's behaviour, and the main record's).
3. Do what OLA or MeOS does.
4. No default: every difference waits for the secretariat.

## Decision Outcome

Chosen option: 1, because it is the plain reading of TR 4.20.6 (the race
ends at the first finish punch; a later punch is after the race), it
leaves the start source to the class's start choice, and it leaves every
decision visible and reversible.

### Start: the class's start choice decides the source

This ADR changes only which punch is "the start punch" (the first valid
one instead of the last). Where the time runs from stays as ADR-0018
decided:

| Start choice  | Start, before any manual decision                                 |
| ------------- | ----------------------------------------------------------------- |
| `start_time`  | the stored start time; without one, no start. Punches are ignored |
| `start_punch` | the first valid start punch; without one, the stored start time   |
| `free_start`  | as `start_punch`; no draw required                                |
| `auto` (old)  | the stored start time if there is one, else the first valid punch |

- A punch more than 60 s after the start time is flagged as a late start
  where the time runs from the start time (`start_time`, `auto` with a
  time). The 60 s is a product threshold for review, not a rule.
- TR 4.18.9 (own fault: the original time; organiser's mistake: a new
  time) is applied by a recorded decision, never by "the latest punch
  wins". Whether a late punch in a `start_punch` class should keep the
  drawn time is open: it is asked of SOFT, and a different answer is a
  new decision that supersedes that row of ADR-0018.

### Finish: two separate decisions

- **Time:** the first valid finish punch. A time taken at the line
  (TR 4.20.4, 4.20.6) goes before the punch.
- **Order:** at a mass or chasing start the finish judge's order decides
  places (TR 4.20.8), including a dead heat. It is its own decision,
  stored next to the times; times are never altered to make a sort come
  out right.

### Candidates

- **Available, not historical:** a candidate is a record the card still
  holds (main or reserve). A card that was punched three times keeps
  only the first and the last; the middle punch is gone and is never
  invented.
- **Own metadata:** each candidate keeps its own time, fraction, station
  code and which record it came from, as read. What was not read or is
  not known (a reserve code when CN holds a fraction, the contact/AIR+
  mode of the first punch) is stored as unknown, never copied from the
  main record. Open questions to SPORTident stay open.
- **Missing is not the same as equal:** a reserve record that is empty,
  or a block that was not read, means "first punch unknown"; the main
  record is then used and marked as such.
- **Valid** is evidence, not a hard rule: the same race (day and
  half-day resolved for the whole sequence, so a night race over
  midnight works), clear and check, and the class's start window are
  signals. A missing clear or check does not invalidate a race; a
  contradiction (a finish before the last control, a start long outside
  the window) is marked for review. A late start allowed by an official
  is a recorded decision.
- **Compared before rounding**, and by code and origin as well as time.

### Kept, shown, changed

- **Kept:** the card-read event carries the candidates as read. It never
  carries the card holder data, neither the bytes of block 0 nor the
  decoded text (old events keep their `card_holder` field unless a
  separate decision says otherwise). Read-out may still suggest the
  name for a walk-up entry of an unknown card: the bridge keeps it in
  memory only, so a restart forgets it.
- **Shown:** where candidates differ, the read-out and "Ändra" show
  every candidate, the one used and why. Conflicts are marked for
  review.
- **Changed:** the secretariat picks another candidate or enters a time.
  Picking a candidate names the read and the record chosen, with a
  reason. Entering a time (no card, a time at the line, a station's
  backup) gives the time, its source and a reason; it needs no card
  record. Either is a new event that records the node and event code
  (ADR-0010) and is undone by a further event.
- **One result:** results, lists and every export use the decided time
  and, where one is set, the decided finish order.
- **Re-reads and rebuilds:** a new read-out adds data and never removes
  earlier data or a manual decision. A decision stands until it is
  withdrawn; after that the automatic choice comes from the right active
  read. The same holds after a projection rebuild and a race reset.
- **Which read is active:** the latest read of the runner's card for
  this race, as today. Its candidates decide; an older read's
  candidates do not mix in. Example, once the default has changed: an
  old read without reserve data gives 30:05, a new read shows a first
  finish of 30:00, so the result is 30:00, and because a re-read changed
  the result it is marked for review.

### Consequences

- Good, because a double finish punch no longer gives a later time
  without anyone seeing it.
- Good, because each result can be traced to a record or a decision.
- Bad, because it changes results for runners who punched twice: the
  default changes only after the DM and Tuna Ting replay (ADR-0014) and
  the maintainer's decision. Until then the candidates are reported and
  shown, and the result is unchanged.
- Bad, because reads stored before the reserve records were kept have no
  first punch: while such a read is the active one, the main record
  counts as today. A later read with reserve data takes over as the
  active read.
- Neutral: "first after a clear" is not always "first of this race" (a
  test punch, a training lap without a clear); that is why the choice is
  shown and changeable.

### Confirmation

- The acceptance cases in item 1 of the SPORTident answers todo, as
  behaviour tests; the rule matrix rows for TR 4.18.9, TR 4.18.16,
  TR 4.20.6 and TR 4.20.8 name them. The lint gate does not replace them.
- An operator-mistake walker invariant: read, correct the finish, read
  again; the decision stands.
- The replay of both competition days and the maintainer's decision
  before the default changes. Merging this ADR does not accept it.
- SOFT's answer on TR 4.20.6: if they read it as the last punch, this
  ADR is superseded.

## Pros and Cons of the Options

### 2. The last punch counts

- Good, because it is today's behaviour and needs no change.
- Bad, because the runner's time includes time after they ended the
  race (TR 4.20.6), and the earlier punch is invisible.

### 3. Do what OLA or MeOS does

- Good, because organisers know it.
- Bad, because a program's default is not the rule (ADR-0011); MeOS's
  default start punch already breaks TR 4.18.9 (`.planning/compliance/meos-jamforelse.md`).

### 4. No default

- Good, because no time is ever chosen by the program.
- Bad, because every double punch stops the read-out queue; most have
  an obvious answer.

## More Information

- Build order and acceptance cases: `.planning/todos/pending/2026-10-13-sportident-answers-follow-up.md`, item 1.
- Red exit and card memory view: `.planning/todos/pending/2026-10-14-readout-red-exit-and-card-memory-view.md`.
- Reserve record layout: SPORTident's data structure document (provided
  on request) and Thomas's answers of 2026-10-13.
- Start choice per class: ADR-0018. Current start rule:
  `apps/edge/src/projection/dnfMp.ts` (`startSource`).
