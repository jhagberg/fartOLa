---
status: accepted
date: 2026-10-05
decision-makers: [Jonas Hagberg]
consulted: ['gemini-code-assist code review on PR #3']
informed: []
---

# PII in append-only event log: scrub the competitor row, not the event payload

## Update 2026-10-05

The decision of 2026-05-16 (option B) stands. Facts that have changed since:

- **The scrub list grew.** `privacy/retention.ts` now also clears
  `hired_cards.contact_name`, `contact_phone`, `contact_email` and `note`
  (Phase 2.0, D-HB-1/D-HB-3). The trade-off comment is in lines 24–28, not 14–21.
- **A PII store that is not scrubbed:** `meos_competitors` (names, cards and
  times received from MeOS via MOP) is not part of the retention scrub. It is
  replaced only when MeOS sends a new full set. Decide whether to add it to the
  scrub list. Until then, it is residual exposure on the same terms as
  `card_holder`.
- **Mitigation 2 ("no remote access by default") holds only for the default
  bind.** With `--allow-lan` (Phase 2.0+; `scripts/run-local.sh` uses it by
  default), every `GET` route answers the LAN without authentication, including
  competitor lists and results. Only writes are gated (ADR-0010). `/mip`, which
  serves every entry, now needs a password or the operator machine (ADR-0013).
- **New personal data outside the repo:** real-competition replay fixtures are
  anonymised before they are written and live in a private repo (ADR-0014).
- The "Phase 2 backlog item" (per-event payload redaction) is still open.

The original text below is kept as recorded.

## Context and Problem Statement

REQ-EVT-002 makes the `events` table strictly append-only (sealed by
SQL triggers — no UPDATE, no DELETE — so the log is a reliable single
source of truth for event-sourced reducers). REQ-PRIV-002 requires
anonymising personal data 30 days after a competition ends.

These collide on one specific field: the `card_read` event payload
includes a `card_holder` object (the firmware-side name string the
owner programmed onto the SI card at manufacture / re-issue time).
That string is PII. Because the events table is sealed, the per-row
retention scrub in `apps/edge/src/privacy/retention.ts` cannot reach
into payload JSON to redact it. We have to choose how to reconcile.

## Decision Drivers

- REQ-EVT-002 (append-only events) is a hard invariant — the projection
  reducer, the recompute-on-startup contract, and the IOF XML export
  rebuild all assume the event log is a literal historical record.
- REQ-PRIV-002 anchors against a 30-day window from competition end.
- Phase 1 ships to a single laptop per club. The threat model is
  "laptop lost / stolen / borrowed," not "remote attacker reads
  events.db via SQL injection."
- `card_holder` is firmware-side data the operator never typed in. The
  operator-controlled PII surface — names entered in EntryList import
  or walk-up registration — lives in `competitors.name` and
  `competitors.club`, which ARE mutable.

## Considered Options

- **A. Allow targeted UPDATE on events.payload for redaction.** Break
  the append-only invariant for a narrow purpose. Reducers would need
  to handle payload-shape changes mid-stream; the IOF XML export
  guarantee (every event re-derivable from the log) would weaken.
- **B. Scrub competitor rows only; document the residual card_holder
  exposure.** Operator-entered PII (name, club) gets anonymised; the
  firmware string in event payloads stays. Mitigate the residual
  exposure with operational advice (encrypt the laptop disk) and a
  Phase 2 follow-up for selective event-payload redaction if needed.
- **C. Never write card_holder to events.** Strip it at the
  `cardReadPayload` boundary. Simple, but throws away data that
  legitimate operators may want for debugging unknown-card situations
  (the card had a name programmed but didn't match anyone).

## Decision Outcome

Chosen option: **B — scrub competitor rows only, document the residual
card_holder exposure.**

The retention scrub at `apps/edge/src/privacy/retention.ts` updates
`competitors.name → 'Anonymiserad'` and `competitors.club → NULL` once
the parent competition's date is older than the retention window
(default 30 days). The events table stays append-only.

The residual `card_holder` string in `card_read` payloads is mitigated by:

1. **Disk encryption advice** in `apps/edge/README.md` — the deploy
   target for Phase 1 is a single laptop; full-disk encryption is the
   correct control for that threat model.
2. **No remote access by default** — `--bind-host 127.0.0.1` is the
   default; the WebSocket origin allow-list rejects non-loopback
   origins; the bridge does not surface events via any public API
   beyond the loopback HTTP surface.
3. **Phase 2 backlog item** — if a deployment needs stronger guarantees
   (regulated event organiser, multi-tenant edge node), revisit with
   per-event payload redaction or a separate sealed PII-redaction
   journal that the reducer composes with.

### Consequences

- Good, because the append-only event log remains a single source of
  truth — the reducer contract, IOF export rebuild, and the daily
  backup scheduler all keep operating on an immutable substrate.
- Good, because the retention scrub stays a one-line UPDATE; we don't
  carry the complexity of payload-JSON rewriting in a SQLite trigger.
- Bad, because `card_holder` strings persist past the 30-day window on
  the disk. The mitigation depends on operator hygiene (encrypting the
  disk) rather than a code guarantee.
- Bad, because if Phase 2 use cases need provable redaction (e.g., a
  national federation hosting events on a shared edge node), this ADR
  will need to be revisited with one of options A or C.

### Confirmation

- `apps/edge/src/privacy/retention.ts` comment block (lines 24–28 as of
  2026-10-05) documents the trade-off at the implementation site.
- `apps/edge/README.md` carries the disk-encryption advice for
  operators.
- This ADR is the cross-reference target from REQ-PRIV-002.

## More Information

- REQ-EVT-002 (append-only events) and REQ-PRIV-002 (30-day PII retention):
  [REQUIREMENTS.md](../../.planning/REQUIREMENTS.md)
- Implementation: [retention.ts](../../apps/edge/src/privacy/retention.ts)
- Originating review comment: PR #3 inline comment on
  `.planning/phases/01-single-laptop-training-mvp/01-02-PLAN.md:166`
  by gemini-code-assist, 2026-05-15.
- Related: [ADR-0009](0009-eventor-runner-cache.md),
  [ADR-0010](0010-event-admin-codes-trust-model.md),
  [ADR-0013](0013-meos-integration-requires-password.md),
  [ADR-0014](0014-replay-real-competitions-as-acceptance-test.md).
