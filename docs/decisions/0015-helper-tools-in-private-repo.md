---
status: accepted
date: 2026-10-05
decision-makers: [Jonas Hagberg]
consulted: []
informed: []
---

# Helper tools live in a private repo; fartOLa stays the product

Decided 2026-10-04/05, recorded 2026-10-05.

## Context and Problem Statement

For the DM / Tuna Ting weekend (2026-10-03/04), several tools were built next to
MeOS, on fartOLa branches under `tools/`: `meos-capture` (records a MeOS server
during a competition), `meos-replica` (a live MySQL copy of the MeOS server with
failover), `kontroll` (a read-out view for course checkers), `skogis` (story
receipts for children) and the replay fixture generator (ADR-0014). They work
on real competition data, depend on MeOS, and are not part of the product.
Where should they live?

## Decision Drivers

- The product repo is public (AGPL). The tools handle real participant data
  and capture files.
- The product's dependency graph and CI should cover only the product.
- The tools need the SportIdent decoder (`@fartola/sportident`) without a
  publish step.
- Ideas proven in a tool (for example `kontroll` as a course-setting mode) can
  still graduate into the product.

## Considered Options

1. **`tools/` in the fartOLa monorepo.** Rejected: data and capture paths sit
   next to public code, and CI and dependencies grow with non-product code.
2. **A separate public repo.** Rejected: the tools handle real competition data,
   and some are prototypes.
3. **A private repo, `jhagberg/fartOLa-tools`, depending on
   `@fartola/sportident` through a linked checkout of fartOLa.** Chosen.
4. **Publish `@fartola/sportident` to npm first.** Deferred, not rejected. The
   link is enough until the package API settles.

## Decision Outcome

Chosen option: **3**. fartOLa contains only the product. The tools depend on
fartOLa, never the other way round. fartOLa may name a tools-repo format as an
input contract: the replay fixture format, read by `apps/edge/scripts/replay.ts`.
Features graduate into the product as normal planned work (todo → phase), not
by copying tool code.

### Consequences

- Good, because the public repo has no capture data or MeOS-specific operational
  scripts.
- Good, because `@fartola/sportident` (MIT, ADR-0005) gains a second consumer,
  which keeps its API honest.
- Bad, because a breaking change in `@fartola/sportident` can break the tools
  silently. There is no cross-repo CI.
- Bad, because the replay format is a cross-repo contract (ADR-0014). Its spec
  (`replay/README.md`) lives in the private repo.

### Confirmation

- `git ls-tree main` has no `tools/` directory, and fartOLa's `package.json`
  files have no dependency on the tools.
- Review: references to the tools repo in fartOLa are limited to input formats
  and todos (`apps/edge/scripts/replay.ts`, `.planning/todos/`).

## More Information

- Facts not verifiable from the fartOLa worktree, as stated by Jonas on
  2026-10-05: the repo name, the linked-checkout dependency and the list of
  moved tools.
- The local branches `feat/replay` and `feat/meos-capture` still contain
  `tools/`. They are not on origin.
- Related: [ADR-0005](0005-sportident-code-isolated-mit.md),
  [ADR-0014](0014-replay-real-competitions-as-acceptance-test.md).
