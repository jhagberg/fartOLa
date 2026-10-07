---
status: accepted
date: 2026-10-05
decision-makers: [Jonas Hagberg]
---

# Event sourcing as the core data model

## Update 2026-10-05

The decision of 2026-05-12 stands, with its scope stated as built:

- **The event log** (`events`, primary key `(node_id, local_seq)`, made
  append-only by triggers in `apps/edge/drizzle/0001_append_only_triggers.sql`)
  holds hardware facts and operator _decisions_ about a run: `card_read`,
  `card_bound`, `race_started`/`race_reset`, `manual_status_set`/
  `clear_manual_status`, `control_voided`, `leg_voided`, `consent_confirmed`
  and others.
- **Registration and configuration are mutable rows**, not events:
  competitions (including `max_time_sec`), classes (including `start_method`),
  courses, controls and competitors (including `start_time_ms`). This follows
  Phase 1 D-09, CRUD config tables. Reducers read the current rows. Recomputing
  therefore re-derives results against _current_ configuration, not against
  history: a start time changed during the race leaves no event or audit trail.
- **Yjs was never adopted.** It was deferred to Phase 2.2+ (ROADMAP, 2.1 rescope
  2026-05-23). There is no collaborative form editing today.
- The edge↔edge and edge→central sync protocol, idempotent on
  `(node_id, local_seq)`, is not built yet (Phase 4; see ADR-0004).
- Time: event `ts_ms` is epoch. Elapsed time is computed on the competition's
  fixed-offset clock (ADR-0017, which superseded ADR-0012).

The original text below is kept as recorded.

## Context and Problem Statement

MeOS-era systems store mutable result tables and have no clean recovery
from corrupt state under tournament pressure. Multi-node collaboration
and offline-first operation are bolted on. What data model makes those
properties native?

## Considered Options

- Mutable normalized schema (like MeOS / OLA)
- Event-sourced log with deterministic projections (reducers) for all
  derived state
- CRDT-everywhere (Automerge / Yjs for every entity)

## Decision Outcome

Chosen option: **event-sourced log**, because every punch is naturally
an immutable event keyed by `(node_id, local_seq)`. All derived state
(results, splits, placements, DNF, class standings) is computed by
stateless reducers. Bugs are fixed by updating the reducer and
recomputing — no corrupt state to repair. CRDT-everywhere was rejected
because the event log is conflict-free by construction; Yjs is retained
only for editable forms where genuine concurrent edits exist.

## More Information

- See REQ-EVT-001..007 in
  [REQUIREMENTS.md](../../.planning/REQUIREMENTS.md).
- Schema in [architecture.md](../../.planning/research/architecture.md)
  §"Event log schema"; as built in
  [schema.ts](../../apps/edge/src/db/schema.ts).
- Related: [ADR-0008](0008-pii-in-append-only-event-log.md),
  [ADR-0012](0012-competition-time-on-local-wall-clock.md).
