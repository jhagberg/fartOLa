---
created: 2026-10-03T13:00:00+02:00
title: Banutsättningsläge — check that every control is out and working
area: readout
files: []
---

## What

A mode in fartOLa for course setters and checkers: read their cards at the
readout and reconcile against the competition's own courses — which controls
have been punched (= placed and working), which are still missing, and which
courses each missing control belongs to.

## Why

Tried live at DM lång / Tuna Ting 2026-10-03 as `kontroll` in fartOLa-tools (standalone,
facit from the MeOS database). Organisers liked it: a direct "all controls
out?" answer instead of reading paper strips. In fartOLa the facit comes from
our own course data, no MeOS needed.

## Notes from the field

- Checkers carry all kinds of cards: SI6 and SI8 were unsupported until the
  same day (now in `@fartola/sportident`).
- Cards without reliable AM/PM (SI5, SI6) need times kept rising per card.
- A control counts as checked if any of its codes was punched.
- Idea: compare each control's punch time with the readout clock to flag a
  station whose clock is wrong before the race starts.
