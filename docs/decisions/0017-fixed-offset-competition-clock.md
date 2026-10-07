---
status: accepted
date: 2026-10-07
decision-makers: [Jonas Hagberg]
consulted:
  [
    'Codex, Fable 5.1 and Gemini 3 Pro (time model, 2026-10-05)',
    'Codex (review of feat/competition-clock, 2026-10-07)',
  ]
informed: []
---

# One fixed-offset competition clock per competition

Supersedes [ADR-0012](0012-competition-time-on-local-wall-clock.md).

## Context and Problem Statement

ADR-0012 put card clocks on a naive wall-clock timeline with no DST
arithmetic, which matches the stations and MeOS. Drawn starts, though, were
epoch ms converted through `Europe/Stockholm` civil time, which jumps at DST,
while SI stations keep the offset they were set to. A station time of
02:00:54 on 2026-03-29 therefore had no epoch, and #51 (`6fdad0c`) added a
second column, `competitors.start_wall_ms`, valid only while
`start_time_ms` was still the epoch it was written with. The draw and IOF
import did not clear it, so a stale override could still win; lists, print,
MOP and the competitor DTO read only the epoch, so in the spring hour they
could show a different start from the one scored. How should start times
relate to the card clocks?

## Decision Drivers

- The running time must equal what the station clocks measured.
- One stored representation per start, so no writer can leave a stale copy.
- Times that leave the system (IOF XML, Eventor, MOP) must be unambiguous,
  also in the hour repeated when DST ends.
- No second data migration of the start-time model (`migrate.ts` already left
  a ms-since-midnight model once).

## Considered Options

- **A. Keep #51:** epoch plus `start_wall_ms`, with the staleness rule every
  writer of `start_time_ms` must know.
- **B. Document the limitation:** drop `start_wall_ms` and accept that a
  spring-hour start cannot be entered.
- **C. Store every start on the competition clock** (ms after midnight of
  the competition date), Codex's and Gemini's preference.
- **D. Epoch everywhere, one fixed UTC offset per competition** for every
  timing conversion, Fable's proposal.

## Decision Outcome

Chosen option: **D**, because it is what a station is (a clock set once to a
fixed offset, as in MeOS `oEvent::convertTimes`), it keeps epoch as the only
stored type, and it needs no change of the start-time model. A fails the
second driver. B cannot time the runner: a start entered as 03:00 still
lands after a 02:30 finish. C needs D's offset anyway at every edge (export,
MOP, offset-free import), plus a second model migration and a database with
starts on one scale next to `event_time_ms` and `race_started_at_ms` on
another.

- Competition clock = epoch + offset. The offset is
  `competitionClockOffsetMin(date, competitions.clock_offset_min)`: the
  operator's override when set, else the zone's offset at local noon of the
  competition date. `COMPETITION_TZ` stays defined once, in
  `packages/shared-types/src/time.ts`.
- Card clocks are placed on the competition clock at the latest time not
  after the read plus 1 h of skew (SI5 within 12 h, others within 24 h) and
  returned as epoch. Running time = finish − start in epoch ms.
- Every timing conversion uses the offset: drawn and edited starts,
  missing-start suggestions, the read-out card and receipt, start lists, MOP
  `st` (tenths since midnight of the competition date on this clock, not
  wrapped at 24 h), IOF export with the offset written out
  (`2026-03-29T02:00:54+01:00`) and IOF times without an offset on import.
- Starts are defined on the competition clock. Changing the offset in force
  (`PATCH /api/competitions/:id` with `clock_offset_min`, or a `date` with
  another default) shifts every stored competitor start and class first start
  by the difference, so their clock times and the results stay the same.
- The server sends the offset with the data it formats (competition DTO,
  `/readout`, missing starts). The web never calls `Intl` for timing and
  shows the backend's running times instead of recomputing them.
- Civil, DST-aware conversion stays only for the calendar: event-code expiry
  (`routes/event-codes.ts`) and picking the default offset.
- Migration 0018 adds `competitions.clock_offset_min`. A TS data step in
  `db/migrate.ts` then moves every stored start onto the new clock, keeping
  the station time scoring used (`start_wall_ms` where it was in force, else
  the civil wall time of `start_time_ms`), and drops `start_wall_ms` in the
  same transaction.

### Consequences

- Good, because a start has one representation: the last writer of
  `start_time_ms` (draw, import, manual edit) is what scoring, lists, print,
  MOP and export use.
- Good, because a spring-hour station time is an ordinary epoch, and every
  exported instant is unique, also in the repeated autumn hour.
- Good, because the offset cache and the two-candidate conversion are gone.
- Bad, because the anchor can be wrong. Noon of the date matches a day race
  and a night race dated the evening it starts, but not a night race dated
  the day it ends, nor stations synced on the other offset. Running times
  stay right (card times and starts move together), but exported instants
  are an hour off until the operator sets `clock_offset_min`. MeOS has the
  same failure.
- Bad, because the card-clock skew tolerance is exactly 1 h, the DST delta,
  so a station on the other offset that also runs ahead has no margin; the
  override fixes that too.
- Bad, because existing databases are rewritten once: on a DST date the
  stored epochs of starts move so that their station times stay. The step
  runs in one transaction and only while `start_wall_ms` exists.
- Bad, because stations are assumed not to be re-synced during a multi-day
  event, and one time zone per installation is supported.

### Confirmation

- `packages/shared-types/src/time.test.ts`: the default offset on both DST
  days; 02:00:54 on 2026-03-29 as one instant at either offset; distinct
  autumn instants written with `+01:00`.
- `projection/halfDayClockMath.test.ts`, `projection/dnfMp.test.ts`: 02:50 →
  03:10 on 2026-10-25 is 20 min; 01:50 → 03:10 on 2026-03-29 is 80 min (also
  SI5); 23:50 → 00:10 is 20 min.
- `routes/missingStarts.test.ts`: check 01:59, suggested start 02:00:54,
  finish 02:30 → timed with `start_time_ms` alone; a redraw and an IOF
  StartList import after a manual start both win.
- `routes/export.test.ts`: autumn and midnight runs export one instant each;
  `clock_offset_min` +60 moves exported instants by an hour and leaves the
  running time unchanged, also for a drawn start, which keeps its clock time
  and raises no late-start warning.
- `db/migrate.test.ts`: migrating a 0017 database keeps a spring-night
  02:00:54 start at 29:06 against a 02:30 finish and a 01:50 → 03:10 run at
  80 min, and drops `start_wall_ms`.
- `routes/readout.test.ts`, `integrations/liveresultat/mopBuilder.test.ts`:
  the read-out payload carries scoring's timing and the offset; MOP `st` for
  00:05 the next day is 867000.
- Replays of DM dag 1 and Tuna Ting dag 2 (ADR-0014) are unchanged.

## More Information

- Todo `2026-10-05-competition-clock-fixed-offset` (removed when built) and
  the scratchpad analyses `codex-time-model.md`, `fable-time-model.md`,
  `gemini-time-model.md` (not in git).
- Code: [time.ts](../../packages/shared-types/src/time.ts),
  [halfDayClockMath.ts](../../apps/edge/src/projection/halfDayClockMath.ts),
  [migrate.ts](../../apps/edge/src/db/migrate.ts),
  [0018_competition_clock_offset.sql](../../apps/edge/drizzle/0018_competition_clock_offset.sql).
- Related: [ADR-0003](0003-event-sourcing-as-core-data-model.md),
  [ADR-0014](0014-replay-real-competitions-as-acceptance-test.md).
