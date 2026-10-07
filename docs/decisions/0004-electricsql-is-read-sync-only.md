---
status: accepted
date: 2026-10-05
decision-makers: [Jonas Hagberg]
---

# ElectricSQL is used for read-sync only, not write-sync

## Update 2026-10-05: not built yet

Decided 2026-05-12 and still the plan, but nothing implements it yet: there
is no `electric` reference in `apps/` or `packages/`, and no central tier or
Postgres. The public read path today is the edge's own HTTP and WebSocket
API, plus pushes to liveresultat and Eventor.

The decision has two halves that land in different phases:

- **Phase 4 (multi-arena, peer sync):** edge↔edge sync is fartOLa's own
  append-only protocol, idempotent on `(node_id, local_seq)` (ADR-0003;
  architecture.md §"Synchronization model — corrected"). Electric is not
  used for it.
- **Phase 5 (O-ringen scale, central tier):** Electric is the candidate for
  the central→public-viewer read path. Re-check it against the then-current
  alternatives when the central tier is designed, and supersede this ADR if
  the choice changes.

The original text below is kept as recorded.

## Context and Problem Statement

ElectricSQL is marketed as a sync engine for Postgres ↔ clients. Does
it solve our edge-node-to-edge-node synchronization problem, or is it
narrower than that?

## Considered Options

- Use Electric for both edge↔central read flow AND edge↔edge peer sync
- Use Electric only for central→client read-sync; write our own
  edge↔edge protocol
- Don't use Electric at all

## Decision Outcome

Chosen option: **Electric is read-sync only**. Per the Electric docs,
it is a **read-path** sync engine (Postgres → clients via Shapes), not
a multi-master write-sync engine. The autonomous-field-node problem is
our responsibility: edge-bridges push events to each other and to
central via a custom append-only protocol, idempotent by
`(node_id, local_seq)`. Electric drives the public-viewer read flow,
where it excels (partial sync, SSE, reconnect).

## More Information

- Electric docs: <https://electric-sql.com>
- [architecture.md](../../.planning/research/architecture.md)
  §"Synchronization model — corrected".
- Related: [ADR-0003](0003-event-sourcing-as-core-data-model.md).
