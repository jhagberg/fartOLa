// Authored for fartola. Not ported from upstream.
//
// POST /access — event code authentication endpoint for mobile sekretariat-helpers.
//
// Flow:
//   1. Body: { competition_id, code }
//   2. Rate-limit check: in-memory per-IP token bucket (10 attempts / 60s).
//      After 5 consecutive failures, exponential backoff: 1s → 2s → 4s → … capped at 60s.
//   3. Check revoked specifically (to give distinct 401 body vs expired).
//   4. Check expired specifically (to give distinct 401 body vs invalid).
//   5. validateCode — returns null if code is invalid/expired/revoked/wrong-competition.
//   6. On success: signCookie(competitionId, secret, expiresAtMs) and
//      reply.setCookie('fartola_event_code', ..., { httpOnly, sameSite: 'lax', path: '/' }).
//   7. On failure: 401 + { error: 'invalid_code' | 'expired' | 'revoked' }.
//
// Rate limit:
//   - 10 attempts / 60s per IP (T-02.1-24 mitigation). On the 11th: 429 + Retry-After.
//   - 5 consecutive failures per IP trigger exponential backoff starting at 1s.
//   - In-memory only (no Redis dep). Cleaned up every 5 minutes.
//
// Logging: the plaintext code is NEVER logged. redact.ts paths cover
// req.body.code and req.body.event_code. The cookie value is covered by
// res.body.* redaction.
//
// Not gated by the preHandler — this IS the auth endpoint that sets the cookie.
// The preHandler excludes POST /access from the blanket write-route gate.
//
// Locked by:
//   - .planning/phases/02.1-sanctioned-competition-foundations/02.1-12-PLAN.md task 2
//   - .planning/adr/0010-event-admin-codes-trust-model.md
//   - T-02.1-24 (rate limit — brute force mitigation)
//   - T-02.1-25 (cookie signing — HMAC-SHA256 timingSafeEqual)
//   - T-02.1-25b (competition-scoped cookie)

import type { FastifyInstance } from 'fastify';
import { and, eq, isNull, lt, not } from 'drizzle-orm';

import { eventCodes } from '../db/schema.ts';
import { signCookie } from '../auth/event-code.ts';
import { getOrCreateSigningSecret } from './event-codes.ts';

// ---------------------------------------------------------------------------
// In-memory rate limiter
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  /** Total attempts in the current 60s window. */
  windowCount: number;
  /** Epoch ms when the current window resets. */
  windowResetMs: number;
  /** Consecutive failure count (for exponential backoff). */
  consecutiveFails: number;
  /** Epoch ms when the backoff period ends (0 = no backoff active). */
  backoffUntilMs: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

const WINDOW_MS = 60_000; // 60 seconds
const WINDOW_LIMIT = 10; // max attempts per window
const BACKOFF_TRIGGER = 5; // consecutive failures before backoff starts
const BACKOFF_CAP_MS = 60_000; // max backoff 60s

function getRateLimit(ip: string): RateLimitEntry {
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now > entry.windowResetMs) {
    entry = {
      windowCount: 0,
      windowResetMs: now + WINDOW_MS,
      consecutiveFails: entry?.consecutiveFails ?? 0,
      backoffUntilMs: entry?.backoffUntilMs ?? 0,
    };
    rateLimitMap.set(ip, entry);
  }
  return entry;
}

/** Returns the Retry-After seconds if the request should be blocked, else 0. */
function checkRateLimit(ip: string): number {
  const now = Date.now();
  const entry = getRateLimit(ip);

  // Active backoff window?
  if (entry.backoffUntilMs > now) {
    return Math.ceil((entry.backoffUntilMs - now) / 1000);
  }

  // Token bucket exhausted?
  if (entry.windowCount >= WINDOW_LIMIT) {
    return Math.ceil((entry.windowResetMs - now) / 1000);
  }

  return 0;
}

