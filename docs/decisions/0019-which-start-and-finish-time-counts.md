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
fartOLa reads only the main record today, so a runner who punches the
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

## Considered Options

1. **The first valid punch counts; every candidate is kept and shown;
   a change is a new event with a reason.**
2. The last punch counts (today's behaviour, and the main record's).
3. Do what OLA or MeOS does.
4. No default: every difference waits for the secretariat.

## Decision Outcome

Chosen option: 1, because it is the plain reading of TR 4.20.6 (the race
ends at the first finish punch; a later punch is after the race), it
keeps the drawn start time as TR 4.18.9 requires, and it leaves every
decision visible and reversible.

- **Finish:** the first valid finish punch of this race. A finish
  judge's decision goes first: a time at the line (TR 4.20.4) and the
  finish order at a mass or chasing start (TR 4.20.8).
- **Start:** with a drawn start time, the drawn time, unless a recorded
  organiser decision changes it (TR 4.18.9). In a start-punch class, the
  first valid start punch of this race. A start punch well after the
  drawn time is a late start: flagged, never counted silently (today:
  more than 60 s gives `late_start_ms`).
- **Valid** means this race and day, after the clear and check, and for
  a start inside the class's start window.
- **Kept:** the card-read event carries the main and reserve records for
  start and finish as read (time, fraction, station code, which record),
  never the card holder bytes of block 0. The library reports; the
  projection chooses.
- **Shown:** where they differ, the read-out and "Ändra" show every
  candidate, the one used and why. Conflicting or unreasonable times
  (first and last differ, finish before the last control, a late start)
  are marked for review.
- **Changed:** the secretariat picks another candidate or enters a time,
  with a reason. That is a new event (`manual_finish_set` and its kin);
  it records the node and event code (ADR-0010), and is undone by a
  further event.
- **One time:** results, lists and every export use the decided time.
- **Re-reads:** a new read-out adds data and never removes earlier data
  or a manual decision.

### Consequences

- Good, because a double finish punch no longer gives a later time
  without anyone seeing it.
- Good, because each result can be traced to a record or a decision.
- Bad, because it changes results for runners who punched twice: the
  default changes only after the DM and Tuna Ting replay (ADR-0014) and
  the maintainer's decision.
- Bad, because reads stored before the reserve records are kept have no
  first punch; they keep today's behaviour.
- Neutral: "first after a clear" is not always "first of this race" (a
  test punch, a training lap without a clear); that is why the choice is
  shown and changeable.

### Confirmation

- Rows in `.planning/compliance/soft-regelverk-2026.md` for TR 4.18.9,
  TR 4.18.16, TR 4.20.6 and TR 4.20.8 name the tests (lint gate).
- An operator-mistake walker invariant: read, correct the finish, read
  again; the decision stands.
- The replay of both competition days before the default changes.
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
  OLA's behaviour is being observed in the lab and informs the screens,
  not the rule.

### 4. No default

- Good, because no time is ever chosen by the program.
- Bad, because every double punch stops the read-out queue; most have
  an obvious answer.

## More Information

- Build order: `.planning/todos/pending/2026-10-13-sportident-answers-follow-up.md`, item 1.
- Red exit and card memory view: `.planning/todos/pending/2026-10-14-readout-red-exit-and-card-memory-view.md`.
- Reserve record layout: SPORTident's data structure document (provided
  on request) and Thomas's answers of 2026-10-13.
- Start choice per class: ADR-0018.
