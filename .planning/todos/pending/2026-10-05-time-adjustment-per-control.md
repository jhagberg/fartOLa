---
created: 2026-10-05T02:00:00+02:00
title: Time adjustment per control — correct a station whose clock was wrong
area: readout
files:
  - apps/edge/src/projection/reduce.ts
  - apps/edge/src/routes/courses.ts
---

## Problem

Running times come from the SI card: the clocks of the start, control and
finish stations (12-hour clock, no date, no DST; stations do not switch to
winter time by themselves). If a station's clock is wrong — set to the wrong
time, drifted, or reset during the night (e.g. at the DST change on an
overnight relay) — every punch from that station is off by the same amount,
and so is every running time measured against it. Today fartOLa has no way to
correct that short of editing runners one by one.

## How MeOS does it

`oControl.TimeAdjust` ("Tidsjustering"): a signed offset per control that is
added to every punch from that control when the card is evaluated. It is set
in the control dialog (`TabControl.cpp`, around line 261) and MeOS keeps the
card's raw punches unchanged, so the adjustment can be changed or removed
later. All times are wall-clock seconds from the zero time; there is no DST
handling at all (`oEvent::convertTimes`, `oEvent.cpp:4744`).

## What

- A course-wide event `control_time_adjusted { control_code, offset_ms }`
  (event-sourced, reversible by a new event with offset 0), applied in the
  reducer to every punch with that code — including start (code of the start
  unit / start punch) and finish — before status and running time are worked
  out. The raw card data stays untouched.
- Route under `/api/competitions/:id/controls/:code/time-adjust` (operator /
  event-code gated like other competition writes) and a field in the course
  view: "Tidsjustering (± mm:ss)" with a note on which runners it affects.
- Helper: show, per station, how its punches compare with radio/online
  punches or with the readout laptop's clock, so a wrong clock is easy to
  spot (radio punches carry the station time and arrive within ~1 s).
- Results recomputed and pushed (projection markDirty) when it changes.

## Rules

SOFT Regelverk för OL 20260701_2 TR 4.20.10: results must be based on the
whole-course time and may not be constructed from split times. Correcting a
station clock is not constructing a result from splits — it restores the
real time of the punch — but record the reason with the adjustment and show
it in the audit trail.

## Tests

- A finish station 1 h fast: +(-1 h) adjustment → every runner's time back to
  the real value; removing it restores the original.
- An adjustment on one control moves only that control's punch (split order
  and MP detection unchanged unless the order actually changes).
- Replay: no adjustment → DM dag 1 / Tuna Ting dag 2 unchanged.
