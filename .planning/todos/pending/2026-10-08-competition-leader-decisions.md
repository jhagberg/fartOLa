---
created: 2026-10-08T15:00:00+02:00
title: Decisions signed by the competition leader — re-reads after returning to the course, and more
area: readout
files:
  - apps/edge/src/routes/readout.ts
  - apps/edge/src/projection/reduce.ts
  - docs/decisions/0010-event-admin-codes-trust-model.md
---

## Problem

A runner read out with a missed last control, went back out, punched the
control and the finish again, and read out a second time. fartOLa (like
MeOS) silently lets the later read replace the first, so the result went
from Ej godkänd to Godkänd.

SOFT TR 8.2.11: "Tävlande som passerat mållinjen får inte utan
tävlingsledningens medgivande på nytt bege sig ut i tävlingsområdet före
tävlingens slut." So the second read counts only if the competition
leadership agreed. That is a judgement call for the competition leader,
not for the person at the readout desk, and it should be recorded.

## What

1. **A competition-leader role.** The competition stores who the
   tävlingsledare is, with a personal code of their own (same trust model
   as event codes, ADR-0010; amend that ADR or add one when built). The
   leader can sign decisions from any device on the network.
2. **Re-read that changes the status.** When a later read of the same card
   changes the status (e.g. Ej godkänd → Godkänd):
   - keep both reads;
   - show before and after (ADR-0016), with the pattern on the card
     (finish → control → finish again) highlighted;
   - the runner's result becomes **"Väntar på beslut"** (pending), citing
     TR 8.2.11;
   - the leader approves (the new read counts) or rejects (the first read
     stands); either way an event records who decided and when.

   The readout desk can tell the runner "go back if you want; I'll fetch
   the competition leader", and the leader decides when the runner reads
   out again.
3. **Results while a decision is pending:** shown as "under prövning";
   pushes to liveresultat stay provisional, and the final ResultList to
   Eventor is held until no decision is pending (same rule as unread
   cards).
4. **Other decisions** can use the same mechanism later: disqualification,
   approving runners at a broken control (TA till TR 7.6.2), protests.

## Tests

- Second read changing MP → OK creates a pending decision; both reads
  kept; result shows pending.
- Approve → new result; reject → first result; both logged with the
  leader's identity.
- Only the leader's code can decide; a readout operator cannot.
- Final Eventor push is refused while a decision is pending.
- A re-read that does not change the status needs no decision.
