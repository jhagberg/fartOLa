---
status: accepted
date: 2026-10-05
decision-makers: [Jonas Hagberg]
consulted: []
informed: []
---

# Replay of real competitions as the acceptance test, with fixtures kept out of the public repo

Decided 2026-10-04, recorded 2026-10-05.

## Context and Problem Statement

Unit tests with hand-written fixtures passed while real data broke fartOLa:
punches after 12:00 came out 12 h off, classes shared courses, start times were
changed during the day, and some runners had no start. The only trustworthy
oracle is an official result from a real competition. That data is personal
(names, SI cards, birth dates), and fartOLa's repo is public (AGPL). How do we
test against reality without publishing participants' data?

## Decision Drivers

- Acceptance means "same status and running time as the official result",
  measured over a whole competition day.
- Fixtures must go through the normal import routes and the stored `card_read`
  path, not a side door.
- No real name, card number, birth date or Eventor id may enter the public repo.
- Intended differences (ADR-0011) must be separable from bugs.

## Considered Options

1. **Synthetic fixtures only.** Rejected: they did not catch the PM bit, shared
   courses, changed start times or missing starts.
2. **Real fixtures committed to the public repo.** Rejected: participants' data
   would be published.
3. **Anonymised fixtures from a MeOS capture plus Eventor's result list, kept in
   the private tools repo, replayed by a script in the product repo.** Chosen.

## Decision Outcome

Chosen option: **3**.

- The fixture generator (`replay` in the private `jhagberg/fartOLa-tools`,
  ADR-0015) takes a MeOS capture of the day plus Eventor's IOF 3.0 ResultList
  (the oracle). It writes `CourseData.xml`, `EntryList.xml`, `StartList.xml`,
  `readouts.ndjson` (`card_read` with the time MeOS got the card), `manual.ndjson`,
  `expected.json` and `manifest.json`.
- Anonymisation: names are invented and follow the runner's gender. Card numbers
  are remapped per card type, in a series that skips every real number. The
  order is shuffled with `crypto`, and the key is never stored. Birth dates,
  Eventor ids and contact details are dropped. The generator refuses to write if
  a real name or card number would leak.
- `apps/edge/scripts/replay.ts` (in the product repo) builds a real server,
  imports through the HTTP routes, inserts every read with its original time,
  runs the server's loader and reducer, and diffs the result against
  `expected.json` per runner. SOFT-intended differences are listed separately.
  `--meos-start` replays with MeOS's start rule.

### Consequences

- Good, because real-world failures become reproducible. DM 2026 day 1 went to
  633/634 equal. The remaining runner was set to MissingPunch by hand in MeOS
  without a read-out.
- Good, because no personal data enters the public repo.
- Bad, because outside contributors cannot run the real replay. Only the
  synthetic fixture is public.
- Bad, because the replay format is a contract between two repos. A change to
  it must land in both.

### Confirmation

- `apps/edge/scripts/replay.test.ts` runs in `pnpm test` with a synthetic
  fixture written by the test. It checks that a start-punch runner is reported
  as a SOFT difference, not a mismatch, and that `--meos-start` matches 4/4.
- The real replay is manual and is not a CI gate, because the fixtures are
  private: `FARTOLA_REPLAY_DIR=… pnpm --filter @fartola/edge exec tsx scripts/replay.ts`.
  It always exits 0. Run it before every release and after any change to
  projection or import. Record the "N/634 equal" line in the PR.

## More Information

- Plan: [02.1-14-REPLAY-READINESS-PLAN.md](../../.planning/phases/02.1-sanctioned-competition-foundations/02.1-14-REPLAY-READINESS-PLAN.md),
  Task 8 and Task 14 (`--meos-start`).
- Script: [replay.ts](../../apps/edge/scripts/replay.ts).
- Commits: `0e42222` replay script and `d0a0d7a` `--meos-start` (PR #51), `5257ead`
  read-out through the bridge (PR #53). Generator commits `be1f2d3` and `b5d6964` were
  made on the local branch `feat/replay` before the move to the tools repo.
- Related: [ADR-0011](0011-follow-soft-rulebook-over-meos-with-gated-rule-matrix.md),
  [ADR-0015](0015-helper-tools-in-private-repo.md),
  [ADR-0008](0008-pii-in-append-only-event-log.md).
