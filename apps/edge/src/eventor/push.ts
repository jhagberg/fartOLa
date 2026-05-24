// Authored for fartola. Not ported from upstream.
//
// Eventor results + startlist push (Plan 02.1-08 task 1).
//
// pushToEventor sends an IOF XML 3.0 payload to Eventor's REST import
// endpoint as a PKZIP archive (NOT gzip — Eventor expects real PKZIP per
// the SOFT API guide and as verified by the existing download.ts pattern
// which uses yauzl, the read counterpart of yazl, to decode Eventor's
// ZIP responses).
//
// POST endpoints:
//   {base}import/resultlist  — returns ImportResultListResult.ResultListUrl
//   {base}import/startlist   — returns ImportStartListResult.StartListUrl
//
// Sources:
//   Primary:    "Guide Eventor — Hämta data via API" v2.1
//               (.reference/Guide_Eventor_-_Hamta_data_via_API.pdf)
//   Live docs:  https://eventor.orientering.se/api/documentation
//
// Retry behaviour (per plan spec):
//   - Transient (429, 500, 502, 503): up to 3 attempts with configurable
//     delays (default 1s, 2s, 4s exponential). retryDelaysMs is injected
//     by tests for speed.
//   - Non-retryable (400, 401, 403, 404): throw immediately.
//
// Security (T-02.1-16): ApiKey is sent over HTTPS only (Eventor's base
// URL is https://). The key is never logged — redact.ts covers it at the
// Fastify logger level and this module never calls console.log.
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-08-PLAN.md task 1
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-RESEARCH.md Pattern 4

import { setTimeout as setTimer, clearTimeout as clearTimer } from 'node:timers';
import yazl from 'yazl';
import { XMLParser } from 'fast-xml-parser';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PushEndpoint = 'import/resultlist' | 'import/startlist';

export interface PushToEventorOpts {
  apiKey: string;
  xmlBody: string;
  endpoint: PushEndpoint;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  /** Override retry delays in ms for testing. Default: [1000, 2000, 4000]. */
  retryDelaysMs?: number[];
}

export interface PushToEventorResult {
  url: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'https://eventor.orientering.se/api/';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

/** HTTP status codes that should be retried. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);

// ---------------------------------------------------------------------------
// ZIP helper — wraps xmlBody in a PKZIP archive using yazl.
// Returns a Buffer containing the complete PKZIP archive (PKZIP magic 50 4b 03 04).
// ---------------------------------------------------------------------------

function buildZipBuffer(xmlBody: string, filename: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zipfile = new yazl.ZipFile();
    const xmlBytes = Buffer.from(xmlBody, 'utf-8');
    zipfile.addBuffer(xmlBytes, filename);
    zipfile.end();

    const chunks: Buffer[] = [];
    zipfile.outputStream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    zipfile.outputStream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    zipfile.outputStream.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Response XML parser — extracts the redirect URL from Eventor's response.
// Uses fast-xml-parser to handle namespaces and malformed payloads.
// ---------------------------------------------------------------------------

const XML_PARSER = new XMLParser({ ignoreAttributes: false });

function extractUrlFromResponse(responseXml: string): string | null {
  let parsed: unknown;
  try {
    parsed = XML_PARSER.parse(responseXml);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const root = parsed as Record<string, unknown>;

  // ImportResultListResult.ResultListUrl
  const resultListResult = root['ImportResultListResult'];
  if (resultListResult !== null && typeof resultListResult === 'object') {
    const url = (resultListResult as Record<string, unknown>)['ResultListUrl'];
    if (typeof url === 'string' && url.length > 0) return url;
  }

  // ImportStartListResult.StartListUrl
  const startListResult = root['ImportStartListResult'];
  if (startListResult !== null && typeof startListResult === 'object') {
    const url = (startListResult as Record<string, unknown>)['StartListUrl'];
    if (typeof url === 'string' && url.length > 0) return url;
  }

  return null;
}

// ---------------------------------------------------------------------------
// sleep helper for retry backoff
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimer(resolve, ms));
}

// ---------------------------------------------------------------------------
// Core fetch-with-timeout helper (single attempt)
// ---------------------------------------------------------------------------

async function fetchOnce(
  url: string,
  zipBuffer: Buffer,
  apiKey: string,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimer(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        ApiKey: apiKey,
        'Content-Type': 'application/zip',
      },
      body: zipBuffer,
      signal: controller.signal,
    });
    const body = await res.text();
    return { status: res.status, body };
  } finally {
    clearTimer(timer);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Push an IOF XML 3.0 payload to Eventor as a PKZIP archive.
 *
 * Creates a PKZIP archive via yazl (same author as yauzl already used by
 * download.ts), POSTs to the endpoint with ApiKey + Content-Type:
 * application/zip headers, parses the response XML for the result URL.
 *
 * Retries on transient HTTP errors (429, 500, 502, 503) up to 3 times
 * with exponential backoff. Non-retryable errors (400, 401, 403, 404)
 * throw immediately. */
export async function pushToEventor(opts: PushToEventorOpts): Promise<PushToEventorResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;

  const url = `${baseUrl}${opts.endpoint}`;
  const filename = opts.endpoint === 'import/resultlist' ? 'results.xml' : 'startlist.xml';
  const zipBuffer = await buildZipBuffer(opts.xmlBody, filename);

  let lastError: Error | null = null;
  const maxAttempts = retryDelays.length + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let status: number;
    let body: string;

    try {
      ({ status, body } = await fetchOnce(url, zipBuffer, opts.apiKey, timeoutMs, fetchImpl));
    } catch (err) {
      // Network failure (timeout, DNS error, etc.). Treat as transient and
      // retry if we have attempts remaining; re-throw on last attempt.
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retryDelays.length) {
        await sleep(retryDelays[attempt]!);
        continue;
      }
      throw lastError;
    }

    if (status >= 200 && status < 300) {
      const resultUrl = extractUrlFromResponse(body);
      if (resultUrl === null) {
        throw new Error(
          `pushToEventor: could not extract URL from Eventor response (status ${status}): ${body.slice(0, 200)}`
        );
      }
      return { url: resultUrl };
    }

    // Non-retryable: throw immediately.
    if (!RETRYABLE_STATUSES.has(status)) {
      throw new Error(
        `pushToEventor: Eventor returned non-retryable ${status}: ${body.slice(0, 200)}`
      );
    }

    // Retryable but exhausted attempts.
    if (attempt >= retryDelays.length) {
      throw new Error(
        `pushToEventor: Eventor returned ${status} after ${maxAttempts} attempts: ${body.slice(0, 200)}`
      );
    }

    // Wait and retry.
    lastError = new Error(`pushToEventor: transient ${status}`);
    await sleep(retryDelays[attempt]!);
  }

  // Should be unreachable (loop always exits via return or throw).
  throw lastError ?? new Error('pushToEventor: exhausted attempts');
}
