// Authored for fartola. Not ported from upstream.
//
// Pure auth functions for the event-code system (Plan 02.1-12 / D-18).
//
//   generateCode()                        — random word-NNN code
//   validateCode(handle, cid, code, now)  — DB check: active, non-expired, non-revoked
//   signCookie(cid, secret, expiresAt)    — HMAC-SHA256 cookie value
//   verifyCookie(cookie, cid, secret)     — constant-time verify + cid scope check
//
// Cookie format (Plan 02-08-PLAN.md §Cookie shape):
//   <base64url(payload)>.<base64url(hmac-sha256(payload, secret))>
//   payload JSON: { "cid": "<competition_id>", "exp": <ms_since_epoch>, "iat": <ms_since_epoch>, "v": 1 }
//
// Cookie name: fartola_event_code
// Attributes: HttpOnly; SameSite=Lax; Path=/; Max-Age=<n>
// NOT Secure — LAN deployment over HTTP (per plan spec).
//
// Security properties:
//   - crypto.randomInt for code generation (CSPRNG)
//   - HMAC-SHA256 with crypto.createHmac for signing
//   - crypto.timingSafeEqual for constant-time signature comparison
//   - Cookie payload includes competitionId to prevent cross-competition reuse
//   - verifyCookie rejects cookies where payload.cid !== provided competitionId
//
// Locked by:
//   - .planning/phases/02.1-sanctioned-competition-foundations/02.1-12-PLAN.md
//   - .planning/phases/02-4-klubbs-mvp/02-08-PLAN.md
//   - T-02.1-25 (cookie forgery mitigation)
//   - T-02.1-25b (cross-competition cookie reuse mitigation)

import { randomInt, createHmac, timingSafeEqual } from 'node:crypto';
import { eq, and, isNull, gt } from 'drizzle-orm';

import type { DbHandle } from '../db/index.ts';
import { eventCodes } from '../db/schema.ts';
import { EVENT_CODE_WORDS } from './event-code-wordlist.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EventCodeRow {
  id: string;
  competitionId: string;
  code: string;
  expiresAtMs: number;
  revokedAtMs: number | null;
}

