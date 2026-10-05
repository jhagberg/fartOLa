// Authored for fartola. Not ported from upstream.
//
// Secret resolver — shared helper that lifts the env→config→absent
// precedence out of apps/edge/src/eventor/boot.ts and
// apps/edge/src/routes/eventor.ts. Plan 02-07 task 2 wires the new
// PUT /api/settings/integrations write path (task 1) to the same
// config row the next bridge boot reads. process.env wins so headless
// / CI installs that already export EVENTOR_API_KEY keep working
// without surprise overrides from the UI.
//
// Empty strings are treated as absent on BOTH sides — `EVENTOR_API_KEY=`
// (env set but empty) must NOT silently shadow a real config value, and
// a `config` row written as an empty string from a UI clear should
// behave the same as a deleted row. boot.ts has always had
// `!apiKey || apiKey.length === 0` short-circuit on the env path;
// resolveSecret matches that contract so the helper and the legacy
// inline check produce identical results during the refactor.
//
// Locked by:
// - .planning/phases/02-4-klubbs-mvp/02-07-PLAN.md task 2
// - apps/edge/src/routes/settings.ts (the PUT writer that targets the
//   same config row resolved here)

import { eq } from 'drizzle-orm';

import type { DbHandle } from '../db/index.ts';
import { config as configTable } from '../db/schema.ts';

export type SecretSource = 'env' | 'config' | 'absent';

/** Read the config table for a single key. Returns null when missing
 * or when the stored value is the empty string (matches the resolve-
 * absent semantics). */
function readConfigSecret(handle: DbHandle, key: string): string | null {
  const row = handle.db
    .select({ value: configTable.value })
    .from(configTable)
    .where(eq(configTable.key, key))
    .get();
  if (!row || !row.value || row.value.length === 0) return null;
  return row.value;
}

/** Resolve a secret value by precedence: process.env > config table >
 * undefined. Returns undefined when neither source has a non-empty
 * value. Use this in route handlers / boot wiring; for the source
 * tag used by /status surfaces, call resolveSecretSource. */
export function resolveSecret(handle: DbHandle, key: string): string | undefined {
  const envValue = process.env[key];
  if (envValue !== undefined && envValue.length > 0) {
    return envValue;
  }
  const cfgValue = readConfigSecret(handle, key);
  if (cfgValue !== null) {
    return cfgValue;
  }
  return undefined;
}

/** Companion to resolveSecret that returns the source tag the UI uses
 * to render the "Värdet kommer från ~/.env.fartola …" banner and the
 * /status `source` field. */
export function resolveSecretSource(handle: DbHandle, key: string): SecretSource {
  const envValue = process.env[key];
  if (envValue !== undefined && envValue.length > 0) {
    return 'env';
  }
  const cfgValue = readConfigSecret(handle, key);
  if (cfgValue !== null) {
    return 'config';
  }
  return 'absent';
}

/** MeOS integration (GET /mip, POST /mop) password, and the operator's
 * explicit choice to run without one (D-MOP-4 / D-MIP-1, revised
 * 2026-10-05). Stored like the API keys: env > config table > absent. */
export const MEOS_PASSWORD_KEY = 'MEOS_PASSWORD';
export const MEOS_ALLOW_WITHOUT_PASSWORD_KEY = 'MEOS_ALLOW_WITHOUT_PASSWORD';

export interface MeosAccessConfig {
  password: string | undefined;
  allowWithoutPassword: boolean;
}

export function resolveMeosAccess(handle: DbHandle): MeosAccessConfig {
  return {
    password: resolveSecret(handle, MEOS_PASSWORD_KEY),
    allowWithoutPassword: resolveSecret(handle, MEOS_ALLOW_WITHOUT_PASSWORD_KEY) === 'true',
  };
}
