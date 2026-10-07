---
status: accepted
date: 2026-05-16
decision-makers: [Jonas Hagberg]
consulted: [parallel research agent, MeOS source review]
informed: []
---

# Eventor löpardatabasen cached locally for walk-up autocomplete

## Context and Problem Statement

Phase 2.0 introduces a MeOS-style walk-up registration flow at the
4-klubbs training event. When the operator scans an SI card at the
registration desk we want to pre-fill the runner's name and club from a
national lookup — the same UX MeOS has offered for a decade. Eventor
exposes `/api/export/cachedcompetitors?includePreselectedClasses=false&zip=true&version=3.0`,
a 9.4 MB gzipped (86 MB raw) XML payload containing 252 919 Swedish
orienteering competitors with names, birth years, club affiliations,
and 96 918 SI card numbers. The endpoint is open to club-level API
keys (`STK` works) and is the exact endpoint MeOS itself uses at
`/home/jonas/src/meos/code/TabCompetition.cpp:3107-3108`.

Caching this payload locally on the bridge laptop is materially more
PII than anything Phase 1 carried: Phase 1's `competitors` table only
held the actively-registered roster (~100 rows at our scale) whereas
the Eventor cache holds the entire national runner DB (~250 k rows).
On the other hand, Eventor's terms-of-service explicitly endorses
client-side caching ("members fetched once per day is plenty") and the
alternative — calling `/api/competitors` per walk-up — fails the
REQ-OPS-001 "no internet required" invariant.

## Decision Drivers

- **REQ-STD-004** — Eventor REST integration (Phase 2.0 instantiates
  the runner-DB read path).
- **REQ-OPS-001** — single-binary install; the bridge must work in
  the forest with intermittent or no internet.
- **REQ-PRIV-002** — 30-day PII retention window for operator-entered
  competitor data.
- **D-EV-2** — 7-day staleness threshold (refresh on bridge boot if
  cache > 7 days old, otherwise reuse).
- **D-EV-3** — bridge MUST boot with stale/empty cache and no
  internet; refresh failures NEVER block startup.
- Eventor ToS guidance — "members fetched once per day is plenty"
  (`.reference/Guide_Eventor_-_Hamta_data_via_API.pdf`); weekly refresh is
  comfortably inside the recommended cadence.
- **MeOS-as-superset philosophy** — TabCompetition.cpp:3107-3108
  uses this same endpoint; matching MeOS's observable behavior is the
  Phase 2.0 design constraint.

## Considered Options

- **A. Inline lookup via Eventor API at walk-up time** — call
  `/api/competitors?...` from the bridge each time the operator scans
  an unknown card. **Rejected** — fails REQ-OPS-001 (the forest is
  often offline) and introduces per-walk-up latency (the parallel
  research agent measured 250–800 ms round-trip).
- **B. Weekly cache of the national DB, local-only** — download the
  full `cachedcompetitors` payload on bridge boot if the local cache
  is > 7 days old, stream-parse into `eventor_competitors` and
  `eventor_clubs`, query by indexed `si_card` and `(family_name,
given_name)` for sub-ms lookups. **Chosen.**
- **C. Per-club subset via `/api/persons/organisations/<id>`** —
  pull only the operating club's roster (~384 names for Stora Tuna
  OK). **Rejected** — the per-club endpoint does NOT return SI card
  numbers, so the primary autocomplete trigger (card scan) would not
  work. Also fails to cover visiting runners from other clubs (the
  whole point of a 4-klubbs training).

## Decision Outcome

Chosen option: **B — weekly cache of the national DB, local-only.**

The implementation pattern (locked by Plan 02-01 task 1-3):

- Migration `0002_phase2.sql` adds `eventor_competitors` (PK
  `person_id`, partial unique index on `si_card`, plain index on
  `(family_name, given_name)`) and `eventor_clubs` (PK `club_id`).
- `apps/edge/src/eventor/cache.ts` performs a TRUNCATE+INSERT
  transactional snapshot replace; a parse-mid-stream failure rolls
  back to the prior cache so the bridge never serves a half-loaded
  snapshot.
