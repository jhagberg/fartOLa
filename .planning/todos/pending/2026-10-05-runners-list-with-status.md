---
created: 2026-10-05T10:00:00+02:00
title: Runners list with status — row actions, live updates, 600+ runners
area: web
files:
  - apps/web/src/lib/screens/RunnersListView.svelte
---

## Problem

The runners list now has status filters from the projection (M2 4d:
Saknar starttid, Felstämplad, Ej utläst, Manuell status, Utan
tidtagning, with counts, `?status=` in the URL, a status pill on each
read-out row; `GET …/runner-status`, `screens/runner-status.ts`). What
is left is acting on what the filters find without leaving the list.

## What

- Row actions that already exist elsewhere: set start time, set status.
- Live via WS (today the statuses load with the page).
- Keep the list fast for 600+ runners (virtualised or paged).

Related: "Fastställ saknade starttider" (02.1-14 Task 15) covers the
end-of-race batch; this is the general view.
