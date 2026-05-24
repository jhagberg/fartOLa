# ADR-0010: Event Admin Codes — Trust Model, Entropy, and Rate-Limit Math

**Date:** 2026-05-25
**Status:** Accepted
**Deciders:** Jonas Hagberg (author), cross-AI review (DeepSeek v4 Pro, Gemini 3.1 Pro, GPT-5.5)
**Plan:** Phase 2.1, Plan 02.1-12 (carry-over from Phase 2.0 Plan 02-08)

---

## Context

Mobile sekretariat-helpers at orienteering events need a way to register
walk-up competitors from their phones without exposing the edge bridge to
unauthenticated LAN writes. Real accounts (username + password, MFA, OAuth)
are overkill for this use case: events are 4–8 hours long, helpers are
trusted club members, and the threat model is a closed club LAN, not the
public internet.

The requirement (D-18) calls for a minimal auth mechanism: the operator
generates a short, memorable code and shouts it across the parking lot.
Helpers type it on `/access` on their phones. Anyone with the code can
register runners; nobody else can.

---

## Decision: Word-Number Codes with Signed Competition-Scoped Cookies

### Code format

`<word>-<NNN>` where:

- `word` in EVENT_CODE_WORDS (35 entries from SOFT 2024 kontrollbeskrivningar)
- `NNN` in [100..999] (900 values, zero-padding prohibited)
- Example: `sänkan-127`, `branten-403`, `röset-999`

**Why the floor at 100:** every spoken number is exactly 3 syllables
("fyra-fem-sex"). Zero-padded numbers (007) produce confusing `noll-noll-sju`
which gets misheard at the start line.

**Why a dash:** clear spoken separator ("dungen STRECK fyra-fem-sex") and
avoids ambiguous typed input (`sänkan 42` vs `sänkan-42`).

**Why an orienteering wordlist:** memorable across a parking lot; domain-flavored;
curated for phonetic distinctiveness (no homophones, no compounds).

### Entropy analysis

35 words x 900 numbers = 31 500 combinations ≈ 14.9 bits

This is low in the absolute sense but acceptable within the fenced threat model:

1. **Closed LAN deployment.** The bridge is only accessible on the club's event
   Wi-Fi. Public-internet exposure is explicitly out of scope for Phase 2.1.

2. **Rate limit defense-in-depth.** 10 attempts / 60 seconds per IP.
   At sustained 10 attempts/min, exhausting 31 500 codes takes ~52.5 hours.
   Well past the 24-hour code expiry window.

3. **Exponential backoff.** After 5 consecutive failures, delay doubles
   (1s, 2s, 4s, ... capped at 60s). Effectively drops sustained rate to ~1-2/min.

4. **Per-event expiry.** Codes expire at competition.date + 24h.

5. **Revocation.** Operator can revoke any code instantly.

**Rate-limit failure scenario:** If rate limit completely fails AND attacker
pushes 100 attempts/min from the LAN:
31500 / 100/min = 315 min ~= 5.2 hours
Less than 1/5 of the event-day window. Unauthorized registrations immediately
detectable.

### Cookie design

The signed cookie is scoped to a specific competition_id:

- Name: fartola_event_code
- Format: base64url(payload).base64url(HMAC-SHA256(payload, secret))
- Payload: { competitionId, expiresAt, issuedAt, v: 1 }
- Attrs: HttpOnly; SameSite=Lax; Path=/; Max-Age=n
- NOT Secure — LAN HTTP deployment.

**competitionId in payload:** The preHandler validates payload.competitionId
against the route's :id param. A helper authenticated for competition A cannot
write to competition B (T-02.1-25b).

**Signing secret persistence:** Stored in SQLite config table as
`event_code_signing_secret`. Generated once via crypto.randomBytes(32).
Persisted across edge server restarts — volunteers stay logged in if the
operator reboots the laptop during the event.

### Localhost bypass

Operator desk laptop always bypasses the cookie gate.
Check uses socket.remoteAddress ONLY — never X-Forwarded-For (T-02.1-27).
XFF is unauthenticated user-controlled input; ignoring it prevents header
spoofing bypass attacks.

### Blanket write-route protection

onRequest hook gates all POST/PATCH/DELETE under /api/competitions/:id/**
for non-localhost requests without a valid cookie. Covers current and future
write routes automatically.

Excluded from gate:
- POST /access (is the auth endpoint)
- /api/competitions/:id/event-codes (operator-only, own localhost gate)

### Log redaction

Plaintext event code never appears in logs (T-02.1-26). Extended redact.ts
with body.code, *.body.code, req.body.code, body.event_code paths.
Code returned plaintext once only (POST /event-codes response).
GET list returns masked codes (san****27).

---

## Threat Register

| Threat ID | Category | Component | Disposition | Notes |
|-----------|----------|-----------|-------------|-------|
| T-02.1-24 | Spoofing | Brute-force event code | mitigate | 10/60s + exp backoff; 14.9 bits; 24h expiry |
| T-02.1-25 | Tampering | Cookie forgery | mitigate | HMAC-SHA256 + timingSafeEqual |
| T-02.1-25b | Tampering | Cross-competition cookie reuse | mitigate | competitionId in payload; preHandler validates |
| T-02.1-26 | Info Disclosure | Code in logs | mitigate | pino redact paths |
| T-02.1-27 | Elevation of Privilege | LAN write without auth | mitigate | Blanket onRequest gate; localhost via socket.remoteAddress |
| T-02.1-27b | Elevation of Privilege | XFF spoofing bypass | mitigate | XFF explicitly ignored |

---

## Consequences

### Positive

- Simple memorable auth for helpers — no app install, no account setup.
- Domain-flavored (Swedish O-feature words match the sport).
- Competition-scoped cookies prevent cross-competition writes.
- Signing secret survives restarts.
- Blanket preHandler protects all current and future write routes.
- No external dependencies beyond @fastify/cookie.

### Negative / Risks

- 14.9 bits of entropy is low. If ever exposed to the public internet,
  rate limiting is insufficient. Gate expansion on real auth before any
  internet exposure.
- Cookie is not Secure (HTTP LAN only). LAN sniffing possible. Accepted.
- In-memory rate-limit state lost on server restart. Accepted (physical
  access to bridge laptop already grants full access).

---

## Alternatives Considered

| Alternative | Why rejected |
|-------------|--------------|
| 4-digit PIN | 10 000 combinations; no domain flavor |
| JWT tokens with real user accounts | Overkill for Phase 2.1 helper use case |
| QR code distribution | Better UX but adds complexity; deferred to Phase 3 |
| Per-helper named accounts | Audit-trail benefit; deferred to Phase 3 |
| Long random token (e.g. UUID) | Cannot be shouted across a parking lot |
