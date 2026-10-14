---
created: 2026-10-14T14:00:00+02:00
title: Replace the clickable prototype on the project site with the real app on recorded data
area: docs, web
files:
  - docs/demo/
  - docs/index.html
  - apps/web/src/demo/
  - apps/web/vite.demo.config.ts
---

`docs/demo/` is the React prototype from phase 1.5, a design sketch with
its own made-up data. It was last changed on 2026-10-10 and no longer
shows the app: design-lab's redesigns (plans 1-3) are in the Svelte app
only. One screen goes the other way: the prototype's results page has
the liveresultat-style class tabs that the app does not have yet
(`2026-10-12-results-screen-like-liveresultat-beta.md`).

Do what the speaker demo does (PR 131): build the app's own screens with
a recorded day of invented names and clubs and moved times, played back
in the browser, built by the Pages workflow so it cannot fall behind.

- In steps, one screen at a time: results, readout, lottning, runners.
  Keep the prototype linked until the replacement covers its screens,
  then remove it.
- Writes have no server: either a read-only demo, or an in-browser
  store that resets on reload. Decide per screen.
- Same data rules as the speaker demo: nothing real in the public repo.