export interface CookiePayload {
  competitionId: string;
  expiresAt: number;
  issuedAt: number;
  v: 1;
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

/** Pre-check regex — rejects inputs that can't possibly match a valid code.
 * Must match: <Swedish-lowercase>-<NNN> where NNN is 100-999 (first digit 1-9). */
const CODE_REGEX = /^[a-zåäö]+-[1-9][0-9]{2}$/;

/**
 * Generate a fresh event admin code of the form `<word>-<NNN>` where
 * word ∈ EVENT_CODE_WORDS and NNN ∈ [100..999].
 *
 * Uses crypto.randomInt (CSPRNG) for both word selection and numeric tail.
 * 35 × 900 = 31 500 combinations ≈ 14.9 bits (documented in ADR-0010).
 */
export function generateCode(): string {
  const wordIdx = randomInt(0, EVENT_CODE_WORDS.length);
  const num = randomInt(100, 1000); // [100..999] — upper bound exclusive
  return `${EVENT_CODE_WORDS[wordIdx]}-${num}`;
}

// ---------------------------------------------------------------------------
// Code validation
// ---------------------------------------------------------------------------

/**
 * Validate an event code against the database.
 *
 * Returns the matching EventCodeRow if the code is:
 *   - Formatted correctly (regex pre-check — no DB hit for malformed inputs)
 *   - Matched by competition_id
 *   - Not expired (expires_at_ms > nowMs)
 *   - Not revoked (revoked_at_ms IS NULL)
 *
 * Returns null for any validation failure.
 */
export async function validateCode(
  handle: DbHandle,
  competitionId: string,
  code: string,
  nowMs: number
): Promise<EventCodeRow | null> {
  // Fast regex pre-check — rejects malformed inputs without a DB round-trip.
  // Covers: zero-padded (007), too short (99), too long (1000), missing
  // dash (sänkan42), uppercase (Sänkan-127, SÄNKAN-127).
  if (!CODE_REGEX.test(code)) return null;

  const row = handle.db
    .select({
      id: eventCodes.id,
      competitionId: eventCodes.competitionId,
      code: eventCodes.code,
      expiresAtMs: eventCodes.expiresAtMs,
      revokedAtMs: eventCodes.revokedAtMs,
    })
    .from(eventCodes)
    .where(
      and(
        eq(eventCodes.competitionId, competitionId),
        eq(eventCodes.code, code),
        gt(eventCodes.expiresAtMs, nowMs),
        isNull(eventCodes.revokedAtMs)
      )
    )
    .get();

  if (!row) return null;
  return row;
}

// ---------------------------------------------------------------------------
// Cookie signing / verification
// ---------------------------------------------------------------------------

/** base64url encode a Buffer (no padding, URL-safe characters). */
function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** base64url decode a string to a Buffer. */
function b64urlDecode(s: string): Buffer {
  // Restore standard base64 padding
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64');
}

/**
 * Sign a cookie payload for the given competitionId.
 *
 * Format: `<base64url(payload)>.<base64url(HMAC-SHA256(payloadBase64url, secret))>`
 *
 * The payload includes the competitionId so verifyCookie can enforce that the
 * cookie was issued for the same competition the request targets (T-02.1-25b).
 *
 * @param competitionId  The competition this cookie grants access to.
 * @param secret         The per-install HMAC signing secret.
 * @param expiresAt      Expiry timestamp in ms since epoch.
 */
export function signCookie(competitionId: string, secret: string, expiresAt: number): string {
  const payload: CookiePayload = {
    competitionId,
    expiresAt,
    issuedAt: Date.now(),
    v: 1,
  };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = b64url(Buffer.from(payloadJson, 'utf8'));
  const sig = createHmac('sha256', secret).update(payloadB64).digest();
  return `${payloadB64}.${b64url(sig)}`;
}

/**
 * Verify a cookie and return its payload, or null on any failure.
 *
 * Checks performed (in order):
 *   1. Cookie has exactly two dot-separated parts.
 *   2. HMAC-SHA256 signature matches (constant-time comparison via timingSafeEqual).
 *   3. Payload JSON is parseable and has v:1.
 *   4. Payload competitionId matches the provided competitionId (T-02.1-25b).
 *   5. Cookie is not expired (expiresAt > Date.now()).
 *
 * Returns the parsed CookiePayload on success, null on any failure.
 *
 * @param cookie        The raw cookie value from the request.
 * @param competitionId Expected competition ID — must match payload.competitionId.
 * @param secret        The per-install HMAC signing secret.
 */
export function verifyCookie(
  cookie: string,
  competitionId: string,
  secret: string
): CookiePayload | null {
  try {
    const parts = cookie.split('.');
    if (parts.length !== 2) return null;
    const [payloadB64, sigB64] = parts as [string, string];

    // Recompute expected signature and compare constant-time (T-02.1-25).
    const expectedSig = createHmac('sha256', secret).update(payloadB64).digest();
    const providedSig = b64urlDecode(sigB64);
    // timingSafeEqual requires same-length Buffers.
    if (expectedSig.length !== providedSig.length) return null;
    if (!timingSafeEqual(expectedSig, providedSig)) return null;

    // Decode and parse payload.
    const payloadJson = b64urlDecode(payloadB64).toString('utf8');
    const payload = JSON.parse(payloadJson) as CookiePayload;
    if (payload.v !== 1) return null;

    // Scope guard — competitionId in cookie must match the requested route
    // (T-02.1-25b — prevents a helper authenticated for comp A from writing to comp B).
    if (payload.competitionId !== competitionId) return null;

    // Expiry check — cookie is valid only up to expiresAt.
    if (Date.now() > payload.expiresAt) return null;

    return payload;
  } catch {
    return null;
  }
}
