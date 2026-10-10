// Authored for fartola. Not ported from upstream.
//
// Eventor's class types for an event (SOFT TR 3.4.2): GET
// {base}eventclasses?eventId=N returns the event's <EventClass> elements,
// each with a <Name> and a <ClassType><ClassTypeId> (17 = Åldersklasser,
// 19 = Öppna klasser; verified on a real event in October 2026, incl.
// "D21 Kort"; fixture __fixtures__/eventclasses.xml). The class kind
// suggestion (draw/classKind.ts) prefers this over the class name. Network
// behaviour mirrors fetchEvent.ts.

import { setTimeout as setTimer, clearTimeout as clearTimer } from 'node:timers';

export interface FetchEventorClassTypesOpts {
  apiKey: string;
  eventId: number;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'https://eventor.orientering.se/api/';
const DEFAULT_TIMEOUT_MS = 60_000;

export function first(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`));
  return m && m[1] !== undefined ? m[1].trim() : null;
}

export const unescapeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** Class name → Eventor ClassTypeId, from an EventClassList document. */
export function parseEventClassTypes(xml: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of xml.matchAll(/<EventClass\b[^>]*>([\s\S]*?)<\/EventClass>/g)) {
    // The class's own <Name> comes before <ClassType><Name>; take the first.
    const name = first(m[1]!, 'Name');
    const type = Number(first(m[1]!, 'ClassTypeId'));
    if (name !== null && Number.isInteger(type) && type > 0) out.set(unescapeXml(name), type);
  }
  return out;
}

/** GET {base}{path} with the ApiKey header; the response body. Shared by
 * the Eventor class type and fee fetches. */
export async function eventorGet(opts: FetchEventorClassTypesOpts, path: string): Promise<string> {
  if (!opts.apiKey) throw new Error('missing api key');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl ?? DEFAULT_BASE_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimer(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { ApiKey: opts.apiKey },
      signal: controller.signal,
    });
    if (!res.ok)
      throw new Error(
        `eventor ${path.split('?')[0]} fetch failed: ${res.status} ${res.statusText}`
      );
    return await res.text();
  } finally {
    clearTimer(timer);
  }
}

export async function fetchEventorClassTypes(
  opts: FetchEventorClassTypesOpts
): Promise<Map<string, number>> {
  return parseEventClassTypes(await eventorGet(opts, `eventclasses?eventId=${opts.eventId}`));
}
