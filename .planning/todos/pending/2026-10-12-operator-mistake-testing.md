---
created: 2026-10-12T17:30:00+02:00
title: Find what an operator can break by mistake - invariants, random walks, scripted slips, then agents
area: testing
files:
  - apps/edge/scripts/replay.ts
  - apps/edge/src/routes/dev.ts
  - apps/edge/src/projection/store.ts
  - apps/edge/src/projection/reduce.ts
  - tests/e2e/
---

## Why

On 2026-10-12 two clicks ("Återställ start", then "Starta tävling") made
623 of 631 read-outs stop counting on a test stack, with no warning and no
way back (fixed in PR 130). Seven more faults in the fix were found in
review. All eight had one shape: the ORDER of actions, or a confirmation
that outlived what it confirmed. None was a crash, and none would be found
by clicking at random and looking for errors.

Jonas asked whether many cheap agents could click around like an ordinary
user and find more of these. This is the plan. Its main point: an agent
finds only what something can recognise as wrong, so the checks come
first and the agents last.

## The checks (written as functions, run after every step)

1. No 5xx answer, no unhandled rejection, no error in the browser console.
2. Fresh equals cached: the projection the server holds for a competition
   equals one computed anew from the database. A difference is a write
   that forgot to mark the projection dirty.
3. Events alone equal events plus columns: reducing the event log from
   nothing gives the same state as the live one. A difference is state
   that lives in a column and not in the log (ADR-0003); PR 130 noted one
   such case with a read in the same millisecond as the start.
4. Nothing gets worse in silence: the number of runners with a result
   falls only through a request on a short list of destructive ones, and
   only when that request carried its confirmation.
5. Every destructive step has a way back that restores the same state
   (compare a hash of the projection before and after undo).
6. Twice is once: the same request sent twice leaves the same state as
   sent once (a double click, a retry after a lost answer).
7. Restart changes nothing: reopen the database, same projection.
8. A card read is stored exactly once and is never lost, whichever
   competition is active.
9. What goes out matches: the result export and MOP carry the same
   statuses and times as the projection.
10. The two private replay days still give 633/634 and 608/609 (ADR-0014).

## Layer 1: random walks on the API, no browser

The edge has about 60 writing routes. `scripts/replay.ts` already drives
the whole server in memory with `app.inject()`, and `routes/dev.ts` can
simulate reads and radio punches. Build a walker: from a seed it picks
writing requests with realistic bodies (start, reset, undo, import again,
change class, course, start method, max time, card number, active
competition, manual status and finish, delete a runner), applies them in
random order between simulated reads, and runs checks 1-9 after each. A
failure prints its seed and the shortest sequence that still fails, as a
test to paste in. Fast, repeatable, can run in CI on a small budget.

This is where the reset fault lived. Calibration: run the walker on the
commit before PR 130; it must find that fault, or the checks are too weak.

Agents: one stronger session designs the walker and the checks; cheap
agents are not needed to run it.

## Layer 2: the known slips, scripted in the browser

The faults found so far are a finite list of slips. One short Playwright
spec per slip and screen, from one template:

- double click on every confirm button;
- two tabs on the same screen, each acting on the other's stale view;
- reload, and browser back, with a dialog open or a save in flight;
- switch competition with a dialog or a confirmation open;
- the connection drops and returns in the middle of an action;
- a card is read while the Ändra dialog for that runner is open;
- import entries, courses or the start list over a competition that has
  reads;
- change a card number while a read for the old one waits;
- do the day in the wrong order (start before the draw, draw after
  reads, close and then read).

Screens: Avläsning, Direktanmälan, Anmälda and Ändra, Lottning, Kontroll,
Tävlingsinfo, Resultat, Export, Hyrbrickor, Kvar i skogen, Inställningar,
Speaker. Mechanical work: cheap agents (haiku) write the specs from the
template, one screen each; a stronger one reviews.

## Layer 3: agents as operators, last and bounded

Only when layers 1 and 2 exist. Each agent gets one screen, one role (a
stressed secretariat, the start crew, the speaker, a helper on a phone),
its own copy of a seeded database on its own port, and a fixed number of
steps. It drives the browser through a small command tool that, after
every step, prints what is on the page and the result of checks 1-9, and
records the steps so a failure can be replayed. The agent's job is to try
what a person would try; the checks decide what is a fault. Its report is
a filled-in form: steps, which check failed, what the screen said.

Bounds: at most ten agents per run and a few at a time (this machine made
tests time out at load 25); never on the stack Jonas tests by hand; a run
is stopped after its step budget.

## Triage (as on PR 130)

- An agent never certifies its own finding. The coordinator replays the
  recorded steps on a fresh database; only what repeats counts.
- Every confirmed finding becomes a failing test first, then a todo or a
  fix. The recorded steps of layer 3 turn into layer 2 specs.
- Findings written to the repo use made-up runners. The seeded database
  has real clubs and times and stays on the machine.

## Known obstacle

`pnpm e2e` could not run from the coordinator's desktop session on
2026-10-12: every API call from Playwright took 10 s there, also on
unchanged main, cause not found. Layer 1 does not need a browser. Layers
2 and 3 must run from a session where e2e works, or that fault is found
first.

## Order and cost

1. Checks and walker (layer 1): one session, about a day. Highest yield.
2. Slip specs (layer 2): the template, then a handful of cheap agents.
3. Operator agents (layer 3): the command tool, then runs of ten agents.
   Decide how many runs after seeing what layers 1 and 2 found.

## Status 2026-10-12: layer 1 is built

- Where: `apps/edge/scripts/walk.ts` (the script; its header has the
  commands), `walkWorld.ts` (server, fake clock, synthetic competition),
  `walkOps.ts` (the steps), `walkChecks.ts` (checks 1-9 and the lists they
  rest on), `walk.test.ts` (a fixed walk of 60 steps in `pnpm test`).
  Check 10 stays a manual replay (ADR-0014).
- Calibrated on the commit before PR 130 (`b923de3e`): five of six seeds
  met the reset fault within 250 steps, each shrunk to three steps (start,
  read, reset). That sequence is now a test.
- Found on main and fixed: a 500 for a class name that is taken; a new
  class, a runner entered without a card and a new course for a class did
  not reach the projection the server holds.
- Found and written down: a changed card number takes a read-out runner's
  result away (`2026-10-12-card-change-drops-result.md`). Fixed
  2026-10-13; the walk now also confirms such a warning at a later step
  (`loseConfirm`).
- Found 2026-10-13 and written down: a DQ set before the read-out keeps
  the punches, a DQ set after it does not
  (`2026-10-13-dq-before-read-keeps-punches.md`).
- Found again, already written down: the entry list twice
  (`2026-10-11-import-dedupe-cardless-runners.md`), the forced reset sent
  again after its undo and the read in the start's millisecond
  (`2026-10-12-race-phase-revision.md`).
- Not a check yet: results that get worse while the number of runners
  with a result stays the same (OK to MP after another course file, or a
  change of class).
