// Authored for fartola. Not ported from upstream.
//
// Pino redaction paths for the Fastify logger.
//
// Surface protected:
//   - PUT /api/settings/* request bodies carry API keys (EVENTOR_API_KEY etc.).
//     The `body.value` path family scrubs those.
//   - liveresultat_pwd / liveresultatPwd: the liveresultat upload password is
//     stored on competition rows and passed through queue config objects. Any
//     log call that accidentally includes a config object would leak the pwd
//     without explicit redaction. Plan 02.1-07 task 2 adds these paths.
//     T-02.1-13 (Information Disclosure mitigation).
//
// Pino redact docs: https://getpino.io/#/docs/redaction. Paths use the
// fast-redact selector syntax — wildcards allowed at one level. We redact:
//
//   - req.body.value: scrub any request body's `value` field. Specific
//     to the integrations PUT — other routes never name a field
//     `value` at the top level (verified across apps/edge/src/routes/*
//     2026-05-17).
//   - res.body.value: belt-and-suspenders — fastify never echoes the
//     request body to res.body by default, but a future error handler
//     might mistakenly include the body in the response. Redact here
//     so any such regression cannot leak.
//   - liveresultat_pwd / liveresultatPwd: direct field redaction for the
//     liveresultat password in any log object shape.
//
// CRITICAL: the censor string is the pino default ('[REDACTED]') so
// log readers can grep for it to spot accidental key paste-debug.
//
// Locked by:
// - .planning/phases/02-4-klubbs-mvp/02-07-PLAN.md task 1 (truth-key #4)
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-07-PLAN.md
//   task 2 (T-02.1-13 mitigate)
// - OWASP A02:2021 (cryptographic / secret material write-only field)

/** Pino fast-redact path list for the Fastify logger.
 *
 * Path semantics (fast-redact):
 *   - `body.value` — catches handlers that explicitly log `{ body: ... }`
 *     (the typical "log this incoming payload" debug pattern).
 *   - `*.body.value` — catches handlers that log a nested object whose
 *     immediate child is a `body` envelope (e.g. `{ req: { body: ... } }`
 *     when the pino req-serializer is bypassed).
 *   - `request.body.value` / `req.body.value` — explicit fastify
 *     request-style keys.
 *   - `liveresultat_pwd` / `liveresultatPwd` — liveresultat upload password
 *     in any top-level or nested log object. Both snake_case (DB column name)
 *     and camelCase (TS property name) are covered so neither form leaks.
 *     T-02.1-13 mitigate.
 *   - `body.code` / `*.body.code` / `req.body.code` — event admin code in
 *     POST /access and POST /api/competitions/:id/event-codes request bodies.
 *     The plaintext code is returned ONCE on generation and must never appear
 *     in logs. T-02.1-26 mitigate.
 *   - `body.event_code` — alternative field name alias for belt-and-suspenders.
 *
 * Intentionally scoped to the `body.value` shape for API keys — a bare
 * top-level `value` would mask unrelated debug data (e.g. `log.info({ value:
 * 42 }, 'count')`) which costs more in observability than it buys in defense.
 *
 * Phase-3 expansion: when LIVELOX_API_KEY / LIVERESULTAT_API_KEY land as
 * PUT /api/settings keys, no change needed for the body.value family — those
 * paths inherit the redaction automatically. */
export const LOGGER_REDACT_PATHS: readonly string[] = [
  'body.value',
  '*.body.value',
  'req.body.value',
  'request.body.value',
  // liveresultat_pwd — T-02.1-13 mitigate (plan 02.1-07 task 2)
  'liveresultat_pwd',
  '*.liveresultat_pwd',
  // The PATCH …/liveresultat/credentials body (SOFT TR 7.7.1) under a request
  // envelope.
  'req.body.liveresultat_pwd',
  'request.body.liveresultat_pwd',
  'liveresultatPwd',
  '*.liveresultatPwd',
  // event admin code — T-02.1-26 mitigate (plan 02.1-12)
  // Covers req.body.code (POST /access) and res body code (POST /event-codes).
  'body.code',
  '*.body.code',
  'req.body.code',
  'request.body.code',
  'body.event_code',
  // MeOS integration password — PUT /api/settings/meos (2026-10-05)
  'body.meos_password',
  '*.body.meos_password',
  'req.body.meos_password',
  'request.body.meos_password',
  '*.body.event_code',
];

/** Default pino redact config for buildServer. Censor matches the pino
 * default so existing grep tooling (`journalctl --user -u fartola | grep
 * REDACTED`) keeps working. */
export const LOGGER_REDACT_OPTIONS = {
  paths: [...LOGGER_REDACT_PATHS],
  censor: '[REDACTED]',
} as const;

/** Query parameters that carry a secret. MeOS's password `pwd` is also
 * accepted as a query parameter (integrations/meos/access.ts); the request
 * log line would otherwise hold it in plain text. The only secret any route
 * takes from the query string. */
const SECRET_QUERY_PARAMS = new Set(['pwd']);

/** `url` with the value of every secret query parameter replaced by `***`.
 * Keys are compared decoded and case-insensitively (`p%77d`, `PWD`). */
export function redactUrl(url: string): string {
  const q = url.indexOf('?');
  if (q === -1) return url;
  const pairs = url
    .slice(q + 1)
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      const key = eq === -1 ? pair : pair.slice(0, eq);
      let name = key;
      try {
        name = decodeURIComponent(key.replace(/\+/g, ' '));
      } catch {
        /* malformed escape — compare the raw key */
      }
      return SECRET_QUERY_PARAMS.has(name.toLowerCase()) ? `${key}=***` : pair;
    });
  return `${url.slice(0, q)}?${pairs.join('&')}`;
}

/** Fastify's default `req` log serializer (fastify/lib/logger-pino.js) with
 * the URL passed through redactUrl. Every request's "incoming request" line
 * goes through it, and so does any log object with a `req` key that is not a
 * request (no url: logged without one, never a throw). */
export const LOGGER_SERIALIZERS = {
  req(req: {
    method: string;
    url: string;
    headers?: Record<string, unknown>;
    host?: string;
    ip?: string;
    socket?: { remotePort?: number };
  }): Record<string, unknown> {
    return {
      method: req.method,
      url: typeof req.url === 'string' ? redactUrl(req.url) : undefined,
      version: req.headers?.['accept-version'],
      host: req.host,
      remoteAddress: req.ip,
      remotePort: req.socket?.remotePort,
    };
  },
};
