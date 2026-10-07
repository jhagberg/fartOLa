# Architecture Decision Records

Architecture Decision Records (ADRs) for fartOLa, in
[MADR 4.0.0](https://adr.github.io/madr/) format. An ADR records _why_ a
choice was made, not how it was implemented. Current project state lives in
`.planning/STATE.md`, and decision content lives here.

## How we write ADRs

- Copy [adr-template.md](adr-template.md) to `NNNN-kebab-case-title.md` with
  the next free number. IDs are never reused. See
  [ADR-0000](0000-use-markdown-architectural-decision-records.md).
- Keep each ADR readable in two minutes: context in 2–5 sentences, the options
  considered (with the reason each rejected one was rejected), the outcome,
  good and bad consequences, and how the decision is confirmed (a test, a lint
  gate or a review).
- Status values: `proposed`, `accepted`, `deprecated`,
  `superseded by ADR-NNNN`.
- Facts changed but the decision still holds: add an `## Update YYYY-MM-DD`
  section under the title and bump `date`. The decision itself changed: write a
  new ADR, and mark the old one `superseded by ADR-NNNN`. Never delete an ADR.
- Links to code and plans are relative from this directory (for example
  `../../apps/edge/src/server.ts`). Do not pin versions; point to
  `package.json`.
- Add a row to the index below in the same PR.

## Index

| ADR                                                                   | Title                                                                                         | Status   | Date       |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------- | ---------- |
| [0000](0000-use-markdown-architectural-decision-records.md)           | Use Markdown Architectural Decision Records                                                   | accepted | 2026-10-05 |
| [0001](0001-reimplement-do-not-fork-meos.md)                          | Do not fork MeOS; port selected parts with attribution                                        | accepted | 2026-10-06 |
| [0002](0002-three-tier-architecture.md)                               | Three-tier architecture: edge-bridge + browser + optional central                             | accepted | 2026-05-12 |
| [0003](0003-event-sourcing-as-core-data-model.md)                     | Event sourcing as the core data model                                                         | accepted | 2026-10-05 |
| [0004](0004-electricsql-is-read-sync-only.md)                         | ElectricSQL is used for read-sync only, not write-sync                                        | accepted | 2026-10-05 |
| [0005](0005-sportident-code-isolated-mit.md)                          | SportIdent protocol code isolated in MIT-licensed package                                     | accepted | 2026-10-05 |
| [0006](0006-tech-stack.md)                                            | Tech stack: Node.js + Fastify + SQLite + SvelteKit                                            | accepted | 2026-10-05 |
| [0007](0007-standards-first-interop.md)                               | Standards-first interop: IOF XML, Eventor, MeOS MIP/MOP, liveresultat                         | accepted | 2026-10-05 |
| [0008](0008-pii-in-append-only-event-log.md)                          | PII in append-only event log: scrub competitor row, not payload                               | accepted | 2026-10-05 |
| [0009](0009-eventor-runner-cache.md)                                  | Eventor löpardatabasen cached locally for walk-up autocomplete                                | accepted | 2026-05-16 |
| [0010](0010-event-admin-codes-trust-model.md)                         | Event admin codes and the LAN write gate: trust model, entropy, rate limits                   | accepted | 2026-10-05 |
| [0011](0011-follow-soft-rulebook-over-meos-with-gated-rule-matrix.md) | Follow SOFT's rulebook over MeOS defaults, tracked in a rule matrix that is a lint gate       | accepted | 2026-10-05 |
| [0012](0012-competition-time-on-local-wall-clock.md)                  | Competition time on the local wall clock; card clocks without DST arithmetic                  | accepted | 2026-10-05 |
| [0013](0013-meos-integration-requires-password.md)                    | MeOS integration (MIP/MOP) requires a password; open LAN access only as an explicit opt-in    | accepted | 2026-10-05 |
| [0014](0014-replay-real-competitions-as-acceptance-test.md)           | Replay of real competitions as the acceptance test, with fixtures kept out of the public repo | accepted | 2026-10-05 |
| [0015](0015-helper-tools-in-private-repo.md)                          | Helper tools live in a private repo; fartOLa stays the product                                | accepted | 2026-10-05 |
| [0016](0016-simple-clear-ui-not-meos-parity.md)                       | Own simple UI, not MeOS's: you always see what will happen and what did                       | accepted | 2026-10-06 |
