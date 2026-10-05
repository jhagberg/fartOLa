// Authored for fartola. Not ported from upstream.
//
// Operator settings — integration API key management surface.
//
//   GET /api/settings/integrations
//     → 200 { integrations: [{ key, set, source }, ...] }
//     Lists every allowlisted integration with its current status.
//     The `value` field is NEVER returned (write-only secret, OWASP
//     A02:2021). `source` is 'env' | 'config' | 'absent', matching the
//     boot-time precedence in apps/edge/src/eventor/boot.ts.
//
//   PUT /api/settings/integrations { key, value }
//     → 200 { ok, key, set, source }
//     Upserts to the config table. Empty-string value DELETES the row.
//     Unknown key → 400 unknown_integration_key (prevents arbitrary
//     config writes via this REST surface).
//
//   GET /api/settings/meos
//     → 200 { has_meos_password, meos_allow_without_password }
//   PUT /api/settings/meos { meos_password?, meos_allow_without_password? }
//     → 200 (same shape). The MeOS integration password (GET /mip, POST
//     /mop — D-MOP-4 / D-MIP-1 revised 2026-10-05, integrations/meos/
//     access.ts). Never returned. Empty meos_password deletes it. Running
//     without one from other machines is an explicit choice: the flag
//     defaults to false. Operator machine only (server.ts write gate).
//
// Boot precedence (Plan 02-07 task 2 — apps/edge/src/config/secrets.ts):
//   process.env.X (CLI / ~/.env.fartola) > config table > absent.
// process.env wins so headless / CI installs keep working unchanged.
//
// Logging: PUT bodies contain plaintext secrets. The pino logger
// configured in server.ts redacts `req.body.value` via the path list in
// apps/edge/src/log/redact.ts — so even an explicit info() log of the
// request body cannot leak the key.
//
// Locked by:
// - .planning/phases/02-4-klubbs-mvp/02-07-PLAN.md task 1
// - apps/edge/src/log/redact.ts (LOGGER_REDACT_PATHS)
// - OWASP A02:2021 (cryptographic / secret material write-only)

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { config as configTable } from '../db/schema.ts';
import {
  MEOS_ALLOW_WITHOUT_PASSWORD_KEY,
  MEOS_PASSWORD_KEY,
  resolveMeosAccess,
} from '../config/secrets.ts';
import { issuesToErrors } from './_zod-errors.ts';

const MeosSettingsInput = z
  .object({
    meos_password: z.string().max(512).optional(),
    meos_allow_without_password: z.boolean().optional(),
  })
  .strict();

/** Phase 2.1+ adds LIVELOX_API_KEY + LIVERESULTAT_API_KEY. We list them
 * upfront so the GET surface reports `set:false, source:absent` for
 * unconfigured Phase-3 integrations — operators see the placeholders
 * and know what's coming. Adding a new integration in a later phase
 * means: extend this array + wire the boot-time resolver. No schema
 * change needed. */
export const INTEGRATIONS_ALLOWLIST = [
  'EVENTOR_API_KEY',
  'LIVELOX_API_KEY',
  'LIVERESULTAT_API_KEY',
] as const;

export type IntegrationKey = (typeof INTEGRATIONS_ALLOWLIST)[number];

export type IntegrationSource = 'env' | 'config' | 'absent';

export interface IntegrationStatus {
  key: IntegrationKey;
  set: boolean;
  source: IntegrationSource;
}

/** Read one row from the config table by key. Helper kept local to
 * this module to avoid coupling — Plan 02-07 task 2 lifts the same
 * pattern into apps/edge/src/config/secrets.ts for the boot.ts /
 * eventor.ts callers. */
function readConfigRow(app: FastifyInstance, key: string): string | null {
  const row = app.fartolaDb.db
    .select({ value: configTable.value })
    .from(configTable)
    .where(eq(configTable.key, key))
    .get();
  return row?.value ?? null;
}

function resolveIntegrationStatus(app: FastifyInstance, key: IntegrationKey): IntegrationStatus {
  const envValue = process.env[key];
  if (envValue !== undefined && envValue.length > 0) {
    return { key, set: true, source: 'env' };
  }
  const cfgValue = readConfigRow(app, key);
  if (cfgValue !== null && cfgValue.length > 0) {
    return { key, set: true, source: 'config' };
  }
  return { key, set: false, source: 'absent' };
}

