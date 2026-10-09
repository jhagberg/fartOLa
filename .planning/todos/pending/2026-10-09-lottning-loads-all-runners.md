---
created: 2026-10-09T08:00:00+02:00
title: LottningView reloads every runner of the competition on each class change and edit
area: performance
files:
  - apps/web/src/lib/screens/LottningView.svelte
  - apps/edge/src/routes/lottning.ts
---

## Problem

`loadStartList` in LottningView calls `listCompetitors` for the whole
competition to find the selected class's runners (for the preview count,
the late entrants and the seeding fields). It runs on every class change,
after every draw and after every hand edit of a start time. Fine at a club
training; on a large event (thousands of runners) each step downloads the
whole list again and the screen feels slow.

## What

- Return the class's runners (id, name, club, start time, seed group) from
  GET `/api/competitions/:id/lottning/:classId`, which already loads the
  class, and drop the `listCompetitors` call from LottningView.
- Keep the route test and LottningView's component tests green.

## Done when

LottningView makes no whole-competition request when changing class or
after a draw or edit, and a test shows the class's runners come from the
lottning route.
