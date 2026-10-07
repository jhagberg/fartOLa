// Authored for fartola. Not ported from upstream.
//
// Fetch metadata for a single Eventor event by its numeric event ID.
//
// Calls GET /api/event/:id on the Eventor REST API with the ApiKey header.
// Returns { eventId, name, startDate, organisation } on success.
//
// Error semantics match download.ts:
//   - 60 s AbortController timeout by default
//   - throws 'not_found' on HTTP 404
//   - throws 'forbidden' on HTTP 403
//   - throws on non-2xx or missing body
//   - throws 'missing api key' when apiKey absent (checked pre-fetch)
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-11-PLAN.md
//   Task 1: GET /api/eventor/events/:id handler spec

import { setTimeout as setTimer, clearTimeout as clearTimer } from 'node:timers';

export interface EventorEventMeta {
  eventId: number;
  name: string;
  /** ISO date YYYY-MM-DD. */
  startDate: string;
  /** Organising club/organisation name; may be null when not present in XML. */
  organisation: string | null;
}

export interface FetchEventorEventOpts {
  apiKey: string;
  eventId: number;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'https://eventor.orientering.se/api/';
const DEFAULT_TIMEOUT_MS = 60_000;

/** Extract the first occurrence of <tag>...</tag> from an XML string. */
function extractFirst(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`));
  return m && m[1] !== undefined ? m[1].trim() : null;
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Fetch metadata for a single Eventor event.
 *
 * Uses GET {base}event/{eventId} — the same endpoint documented in the
 * SOFT API guide (page 3 example uses `/api/event/{eventId}`).
 */
export async function fetchEventorEvent(opts: FetchEventorEventOpts): Promise<EventorEventMeta> {
  if (!opts.apiKey || opts.apiKey.length === 0) {
    throw new Error('missing api key');
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${baseUrl}event/${opts.eventId}`;

  const controller = new AbortController();
  const timer = setTimer(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { ApiKey: opts.apiKey },
      signal: controller.signal,
    });
    if (res.status === 404) {
      throw new Error('not_found');
    }
    if (res.status === 403) {
      throw new Error('forbidden');
    }
    if (!res.ok) {
      throw new Error(`eventor event fetch failed: ${res.status} ${res.statusText}`);
    }
    const xml = await res.text();

    // Parse the relevant fields from the Eventor Event XML.
    // The structure is: <Event><EventId/><Name/><StartDate><Date/></StartDate>
    //                          <Organiser><Organisation><Name/></Organisation></Organiser>
    const idStr = extractFirst(xml, 'EventId');
    const nameRaw = extractFirst(xml, 'Name');
    const startDateBlock = extractFirst(xml, 'StartDate');
    const date = startDateBlock ? extractFirst(startDateBlock, 'Date') : null;

    // Organisation name — may be nested inside <Organiser><Organisation>
    const organiserBlock = extractFirst(xml, 'Organiser');
    const orgBlock = organiserBlock ? extractFirst(organiserBlock, 'Organisation') : null;
    const orgNameRaw = orgBlock ? extractFirst(orgBlock, 'Name') : null;

    const eventId = idStr !== null ? Number.parseInt(idStr, 10) : opts.eventId;
    const name = nameRaw !== null ? unescapeXml(nameRaw) : `Event ${opts.eventId}`;
    const startDate = date !== null && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
    const organisation = orgNameRaw !== null ? unescapeXml(orgNameRaw) : null;

    return { eventId, name, startDate, organisation };
  } finally {
    clearTimer(timer);
  }
}
