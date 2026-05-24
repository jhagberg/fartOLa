// Authored for fartola. Not ported from upstream.
//
// Admin routes for event codes — POST generate / GET list / POST revoke.
// All routes are localhost-only (operator at the desk laptop). Helpers on
// the LAN cannot generate or revoke codes; they can only use them via /access.
//
//   POST /api/competitions/:id/event-codes
//     → 201 { id, code, expires_at_ms }
//     Generates a fresh code via generateCode(), persists to event_codes table.
//     Returns the PLAINTEXT code exactly once — it is not re-retrievable.
//     Auto-generates and persists event_code_signing_secret on first call.
//     Expiry = competition.date as ms + 24h.
//
//   GET  /api/competitions/:id/event-codes
//     → 200 { codes: [{ id, masked_code, expires_at_ms, revoked_at_ms }, ...] }
//     Lists active codes with masked_code = first3****last2
//     (e.g. `sänkan-127` → `sän****27`). Full plaintext NEVER returned.
//
//   POST /api/competitions/:id/event-codes/:codeId/revoke
//     → 200 { ok: true }
//     Sets revoked_at_ms = now on the named code.
//
// Security: all three routes check socket.remoteAddress for localhost before
// any other logic. Non-localhost gets 403 { error: 'localhost_required' }.
// X-Forwarded-For is explicitly ignored (T-02.1-27 mitigation).
//
// Log redaction: the code field in POST responses is NOT logged because the
// route uses a custom serialize-reply that omits it, and redact.ts paths
// cover req.body.code.
//
// Locked by:
//   - .planning/phases/02.1-sanctioned-competition-foundations/02.1-12-PLAN.md task 2
//   - .planning/adr/0010-event-admin-codes-trust-model.md
//   - T-02.1-24 (brute-force mitigation — per-IP rate limit, expiry)
//   - T-02.1-26 (log redaction — code value never in logs)

import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';

import { competitions, config as configTable, eventCodes } from '../db/schema.ts';
import { generateCode } from '../auth/event-code.ts';

/** True iff the TCP peer is a loopback address (operator desk laptop).
 * Uses socket.remoteAddress ONLY — never X-Forwarded-For (T-02.1-27). */
function isLocalhost(remoteAddress: string | undefined): boolean {
  return (
    remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1'
  );
}

/** Mask a plaintext code for the GET list: first 3 chars + **** + last 2.
 * e.g. `sänkan-127` → `sän****27`. */
function maskCode(code: string): string {
  if (code.length <= 5) return '****';
  return `${code.slice(0, 3)}****${code.slice(-2)}`;
}

/** Read or create the per-install cookie signing secret.
 * Persisted in the config table as `event_code_signing_secret`. On first call
 * for this install, generates a 32-byte random hex secret via crypto.randomBytes
 * and upserts it. On subsequent calls, reuses the stored value.
 * This ensures the secret survives edge server restarts (T-02.1-25 mitigation). */
export function getOrCreateSigningSecret(app: FastifyInstance): string {
  const KEY = 'event_code_signing_secret';
  const row = app.fartolaDb.db
    .select({ value: configTable.value })
    .from(configTable)
    .where(eq(configTable.key, KEY))
    .get();
  if (row && row.value.length > 0) return row.value;

  const secret = randomBytes(32).toString('hex');
  app.fartolaDb.db
    .insert(configTable)
    .values({ key: KEY, value: secret })
    .onConflictDoUpdate({ target: configTable.key, set: { value: secret } })
    .run();
  return secret;
}

export default async function registerEventCodesRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------------------
  // POST /api/competitions/:id/event-codes — generate a new code
  // ---------------------------------------------------------------------------
  app.post('/api/competitions/:id/event-codes', async (req, reply) => {
    const { id: competitionId } = req.params as { id: string };

    // Localhost gate — operator-only action.
    if (!isLocalhost(req.socket.remoteAddress)) {
      return reply.code(403).send({ error: 'localhost_required' });
    }

    // Verify competition exists.
    const comp = app.fartolaDb.db
      .select({ id: competitions.id, date: competitions.date })
      .from(competitions)
      .where(eq(competitions.id, competitionId))
      .get();
    if (!comp) return reply.code(404).send({ error: 'competition_not_found' });

    // Ensure signing secret is persisted (first boot auto-generates it).
    getOrCreateSigningSecret(app);

    // Compute expiry: competition date + 24h.
    const [year, month, day] = comp.date.split('-').map(Number) as [number, number, number];
    const competitionDateMs = new Date(year, month - 1, day).getTime();
    const expiresAtMs = competitionDateMs + 24 * 60 * 60 * 1000;

    const code = generateCode();
    const id = crypto.randomUUID();
    const now = Date.now();

    app.fartolaDb.db
      .insert(eventCodes)
      .values({
        id,
        competitionId,
        code,
        expiresAtMs,
        revokedAtMs: null,
        createdAtMs: now,
      })
      .run();

    return reply.code(201).send({ id, code, expires_at_ms: expiresAtMs });
  });

  // ---------------------------------------------------------------------------
  // GET /api/competitions/:id/event-codes — list active codes (masked)
  // ---------------------------------------------------------------------------
  app.get('/api/competitions/:id/event-codes', async (req, reply) => {
    const { id: competitionId } = req.params as { id: string };

    // Localhost gate.
    if (!isLocalhost(req.socket.remoteAddress)) {
      return reply.code(403).send({ error: 'localhost_required' });
    }

    const rows = app.fartolaDb.db
      .select({
        id: eventCodes.id,
        code: eventCodes.code,
        expiresAtMs: eventCodes.expiresAtMs,
        revokedAtMs: eventCodes.revokedAtMs,
      })
      .from(eventCodes)
      .where(eq(eventCodes.competitionId, competitionId))
      .orderBy(desc(eventCodes.createdAtMs))
      .all();

    const codes = rows.map((row) => ({
      id: row.id,
      masked_code: maskCode(row.code),
      expires_at_ms: row.expiresAtMs,
      revoked_at_ms: row.revokedAtMs,
    }));

    return reply.code(200).send({ codes });
  });

  // ---------------------------------------------------------------------------
  // POST /api/competitions/:id/event-codes/:codeId/revoke — revoke a code
  // ---------------------------------------------------------------------------
  app.post('/api/competitions/:id/event-codes/:codeId/revoke', async (req, reply) => {
    const { id: competitionId, codeId } = req.params as { id: string; codeId: string };

    // Localhost gate.
    if (!isLocalhost(req.socket.remoteAddress)) {
      return reply.code(403).send({ error: 'localhost_required' });
    }

    const row = app.fartolaDb.db
      .select({ id: eventCodes.id })
      .from(eventCodes)
      .where(and(eq(eventCodes.id, codeId), eq(eventCodes.competitionId, competitionId)))
      .get();
    if (!row) return reply.code(404).send({ error: 'code_not_found' });

    app.fartolaDb.db
      .update(eventCodes)
      .set({ revokedAtMs: Date.now() })
      .where(eq(eventCodes.id, codeId))
      .run();

    return reply.code(200).send({ ok: true });
  });
}
