---
status: accepted
date: 2026-10-05
decision-makers: [Jonas Hagberg]
consulted: ['Codex (review of PR #51)']
informed: []
---

# MeOS integration (MIP/MOP) requires a password; open LAN access only as an explicit opt-in

Decided 2026-10-05, recorded 2026-10-05. Revises the Phase 2.0 decisions
D-MIP-1 and D-MOP-4.

## Context and Problem Statement

fartOLa serves MeOS on two endpoints. `GET /mip` lets MeOS poll every entered
runner (MeOS Input Protocol), and `POST /mop` takes MeOS's online results and
adds runners (MeOS Online Protocol). Phase 2.0 chose "no auth, closed club LAN".
D-MIP-1 ignored MeOS's `pwd`, and D-MOP-4 made `/mop` always on. The phase notes
said this should be revisited for sanctioned events. With `--allow-lan`, anyone
on the event Wi-Fi could read every entry (names, clubs, cards) and inject
competitors. The browser write gate (ADR-0010) does not cover these endpoints:
MeOS cannot hold an event-code cookie. How should MeOS authenticate?

## Decision Drivers

- MeOS already sends a `pwd` HTTP header on MIP and MOP. Use what MeOS supports;
  do not change MeOS.
- Entry data is personal data (ADR-0008). Default to deny on the LAN.
- Single-laptop use (MeOS and fartOLa on the same machine) must keep working
  with no setup.
- The operator must be able to choose the old open behaviour knowingly, for
  example on a trusted training LAN.

## Considered Options

1. **Keep no auth** (D-MIP-1/D-MOP-4). Rejected: a LAN-wide PII read and a
   competitor-injection path.
2. **Password from an environment variable, required always** (the Phase 2.0
   suggestion). Rejected: Windows operators cannot easily set environment
   variables, and it breaks the zero-setup single-laptop case.
3. **Password set in the UI. Without a password, only the operator machine is
   allowed. Open LAN access only through an explicit opt-in.** Chosen.

## Decision Outcome

Chosen option: **3**.

- **Password set** (Inställningar → MeOS-koppling, stored like the API keys;
  the `MEOS_PASSWORD` env variable wins and the value is never returned): MeOS's
  `pwd` (header, or query for test harnesses) must match, compared in constant
  time. Otherwise the request gets 401. This applies from every machine,
  including localhost.
- **No password (the default):** only the operator machine gets through. That
  is loopback, or this host's own interface addresses under `--allow-lan`, the
  same check the write gate uses (ADR-0010). The LAN gets 403 with a hint to set
  a password.
- **No password + "Tillåt MeOS utan lösenord" ticked** (default off): open, as
  before. The server logs a warning once at startup.
- The check runs in `onRequest`, before a `/mop` body is read.

### Consequences

- Good, because the default no longer exposes every entry to the LAN, and the
  operator machine needs no setup.
- Good, because it needs no MeOS changes: MeOS shows its own "HTTP Error
  401/403".
- Bad, because a parallel MeOS on another laptop now needs the same password
  configured on both sides.
- Bad, because the password travels in plain HTTP on the LAN. This is accepted
  under the closed-LAN threat model of ADR-0010.

### Confirmation

`apps/edge/src/integrations/meos/access.test.ts`: localhost works without a
password; the LAN gets 403 without a password; the opt-in opens it; a missing or
wrong `pwd` gets 401 (also from localhost); the right header or query works; the
`MEOS_PASSWORD` env variable wins.

## More Information

- Commit `6a57a03` (PR #51).
- Code: [access.ts](../../apps/edge/src/integrations/meos/access.ts),
  [secrets.ts](../../apps/edge/src/config/secrets.ts),
  [server.ts](../../apps/edge/src/server.ts) (startup warning).
- Revised decisions: D-MIP-1 and D-MOP-4 in
  [02-CONTEXT.md](../../.planning/phases/02-4-klubbs-mvp/02-CONTEXT.md). The
  phase note stays as it is (historical). This ADR is the revision record.
- Related: [ADR-0010](0010-event-admin-codes-trust-model.md) (LAN trust model,
  operator machine), [ADR-0008](0008-pii-in-append-only-event-log.md),
  [ADR-0007](0007-standards-first-interop.md).
