// Authored for fartola. Not ported from upstream.
//
// IOF XML 3.0 StartList importer. Parses a StartList document and extracts
// PersonStart entries with start times, returning a structured array for the
// caller to match against local competitors.
//
// T-FILE-IMPORT mitigation (per S-5 / T-02.1-06):
// - processEntities: false — billion-laughs cannot expand.
// - DOCTYPE/ENTITY pre-flight rejection in the route (same as parse.ts).
// - The caller caps the body to 5 MB via @fastify/multipart limits.
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-03-PLAN.md task 2
// - REQ-STD-004

import { XMLParser } from 'fast-xml-parser';

// ---------------------------------------------------------------------------
// Safe parser instance — same config as parse.ts (T-FILE-IMPORT parity).
// ---------------------------------------------------------------------------

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // T-FILE-IMPORT: disable ALL entity expansion (billion-laughs prevention).
  processEntities: false,
  allowBooleanAttributes: true,
  parseAttributeValue: true,
  trimValues: true,
});

// ---------------------------------------------------------------------------
// Internal raw-node helpers (mirrors parse.ts).
// ---------------------------------------------------------------------------

type RawNode = Record<string, unknown> | undefined | null;

function toArray<T>(x: T | T[] | undefined | null): T[] {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

function asString(x: unknown): string | null {
  if (x === undefined || x === null) return null;
  if (typeof x === 'string') return x.trim().length > 0 ? x.trim() : null;
  if (typeof x === 'number' || typeof x === 'boolean') return String(x);
  return null;
}

function asInt(x: unknown): number | null {
  const s = asString(x);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Parse an ISO 8601 dateTime string (with or without Z/offset) to epoch ms.
 * Returns null when parsing fails so the caller can exclude the entry rather
 * than crash. */
function parseDateTimeMs(raw: unknown): number | null {
  const s = asString(raw);
  if (s === null) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

// ---------------------------------------------------------------------------
// Public output shape.
// ---------------------------------------------------------------------------

export interface ImportedStartEntry {
  /** IOF-standard "Given Family" display name. */
  name: string;
  givenName: string;
  familyName: string;
  className: string;
  /** Epoch ms parsed from the StartList's StartTime element (UTC). */
  startTimeMs: number;
  /** SI card number from PersonRaceStart > ControlCard, if present. */
  siCard: number | null;
  /** Eventor person ID from Person > Id[@type='Eventor'], if present. */
  eventorPersonId: number | null;
  bibNumber: string | null;
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/** Parse an IOF XML 3.0 StartList document and return an array of structured
 * start entries. Entries without a parseable StartTime are excluded.
 *
 * This function is pure: no IO. The caller is responsible for the DOCTYPE
 * pre-flight and body size cap (import route). */
export function importStartList(xmlSource: string): ImportedStartEntry[] {
  let raw: Record<string, unknown>;
  try {
    raw = parser.parse(xmlSource) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`Malformed XML: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }

  const startList = raw['StartList'] as RawNode;
  if (!startList) {
    throw new Error('XML root element is not <StartList>');
  }

  const entries: ImportedStartEntry[] = [];

  const classStarts = toArray(startList['ClassStart'] as RawNode | RawNode[]);
  for (const cs of classStarts) {
    if (!cs) continue;
    const classNode = (cs['Class'] ?? {}) as RawNode;
    const className = asString(classNode?.['Name']) ?? '';
    if (className.length === 0) continue;

    const personStarts = toArray(cs['PersonStart'] as RawNode | RawNode[]);
    for (const ps of personStarts) {
      if (!ps) continue;

      const personNode = (ps['Person'] ?? {}) as RawNode;
      const nameNode = (personNode?.['Name'] ?? {}) as RawNode;
      const givenName = asString(nameNode?.['Given']) ?? '';
      const familyName = asString(nameNode?.['Family']) ?? '';
      const name = `${givenName} ${familyName}`.trim();
      if (name.length === 0) continue;

      // Eventor person ID — look for Id[@type='Eventor'] under Person.
      let eventorPersonId: number | null = null;
      const personIds = toArray(personNode?.['Id'] as unknown);
      for (const pid of personIds) {
        if (!pid) continue;
        let type: string | null = null;
        let text: unknown;
        if (typeof pid === 'object') {
          const p = pid as Record<string, unknown>;
          type = asString(p['@_type']);
          text = p['#text'] ?? p;
        } else {
          text = pid;
        }
        if (type === null || type === 'Eventor') {
          const n = asInt(text);
          if (n !== null) {
            eventorPersonId = n;
            break;
          }
        }
      }

      // Start element (PersonRaceStart). We take the first Start child.
      const startNodes = toArray(ps['Start'] as RawNode | RawNode[]);
      const startNode = (startNodes[0] ?? {}) as RawNode;

      const startTimeMs = parseDateTimeMs(startNode?.['StartTime']);
      // Exclude entries without a parseable start time.
      if (startTimeMs === null) continue;

      // BibNumber
      const bibNumber = asString(startNode?.['BibNumber']);

      // ControlCard — SI card number (same logic as entryImport).
      let siCard: number | null = null;
      const cards = toArray(startNode?.['ControlCard'] as unknown);
      for (const card of cards) {
        if (!card) continue;
        let punchingSystem: string | null = null;
        let textValue: unknown;
        if (typeof card === 'object') {
          const c = card as Record<string, unknown>;
          punchingSystem = asString(c['@_punchingSystem']);
          textValue = c['#text'] ?? null;
        } else {
          textValue = card;
        }
        if (punchingSystem !== null && punchingSystem !== 'SI') continue;
        const n = asInt(textValue);
        if (n !== null) {
          siCard = n;
          break;
        }
      }

      entries.push({
        name,
        givenName,
        familyName,
        className,
        startTimeMs,
        siCard,
        eventorPersonId,
        bibNumber,
      });
    }
  }

  return entries;
}