function isAllowedKey(value: unknown): value is IntegrationKey {
  return typeof value === 'string' && (INTEGRATIONS_ALLOWLIST as readonly string[]).includes(value);
}

/** Upsert a config row; an empty value deletes it. */
function writeConfigRow(app: FastifyInstance, key: string, value: string): void {
  if (value.length === 0) {
    app.fartolaDb.db.delete(configTable).where(eq(configTable.key, key)).run();
  } else {
    app.fartolaDb.db
      .insert(configTable)
      .values({ key, value })
      .onConflictDoUpdate({ target: configTable.key, set: { value } })
      .run();
  }
}

function meosSettings(app: FastifyInstance): {
  has_meos_password: boolean;
  meos_allow_without_password: boolean;
} {
  const { password, allowWithoutPassword } = resolveMeosAccess(app.fartolaDb);
  return {
    has_meos_password: password !== undefined,
    meos_allow_without_password: allowWithoutPassword,
  };
}

export default async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings/meos', async () => meosSettings(app));

  app.put('/api/settings/meos', async (req, reply) => {
    const parsed = MeosSettingsInput.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send(issuesToErrors(parsed.error.issues));
    const { meos_password, meos_allow_without_password } = parsed.data;
    if (meos_password !== undefined) writeConfigRow(app, MEOS_PASSWORD_KEY, meos_password);
    if (meos_allow_without_password !== undefined) {
      writeConfigRow(
        app,
        MEOS_ALLOW_WITHOUT_PASSWORD_KEY,
        meos_allow_without_password ? 'true' : ''
      );
    }
    return meosSettings(app);
  });

  app.get('/api/settings/integrations', async () => {
    const integrations = INTEGRATIONS_ALLOWLIST.map((key) => resolveIntegrationStatus(app, key));
    return { integrations };
  });

  app.put('/api/settings/integrations', async (req, reply) => {
    const body = req.body as { key?: unknown; value?: unknown } | null;
    if (!body || typeof body !== 'object') {
      return reply.code(400).send({ error: 'invalid_body' });
    }
    if (typeof body.key !== 'string') {
      return reply.code(400).send({
        error: 'invalid_body',
        errors: [{ path: 'key', code: 'invalid', message: 'string required' }],
      });
    }
    if (typeof body.value !== 'string') {
      return reply.code(400).send({
        error: 'invalid_body',
        errors: [{ path: 'value', code: 'invalid', message: 'string required' }],
      });
    }
    // Cap at 512 bytes — real Eventor/Livelox/Liveresultat keys are <100
    // chars; the cap prevents a LAN attacker from inflating the config
    // table with multi-MB writes via this surface.
    if (body.value.length > 512) {
      return reply.code(400).send({
        error: 'invalid_body',
        errors: [{ path: 'value', code: 'too_long', message: 'value exceeds 512 bytes' }],
      });
    }
    if (!isAllowedKey(body.key)) {
      // Allowlist gate — prevents arbitrary config writes via this
      // surface. Without it, a CSRF-style POST could plant whatever
      // key it wanted into the config singleton.
      return reply.code(400).send({ error: 'unknown_integration_key' });
    }
    const key: IntegrationKey = body.key;
    const value = body.value;

    if (value.length === 0) {
      // Empty string = delete the row. Operator clears the field +
      // Spara to revoke the UI-set key (env-set keys still apply via
      // the boot precedence; the UI surfaces a banner explaining that).
      app.fartolaDb.db.delete(configTable).where(eq(configTable.key, key)).run();
    } else {
      app.fartolaDb.db
        .insert(configTable)
        .values({ key, value })
        .onConflictDoUpdate({ target: configTable.key, set: { value } })
        .run();
    }

    // Re-resolve so the response reflects ACTUAL state (env may still
    // win even after a config write — boot precedence is unchanged).
    const status = resolveIntegrationStatus(app, key);
    return reply.code(200).send({
      ok: true,
      key: status.key,
      set: status.set,
      source: status.source,
    });
  });
}