- `apps/edge/src/eventor/boot.ts` fires a single fire-and-forget
  `runNow()` after `app.listen()`. The 7-day staleness check is a
  single SELECT on `config` row `eventor_cache_refreshed_at_ms`. A
  missing key, a network failure, or an ingest failure each degrade
  to a logged warning — the bridge keeps the prior cache and the
  Phase 1 `cardHolderHint` fallback covers walk-up.
- `POST /api/__admin/eventor/refresh` (FARTOLA_DEV gated) lets the
  operator force a refresh from the admin UI (Plan 02 will add the
  button).

The residual exposure (252 919 names + birth years + SI cards on the
bridge laptop) is mitigated by:

1. **Local-only**: the cache never leaves the laptop. The bridge does
   not expose `eventor_competitors` over any HTTP route except the
   per-card / per-prefix lookup in Plan 02. MIP `<entry>` (Plan 03)
   only carries actively-registered competitors, not the national
   cache.
2. **No phone/email**: the chosen endpoint
   (`/cachedcompetitors`) deliberately omits contact details. The
   alternative `/persons/organisations/<id>?includeContactDetails=true`
   would carry `<Tele>` and `<Contact>` elements — the parallel
   research agent confirmed via grep that the cachedcompetitors
   payload contains neither.
3. **Clear-cache admin endpoint**: `/api/__admin/eventor/refresh`
   reloads from Eventor. A future companion `clear-cache` endpoint
   can be added if a deployment requires it.
4. **Re-fetchable, not event-log data**: the cache lives outside
   the append-only `events` domain. Deleting and re-fetching is safe
   (no retention conflict) and the `eventor_*` tables are NOT in
   the `privacy/retention.ts` scrub list per ADR-0008's rationale
   (the data is freely re-derivable from Eventor any time).
5. **Disk encryption**: standard `apps/edge/README.md` operator
   guidance applies, the same control ADR-0008 invokes for
   `events.payload.card_holder`.

### Consequences

- **Good** — instant walk-up autocomplete for any SI-card-carrying
  Swedish runner; matches MeOS's UX 1:1; respects Eventor's ToS
  cadence advice; works offline once the cache is loaded.
- **Good** — the schema split (`eventor_*` vs `competitors`) keeps
  the operator-entered active roster separate from the read-only
  national cache; the D-MOP-3 auto-merge writes to `competitors`
  with `source='meos'`, NOT to the eventor cache.
- **Bad** — adds ~20 MB SQLite footprint after a full refresh.
- **Bad** — introduces a (small) PII surface on the bridge laptop
  beyond what Phase 1 carried. The operator-hygiene controls (disk
  encryption, physical custody) cover the residual risk; deployments
  with stricter requirements (federation-hosted bridges, multi-tenant)
  would need to revisit this ADR with option A or a per-club subset
  hybrid.
- **Bad** — bench laptop must run the initial ingest on first boot
  (~5 s per Pattern 2 assumption A7); subsequent boots within 7 days
  skip the refresh entirely.

### Confirmation

- `apps/edge/src/eventor/cache.ts` header comment block documents the
  trade-off at the implementation site.
- The retention scrubber `apps/edge/src/privacy/retention.ts` does
  NOT touch the `eventor_*` tables — the cache is intentionally
  outside the 30-day scrub window because it is freely re-fetchable.
- This ADR is the cross-reference target from REQ-STD-004 (Eventor
  integration), REQ-OPS-001 (offline operation), and REQ-PRIV-002
  (PII retention scope).

## More Information

- REQ-STD-004 — `.planning/REQUIREMENTS.md`
- REQ-OPS-001 — `.planning/REQUIREMENTS.md`
- REQ-PRIV-002 — `.planning/REQUIREMENTS.md`
- Implementation: `apps/edge/src/eventor/`
- Originating research: `.planning/research/eventor-api-smoke.md`
  (privacy + Eventor terms-of-service considerations).
- MeOS reference: `/home/jonas/src/meos/code/TabCompetition.cpp:3107-3108`
  (the upstream that proves the endpoint is open to club keys).