function recordAttempt(ip: string, success: boolean): void {
  const now = Date.now();
  const entry = getRateLimit(ip);
  entry.windowCount += 1;

  if (success) {
    // Reset consecutive failure counter on success.
    entry.consecutiveFails = 0;
    entry.backoffUntilMs = 0;
  } else {
    entry.consecutiveFails += 1;
    // Apply exponential backoff when consecutive fails >= BACKOFF_TRIGGER.
    if (entry.consecutiveFails >= BACKOFF_TRIGGER) {
      // backoffMs = 2^(consecutiveFails - BACKOFF_TRIGGER) seconds, capped.
      const backoffMs = Math.min(
        Math.pow(2, entry.consecutiveFails - BACKOFF_TRIGGER) * 1000,
        BACKOFF_CAP_MS
      );
      entry.backoffUntilMs = now + backoffMs;
    }
  }
}

// Clean up stale entries every 5 minutes.
const cleanupInterval = setInterval(
  () => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap.entries()) {
      if (now > entry.windowResetMs && now > entry.backoffUntilMs) {
        rateLimitMap.delete(ip);
      }
    }
  },
  5 * 60 * 1000
);
cleanupInterval.unref();

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export default async function registerAccessRoute(app: FastifyInstance): Promise<void> {
  app.post('/access', async (req, reply) => {
    const body = req.body as { competition_id?: unknown; code?: unknown } | null;
    const competitionId = typeof body?.competition_id === 'string' ? body.competition_id : '';
    const code = typeof body?.code === 'string' ? body.code : '';

    if (!competitionId || !code) {
      return reply.code(400).send({ error: 'invalid_body' });
    }

    // Rate-limit check using socket.remoteAddress (never X-Forwarded-For — T-02.1-27).
    const ip = req.socket.remoteAddress ?? 'unknown';
    const retryAfter = checkRateLimit(ip);
    if (retryAfter > 0) {
      return reply
        .code(429)
        .header('retry-after', String(retryAfter))
        .send({ error: 'rate_limited' });
    }

    const nowMs = Date.now();

    // Check for revoked first (gives a distinct error from invalid/expired).
    // We query specifically for revoked codes to distinguish from expired.
    const revokedRow = app.fartolaDb.db
      .select({ id: eventCodes.id })
      .from(eventCodes)
      .where(
        and(
          eq(eventCodes.competitionId, competitionId),
          eq(eventCodes.code, code),
          not(isNull(eventCodes.revokedAtMs))
        )
      )
      .get();
    if (revokedRow) {
      recordAttempt(ip, false);
      return reply.code(401).send({ error: 'revoked' });
    }

    // Check for expired codes (gives a distinct error from invalid/revoked).
    const expiredRow = app.fartolaDb.db
      .select({ id: eventCodes.id })
      .from(eventCodes)
      .where(
        and(
          eq(eventCodes.competitionId, competitionId),
          eq(eventCodes.code, code),
          isNull(eventCodes.revokedAtMs),
          lt(eventCodes.expiresAtMs, nowMs)
        )
      )
      .get();
    if (expiredRow) {
      recordAttempt(ip, false);
      return reply.code(401).send({ error: 'expired' });
    }

    // Full validation (non-expired, non-revoked, correct competition).
    const { validateCode } = await import('../auth/event-code.ts');
    const validRow = await validateCode(app.fartolaDb, competitionId, code, nowMs);
    if (!validRow) {
      recordAttempt(ip, false);
      return reply.code(401).send({ error: 'invalid_code' });
    }

    recordAttempt(ip, true);

    // Get the signing secret (auto-created if not yet initialised).
    const secret = getOrCreateSigningSecret(app);

    // Sign cookie scoped to this competitionId (T-02.1-25b).
    const cookieValue = signCookie(competitionId, secret, validRow.expiresAtMs);

    // Max-Age in seconds.
    const maxAge = Math.max(0, Math.floor((validRow.expiresAtMs - nowMs) / 1000));

    // Set the HttpOnly SameSite=Lax cookie (NOT Secure — LAN HTTP deployment).
    void reply.header(
      'set-cookie',
      `fartola_event_code=${cookieValue}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`
    );

    return reply.code(200).send({ ok: true });
  });
}
