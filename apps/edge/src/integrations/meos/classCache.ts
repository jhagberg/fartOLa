// Authored for fartola. Not ported from upstream.
//
// MeOS class cache — fetches the MeOS REST ?get=class endpoint and caches
// the classname→classid mapping so MIP <entry> elements can include the
// classid attribute that MeOS needs to avoid the "Okänd klass" rejection
// (restserver.cpp:1372 bug addressed by D-13).
//
// Design decisions:
//   - 5-minute TTL. Per-poll refresh wastes resources (GPT+Gemini MEDIUM
//     review concern). On TTL expiry, a refresh is attempted; if it fails,
//     the stale cache is served so MIP stays functional even when MeOS REST
//     is temporarily unreachable.
//   - Graceful degradation. Any fetch or parse error returns an empty Map
//     (or the stale cache on TTL expiry). The caller uses ?? 0 as the
//     classid fallback per D-13: MeOS falls back to name lookup when
//     classid=0.
//   - 5s fetch timeout (T-02.1-18 mitigation — DoS via slow MeOS response).
//   - fetchImpl injection for unit testing (no live network in CI).
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-09-PLAN.md
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-PATTERNS.md
//   lines 370-395 (classCache pattern)

import { XMLParser } from 'fast-xml-parser';
import { toArray, asInt, asString } from './shared.ts';

/** TTL in milliseconds — 5 minutes. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Fetch timeout — 5 seconds (T-02.1-18). */
const FETCH_TIMEOUT_MS = 5_000;

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

/** Internal cache state. Exposed via `getClassCacheForTest()` for unit tests. */
interface CacheState {
  map: Map<string, number>;
  fetchedAtMs: number | null;
}

let _cache: CacheState = { map: new Map(), fetchedAtMs: null };

/** Parses a MeOS ?get=class XML response body into a classname→classid Map.
 * Returns an empty Map on any parse error. */
function parseClassXml(xml: string): Map<string, number> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    processEntities: false,
    allowBooleanAttributes: true,
    parseAttributeValue: true,
    trimValues: true,
    removeNSPrefix: true,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return new Map();
  }

  // Root: MOPComplete (namespace stripped by removeNSPrefix).
  const root = parsed['MOPComplete'] as Record<string, unknown> | undefined;
  if (!root) return new Map();

  const clsList = toArray(root['cls'] as unknown);
  const entries: [string, number][] = [];
  for (const raw of clsList) {
    const cls = raw as Record<string, unknown>;
    const id = asInt(cls['@_id']);
    const name = asString(cls['#text']);
    if (id !== null && name !== null && name.length > 0) {
      entries.push([name, id]);
    }
  }
  return new Map(entries);
}

/**
 * Fetch the MeOS class list and return a Map<classname, classid>.
 *
 * Uses a 5-minute TTL cache. On TTL expiry, attempts a refresh; on failure
 * serves the stale cache. On the very first call, a failure returns an empty
 * Map (no stale data available yet).
 *
 * @param meosHost - Hostname/IP of the MeOS server (port 2009 is implied).
 * @param fetchImpl - Injectable fetch implementation (defaults to global fetch).
 */
export async function refreshClassCache(
  meosHost: string,
  fetchImpl: FetchImpl = fetch
): Promise<Map<string, number>> {
  const nowMs = Date.now();
  const isFresh = _cache.fetchedAtMs !== null && nowMs - _cache.fetchedAtMs < CACHE_TTL_MS;

  if (isFresh) {
    return _cache.map;
  }

  // Attempt a refresh.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let xml: string;
    try {
      const res = await fetchImpl(`http://${meosHost}:2009/?get=class`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`MeOS REST error: ${res.status} ${res.statusText}`);
      xml = await res.text();
    } finally {
      clearTimeout(timer);
    }

    const newMap = parseClassXml(xml);
    _cache = { map: newMap, fetchedAtMs: nowMs };
    return newMap;
  } catch (err) {
    // Graceful degradation: serve stale cache if available, otherwise empty Map.
    if (_cache.fetchedAtMs !== null) {
      // Log is intentionally minimal — callers that care will handle classid=0.
      console.warn(
        '[classCache] refresh failed, serving stale cache:',
        err instanceof Error ? err.message : err
      );
      return _cache.map;
    }
    console.warn(
      '[classCache] initial fetch failed, returning empty Map:',
      err instanceof Error ? err.message : err
    );
    return new Map();
  }
}

// ============================================================================
// Test helpers — only used by classCache.test.ts. Not part of the public API.
// ============================================================================

/** Resets the module-level cache to its initial state.
 * Call in `beforeEach` for tests that need a clean cache. */
export function resetClassCacheForTest(): void {
  _cache = { map: new Map(), fetchedAtMs: null };
}

/** Returns a handle to the internal cache with test-only methods. */
export function getClassCacheForTest(): {
  seed(map: Map<string, number>): void;
  expireNow(): void;
} {
  return {
    /** Seeds the cache with a pre-built Map and marks it fresh (fetchedAtMs = now). */
    seed(map: Map<string, number>): void {
      _cache = { map, fetchedAtMs: Date.now() };
    },
    /** Rewinds fetchedAtMs so the TTL has expired, forcing the next call to re-fetch. */
    expireNow(): void {
      if (_cache.fetchedAtMs !== null) {
        _cache = { ..._cache, fetchedAtMs: _cache.fetchedAtMs - CACHE_TTL_MS - 1 };
      }
    },
  };
}
