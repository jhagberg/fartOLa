---
created: 2026-10-05T10:45:00+02:00
title: One competition clock — fixed offset per competition, drop start_wall_ms
area: timing
files:
  - packages/shared-types/src/time.ts
  - apps/edge/src/projection/halfDayClockMath.ts
  - apps/edge/src/projection/dnfMp.ts
  - apps/edge/src/projection/reduce.ts
  - apps/edge/src/db/schema.ts
---

## Problem

Start times are epoch ms (`competitors.start_time_ms`); card clocks are on
a naive local wall-clock timeline. The two are joined through
`Europe/Stockholm` civil time, which jumps at DST, while SI stations keep
the offset they were set to. So a station time of 02:00:54 on the spring
night "has no epoch", and #51 (6fdad0c) works around it with a second
column `competitors.start_wall_ms`, valid only while `start_time_ms` is
still the epoch it was written with.

Known gaps in that workaround (Codex, 2026-10-05):

- Lottning and IOF import write `start_time_ms` without clearing
  `start_wall_ms`. A redraw to civil 03:00:54 gives the same epoch as an
  old 02:00:54 override, so the stale override still counts.
- Lists, start-list print, MOP and the competitor DTO read only the epoch;
  scoring and the ResultList export use the wall value. In that spring
  hour they can show a different start from the one scored.

## Decision so far

Asked Codex (gpt-6.1-sol, xhigh), Fable 5.1 and Gemini 3 Pro. All three: keep
#51 as it is (option A), reject "document the limitation" (B: a start
entered as 03:00 still lands after a 02:30 finish). Codex and Gemini
favour C (store all starts on the competition clock); Fable favours D
below. Codex's "clock anchor" and Fable's offset are the same idea; D gets
it without a data migration or mixed time scales in the database.
Recommended: D. Answers: scratchpad `codex-time-model.md`,
`fable-time-model.md`, `gemini-time-model.md` (not in git).

## What (option D)

- Keep epoch ms as the only stored type for every timestamp.
- Competition clock = epoch + one constant offset per competition: the
  zone's UTC offset at local noon of `competitions.date`, with a nullable
  `competitions.clock_offset_min` as an operator override (for a night
  race dated the day it ends, or stations synced on the other offset).
- Every timing conversion uses that constant: card-clock placement, drawn
  starts, missing-start suggestions, receipts, MOP `st` (tenths), IOF
  export (`2026-03-29T02:00:54+01:00`), offset-less IOF import. Civil,
  DST-aware conversion stays only where the calendar matters
  (`routes/event-codes.ts` expiry).
- Migration: drop `start_wall_ms`, add `clock_offset_min`. No data
  conversion; stored epochs stay valid. Delete `drawnStartWallMs`, the
  `start_wall` wire format, the offset cache and the two-candidate logic.
- The server sends the offset in the competition DTO; the web formats
  with it and never calls Intl for timing.

Rejected: C (all starts as ms after the competition date's midnight).
Still needs the same offset at every edge, plus a second data migration
(`migrate.ts` already left a ms-since-midnight model once) and a database
with starts on one scale next to `event_time_ms`/`race_started_at_ms` on
another.

## Tests

- Spring night: check 01:59, suggested start 02:00:54, finish 02:30 →
  timed, one column (`missingStarts.test.ts` acceptance as written).
- Autumn night: 02:50 → 03:10 station time is 20 min; export gives one
  unique instant.
- Midnight: 23:50 → 00:10 is 20 min.
- Redraw / IOF import after a manual start: no stale value can win.
- Override: night race dated the Sunday it ends → set +60 → exported
  instants right, running times unchanged.
- Replay: DM dag 1 / Tuna Ting dag 2 unchanged.

## Main risk

The wrong anchor. Running times stay right (a pure shift), but exported
instants are an hour off until the override is set — the same failure
MeOS has. `CLOCK_SKEW_TOLERANCE_MS` is exactly 1 h, the DST delta, so a
station on the other offset running ahead has no margin; the override
fixes that too.
