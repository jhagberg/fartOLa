---
created: 2026-10-09T09:00:00+02:00
title: Max-time route test fails between about 08:00 and 08:12 local time
area: tests
files:
  - apps/edge/src/routes/competitions.test.ts
---

## Problem

`competitions.test.ts` "SOFT TR 4.21.1: via the routes, the competition max
time decides MAX in every class, over a class value" (line ~486) fails every
run between about 08:00 and 08:12 local time and passes otherwise. Its card
times are pinned to 09:00-09:11:40, but the read is stamped with the current
time, so in that window the finish lands on the wrong day. Seen 2026-10-09
(it passed again at 08:13).

## Fix

Pin the read time too (inject the clock or pass an explicit `eventTimeMs`
after the pinned finish), so the test does not depend on when it runs.
Check other route tests for the same pattern (card times fixed, read time
`Date.now()`).
