---
status: proposed
date: 2026-10-17
decision-makers: [Jonas Hagberg]
consulted: []
informed: []
---

# Assistant access over MCP: read-only first, writes only as the events the screens make

## Context and Problem Statement

On race day the secretariat asks things no screen answers directly ("why
is this runner MP?", "did the radio at 52 stop?") and now and then hits a
bug. An AI assistant connected over MCP could answer from the live
competition. What may it read and change, without a second way to alter
results or leaking personal data to a cloud service?

## Considered Options

1. No MCP; an assistant reads the REST API or the database file.
2. Read tools now; write tools later, only as the events the screens make.
3. Full read and write access.

## Decision Outcome

Chosen option: 2, because answers and fault finding need no writes, and
writes through the same routes keep the event log (ADR-0003) and the
secretariat's decisions (ADR-0011, ADR-0019) the only way results change.

- `/mcp` on the edge, off by default, localhost only (ADR-0010's trusted
  path).
- Each read tool calls an existing route or the projection: status and
  clock, read-out queue, a runner with reads and first/last candidates,
  results, kvar i skogen, radio health, pre-race check, event log.
- Runners appear by id, bib, class and card, without names or clubs,
  unless the operator turns names on for the session. No contact details.
- Write tools are a later decision: only actions a screen has, through
  its route, recorded as the same event with the assistant as source;
  preferably proposed by the assistant and confirmed on screen.

### Consequences

- Good, because the secretariat can ask about the race in plain words,
  and nothing changes through MCP until writes are decided.
- Bad, because what the assistant reads leaves the laptop; names are off
  by default and the operator decides per session.

### Confirmation

Tests that every read tool maps to a route, returns no name, club or
contact field unless names are on, and that `/mcp` refuses non-localhost
requests and is absent when off. A trial on a replay day before use at a
competition.
