---
status: proposed
date: 2026-10-15
decision-makers: [Jonas Hagberg]
consulted: []
informed: []
---

# Assistant access over MCP: read-only first, writes only as the events the screens make

## Context and Problem Statement

On race day the secretariat meets questions no screen answers directly
("why is this runner MP?", "which cards are still out from class H21?",
"did the radio at control 52 stop?") and, now and then, a bug. An AI
assistant that can read the live competition could answer these and help
find a fault while the race runs. The Model Context Protocol (MCP) is how
assistants such as Claude connect to a program. Other orienteering
software already offers this (meshO Manager documents an MCP server:
read-only by default, writes behind a second switch, no deletion, edits in
the change history; docs.mesho.live, "AI assistants (MCP)").

What should fartOLa expose, to whom, and how do we keep results, personal
data and the event log safe?

## Decision Drivers

- The event log is append-only and every change is an event (ADR-0003).
  An assistant must not get a second way to change data.
- Writes from another device need an event code; the operator's own
  laptop is trusted (ADR-0010).
- Personal data: an assistant usually runs in the cloud, so whatever it
  reads leaves the laptop (ADR-0008, GDPR). Names, clubs and card numbers
  are personal data; results tied to a name are too.
- The operator stays in charge: SOFT decisions (statuses, times) are the
  secretariat's, recorded with a reason (ADR-0011, ADR-0019).
- Little code: reuse the REST routes and the projection.

## Considered Options

1. No MCP; an assistant reads the REST API or the SQLite file directly.
2. An MCP server with read tools only, over the existing REST routes and
   the event log.
3. Read tools now; write tools later that make exactly the events the
   screens make, through the same routes and checks.
4. Full read and write access for the assistant.

## Decision Outcome

Chosen option: 3, because it gives the useful part (answers and fault
finding) at once with no new write path, and leaves writes for when we
have seen how the reads are used.

### Read tools (first)

- Served by the edge at `/mcp` (Streamable HTTP), off by default, turned
  on in the settings screen, and bound to the operator's laptop
  (localhost) like ADR-0010's trusted path. A tablet or another laptop
  cannot reach it.
- Each tool calls the same code as a REST route; no tool reads SQLite on
  its own. First set: competition status and clock, the read-out queue and
  unknown cards, a runner by card, bib or name with the read history and
  first/last candidates (ADR-0019), results per class, kvar i skogen,
  radio health and the watchdog, the pre-race check, and the event log
  with filters (type, runner, time).
- **Personal data, the default:** runners appear by id, bib, class and
  card number, without names or clubs. The operator can turn on names
  for the session, with a line saying the assistant's provider receives
  them. No contact details (hire cards, consent) through MCP at all.

### Write tools (later, a separate decision when they come)

- Only actions a screen already has (a manual punch, a finish time by
  hand, a status with a reason), through the same route, with the same
  validation, recorded as the same event. The event names the assistant
  as the source, so the change history shows who did what.
- A second switch, off by default. No tool can undo the event log, reset
  a race or delete anything.
- Preferably "propose, operator confirms": the tool returns a suggested
  change that the operator accepts on screen.

### Consequences

- Good, because the secretariat can ask about the live race in plain
  words and a developer can help find a bug without remote access.
- Good, because no data can change through MCP until write tools are
  decided, and then only as ordinary events.
- Bad, because anything the assistant reads leaves the laptop: the
  default hides names, and the operator decides per session.
- Bad, because a tool set is one more surface to keep in step with the
  REST routes; the tools are thin wrappers to keep that cheap.

### Confirmation

- A test that every read tool maps to an existing route and returns no
  name, club or contact field unless names are on.
- A test that `/mcp` refuses non-localhost requests and is absent when
  turned off.
- A race-day trial on a replay day before it is used at a competition.

## Pros and Cons of the Options

### 1. No MCP

- Good, because there is nothing to build.
- Bad, because an assistant reading SQLite bypasses the projection,
  the trust model and any personal data default.

### 4. Full access

- Good, because the assistant can fix things itself.
- Bad, because results could change without the secretariat deciding,
  against ADR-0011 and ADR-0019.

## More Information

- MCP: modelcontextprotocol.io.
