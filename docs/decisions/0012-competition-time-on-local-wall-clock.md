---
status: superseded by ADR-0017
date: 2026-10-07
decision-makers: [Jonas Hagberg]
consulted: ['Codex (review of PR #51, findings 8 and N3)']
informed: []
---

# Competition time on the local wall clock; card clocks without DST arithmetic

> Superseded by [ADR-0017](0017-fixed-offset-competition-clock.md) (2026-10-07): one fixed-offset clock per competition.

Decided 2026-10-04/05, recorded 2026-10-05.

## Context and Problem Statement

An SI card stores a 12-hour clock: SI6 and later cards add a PM bit, SI5 has
none. There is no date or time zone, and SI stations do not switch to daylight
saving time. IOF files may carry times without an offset. The event log stores
`ts_ms` as epoch. Our first attempts converted every card clock to an epoch
instant using the UTC offset at that punch (`65ee7f8`), and then resolved a
card's clocks together across the repeated autumn hour (`00bbddb`). Both gave
wrong running times on DST nights: on 2026-03-29, a station run from 01:50 to
03:10 came out as 20 min instead of 80. Both also needed fragile handling of
candidate times. MeOS has no DST handling: every time is seconds from zero time
on the local wall clock, wrapping at 24 h. How should fartOLa represent
competition time?

## Decision Drivers

- The running time must equal what the station clocks measured. The hardware
  clock is the truth, and the station did not jump.
- Results must agree with MeOS on DST weekends (ADR-0011, ADR-0014).
- The competition time zone is defined in exactly one place.
- Times that leave the system (IOF XML, Eventor, liveresultat, MOP) must be
  unambiguous.

## Considered Options

1. **Epoch everywhere, converting each card clock with the offset in force at
   that punch** (`65ee7f8`). Rejected: wrong across the spring switch, because
   the station did not jump. Times in the repeated autumn hour have two
   candidate instants.
2. **Option 1, plus resolving all of a card's clocks as one sequence**
   (`00bbddb`). Rejected: it fixes the autumn ordering, but spring is still
   wrong and the code is complex.
3. **Card clocks on a naive local wall-clock timeline, with epoch only at the
   boundaries.** Chosen.
4. **UTC station clocks.** Rejected: clubs set stations to local time, and
   MeOS assumes local time.

## Decision Outcome

Chosen option: **3**, because it matches both the hardware and MeOS, and it
removes the DST special cases instead of adding more.

- `COMPETITION_TZ = 'Europe/Stockholm'` is defined once in
  `packages/shared-types/src/time.ts`. The edge re-exports it from
  `apps/edge/src/time/competitionClock.ts`. No other file hard-codes an offset.
- Start times are stored as epoch ms (`competitors.start_time_ms`). IOF times
  without an offset are read as Stockholm local time. Event `ts_ms` stays epoch:
  it is when the bridge received the event.
- To compute elapsed time, each card clock is placed on the wall-clock timeline
  at the latest wall time not after the read's wall time plus 1 h of skew. SI5
  clocks must fall within 12 h of the read, other cards within 24 h. Drawn
  starts are moved onto the same timeline (`epochToWallClockMs`), and running
  time = finish − start there.
- Conversion back to epoch happens only where a time leaves the projection: the
  suggested start for missing starts, and the finish used when those starts are
  applied. IOF and MOP use the drawn start, which is already epoch.
- A start entered as a wall-clock time inside the skipped spring hour (for
  example 02:00:54 on 2026-03-29) has no civil epoch. It is kept in a second
  column, `competitors.start_wall_ms` (`6fdad0c`), which scoring uses while
  `start_time_ms` is still the epoch it was written with. This is a bridge, not
  the target model (see Planned change).

### Consequences

- Good, because running times match the station clocks and MeOS on both DST
  nights. Replay results outside DST are unchanged.
- Good, because the code is simpler: `2e2c376` removed about 110 lines net and
  the candidate-instant logic.
- Bad, because station clocks must show local time on race day, as with MeOS. A
  station that keeps the old offset after a DST switch will be one hour off
  against the start list. fartOLa does not detect this.
- Bad, because drawn starts go through civil time (which jumps) while card
  clocks do not, so start times have two representations. Known gaps: the
  draw and IOF import do not clear `start_wall_ms`, and lists, print and MOP
  read only the epoch.
- Bad, because only one time zone per installation is supported. Multi-zone
  events would need a per-competition zone.

### Confirmation

- `projection/halfDayClockMath.test.ts` and `projection/dnfMp.test.ts`:
  `2026-10-25: station clock 02:50 → 03:10, read 03:15 CET → 20 min`,
  `2026-03-29: station clock 01:50 → 03:10, read 03:20 CEST → 80 min`, the same
  run on SI5, and the round trip through `epochToWallClockMs` in the repeated
  hour.
- Code review: no new code computes elapsed time from epoch card clocks or
  hard-codes an offset.

## Planned change

Asked Codex, Fable 5.1 and Gemini (2026-10-05) whether to keep the two
columns, drop them, or store every start on the competition clock. The next
step is one **fixed UTC offset per competition** (the zone's offset at local
noon of the competition date, with an operator override): epoch stays the
only stored type, every timing conversion uses that constant instead of the
DST-aware zone, and `start_wall_ms` goes away. This matches what a station
is: a clock set once to a fixed offset. It will supersede the conversion part
of this ADR when built. Todo: `2026-10-05-competition-clock-fixed-offset.md`
(built and removed; see [ADR-0017](0017-fixed-offset-competition-clock.md)).

## More Information

- Commits (PR #51): `ef3f6e1` start times as epoch on a
  competition clock, `9529cb1` offset-free IOF times as Stockholm local,
  `65ee7f8` and `00bbddb` (the rejected approaches), `2e2c376` wall-clock
  timeline.
- Plan: [02.1-14-REPLAY-READINESS-PLAN.md](../../.planning/phases/02.1-sanctioned-competition-foundations/02.1-14-REPLAY-READINESS-PLAN.md),
  Tasks 1 and 3.
- Code: [time.ts](../../packages/shared-types/src/time.ts),
  [halfDayClockMath.ts](../../apps/edge/src/projection/halfDayClockMath.ts).
- MeOS reference (read for behaviour, ADR-0001): `oEvent::convertTimes`.
- Related: [ADR-0003](0003-event-sourcing-as-core-data-model.md).
