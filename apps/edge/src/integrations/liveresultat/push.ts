// Authored for fartola. Not ported from upstream.
//
// pushToLiveresultat — HTTP POST the MOP XML 2.0 snapshot to
// liveresultat.orientering.se (D-09).
//
// Wire format (from MeOS onlineresults.cpp + RESEARCH):
//   POST <url>
//   Content-Type: multipart/form-data
//   Fields:
//     competition = liveresultat numeric competition ID
//     pwd         = liveresultat upload password
//     <unnamed>   = MOP XML blob
//
// Response check: the body should contain status="OK".
// Any other response (BADPWD, BADCMP, ERROR, …) is treated as a failure.
//
// Timeout: AbortController with a configurable window (default 30 s).
// The caller (queue.ts) wraps this in retry logic — this function itself
// is a single attempt, no retries.
//
// fetchImpl seam: identical to the entries.ts pattern so tests can inject
// a mock without touching globalThis.fetch.
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-07-PLAN.md task 1
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-PATTERNS.md S-3
// - REQ-STD-004

import { setTimeout as setTimer, clearTimeout as clearTimer } from 'node:timers';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface PushToLiveresultatOpts {
  /** Full URL to the liveresultat push endpoint. */
  url: string;
  /** Numeric liveresultat competition ID (stored as competitions.liveresultat_id). */
  competitionId: string;
  /** Liveresultat upload password. */
  password: string;
  /** Pre-built MOP XML 2.0 string (from buildMopXml). */
  mopXml: string;
  /** Optional fetch implementation for testing (defaults to globalThis.fetch). */
  fetchImpl?: typeof fetch;
  /** Abort timeout in ms. Default 30 000 ms. */
  timeoutMs?: number;
}

/** Push a MOP XML 2.0 snapshot to liveresultat.orientering.se.
 *
 * Throws on:
 *   - Network / timeout errors
 *   - Non-OK HTTP status codes
 *   - Response body that does not contain status="OK"
 *
 * Callers (queue.ts) are responsible for retry logic. */
export async function pushToLiveresultat(opts: PushToLiveresultatOpts): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimer(() => controller.abort(), timeoutMs);
  try {
    const form = new FormData();
    form.append('competition', opts.competitionId);
    form.append('pwd', opts.password);
    // The XML body is posted as an unnamed blob field (same as onlineresults.cpp).
    form.append('mop', new Blob([opts.mopXml], { type: 'application/xml' }), 'mop.xml');

    const res = await fetchImpl(opts.url, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(
        `liveresultat push failed: HTTP ${res.status} ${res.statusText} from ${opts.url}`
      );
    }

    const text = await res.text();
    if (!text.includes('status="OK"')) {
      throw new Error(
        `liveresultat push rejected: server response did not contain status="OK" (got: ${text.slice(0, 200)})`
      );
    }
  } finally {
    clearTimer(timer);
  }
}
