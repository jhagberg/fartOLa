// Authored for fartola. Not ported from upstream.
//
// Single XML importer for the Phase 1 single-laptop training MVP. Parses
// either an IOF XML 3.0 CourseData document (the format Purple Pen emits
// when you "Export → XML" — codex review C-L2 wording clarification: a
// Purple Pen `.xml` IS a valid IOF XML 3.0 CourseData document, but it does
// NOT carry competitor entries) OR an IOF XML 3.0 EntryList document.
//
// The endpoint dispatches on the XML ROOT ELEMENT, not on the file source:
//   <CourseData>  → ParsedCourseData    (Purple Pen + IOF 3.0 course-setting)
//   <EntryList>   → ParsedEntryList     (IOF 3.0 entries — name + club + class + card)
//
// Two requirements (REQ-EVT-CMP-002 Purple Pen, REQ-EVT-CMP-003 IOF
// EntryList, REQ-STD-001 IOF XML 3.0) collapse to ONE parser + ONE route.
//
// T-FILE-IMPORT mitigation (the core security gate this file provides):
// - `processEntities: false` on the fast-xml-parser config — billion-laughs
//   cannot expand because we never resolve declared entities.
// - Pre-flight DOCTYPE + ENTITY regex rejection so a hostile document never
//   even reaches the parser; we surface a 400 with a clear message instead.
// - The caller (apps/edge/src/routes/import.ts) caps the request body with
//   Fastify's bodyLimit (5 MB) before this code runs.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-05-PLAN.md task 1
// - .planning/phases/01-single-laptop-training-mvp/01-CONTEXT.md D-03
//   (Phase 1 imports = Purple Pen + IOF XML 3.0 EntryList)
// - .planning/phases/01-single-laptop-training-mvp/01-REVIEWS.md §C-L2
//   (Purple Pen .xml wording — valid IOF 3.0 CourseData but does NOT carry
//   entries; entries arrive separately via EntryList; one parser dispatches
//   on root element, not on file source)
// - .planning/phases/01-single-laptop-training-mvp/01-RESEARCH.md
//   §"Don't Hand-Roll" (fast-xml-parser is the locked dependency)
// - .planning/phases/01-single-laptop-training-mvp/01-RESEARCH.md
//   §"Security Domain V12 + V5" (T-FILE-IMPORT mitigations: entity off +
//   DOCTYPE pre-flight + bodyLimit cap)

import { XMLParser } from 'fast-xml-parser';

// ---------------------------------------------------------------------------
// Normalized output shapes — the downstream ingester contracts.
// ---------------------------------------------------------------------------

export interface ParsedCourseData {
  kind: 'CourseData';
  event_name: string;
  /** Classes typically live under <Event><Class> in IOF 3.0 CourseData. */
  classes: Array<{ id: string; name: string; short_name: string | null }>;
  /** Controls live under <RaceCourseData><Control>. */
  controls: Array<{ code: number }>;
  courses: Array<{
    id: string;
    name: string;
    /** Class name that this course is assigned to (via
     * ClassCourseAssignment.ClassName), or null if no assignment. When
     * several classes share the course this is the last one (legacy). */
    class_id_ref: string | null;
    /** 02.1-14 Task 4: every class assigned to this course, in document
     * order. Omitted by hand-built inputs; readers fall back to class_id_ref. */
    class_refs?: string[];
    length_m: number | null;
    climb_m: number | null;
    /** Control codes in CourseControl-sequence order. We ONLY include
     * type='Control' rungs; the implicit Start + Finish course controls are
     * filtered because our schema's controls table represents punchable
     * controls (SI codes 31+), not start/finish flags. */
    control_codes: number[];
  }>;
}

export interface ParsedEntryList {
  kind: 'EntryList';
  event_name: string;
  competitors: Array<{
    /** "Given Family" — the wire shape the schema's competitors.name expects. */
    name: string;
    /** <Organisation><Name>, or null if absent. */
    club: string | null;
    /** <Class><Name> — name only; IDs vary between systems. The ingester
     * matches by class name against the competition's classes table. */
    class_name: string;
    /** Numeric SI card number from <ControlCard punchingSystem="SI">.
     * Non-SI cards or empty card values become null. */
    card_number: number | null;
  }>;
}

export type ParsedXml =
  | { kind: 'CourseData'; data: ParsedCourseData }
  | { kind: 'EntryList'; data: ParsedEntryList };

// ---------------------------------------------------------------------------
// Parser instance — safe-by-default for untrusted input. Configured once at
// module load; reused across calls.
// ---------------------------------------------------------------------------

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // T-FILE-IMPORT: disable ALL entity expansion. Combined with the DOCTYPE
  // pre-flight below this closes the billion-laughs vector entirely.
  processEntities: false,
  allowBooleanAttributes: true,
  // Preserve numeric attribute values where possible (e.g. createTime stays
  // a string; lng/lat/Length stay numeric).
  parseAttributeValue: true,
  trimValues: true,
});

// ---------------------------------------------------------------------------
// Public API — dispatch on root element. Throws on adversarial or
// unrecognized input.
// ---------------------------------------------------------------------------

export function parseIofXml(xmlSource: string): ParsedXml {
  if (typeof xmlSource !== 'string' || xmlSource.length === 0) {
    throw new Error('Empty XML input');
  }
  // T-FILE-IMPORT pre-flight: reject DOCTYPE and any declared entities
  // BEFORE we hand the bytes to fast-xml-parser. Belt + suspenders with
  // processEntities: false.
  if (/<!DOCTYPE/i.test(xmlSource)) {
    throw new Error('DOCTYPE not allowed');
  }
  if (/<!ENTITY/i.test(xmlSource)) {
    throw new Error('ENTITY declarations not allowed');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xmlSource) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`Malformed XML: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }

  // Find the first non-prolog top-level key — the document's root element.
  const rootKey = Object.keys(parsed).find((k) => !k.startsWith('?') && !k.startsWith('@_'));
  if (!rootKey) {
    throw new Error('No XML root element');
  }

  if (rootKey === 'CourseData') {
    return {
      kind: 'CourseData',
      data: normalizeCourseData(parsed.CourseData as RawNode),
    };
  }
  if (rootKey === 'EntryList') {
    return {
      kind: 'EntryList',
      data: normalizeEntryList(parsed.EntryList as RawNode),
    };
  }
  throw new Error(
    `Unsupported XML root element: ${rootKey}. ` +
      'Expected CourseData (Purple Pen, IOF XML 3.0) or EntryList (IOF XML 3.0). ' +
      'Note: Purple Pen .xml IS valid IOF XML 3.0 CourseData but does not carry entries; ' +
      'upload an EntryList file for competitor data.'
  );
}

// ---------------------------------------------------------------------------
// Normalizers
//
// fast-xml-parser returns objects where:
//   - missing children       → key absent
//   - one child of a tag     → single object
//   - many children of a tag → array of objects
//   - text content of a leaf → primitive value at the key
//
// We normalize to arrays of plain JS shapes the ingester can iterate. Helpers
// (toArray, asNumber, asString) wrap the awkward "one vs. many" duality.
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

function asNumber(x: unknown): number | null {
  if (x === undefined || x === null) return null;
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x === 'string' && x.trim().length > 0) {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asInt(x: unknown): number | null {
  const n = asNumber(x);
  if (n === null) return null;
  // SI codes are integers; truncate doubles like 31.0.
  return Math.trunc(n);
}

function normalizeCourseData(raw: RawNode): ParsedCourseData {
  const node = raw ?? {};
  const event = (node.Event ?? {}) as RawNode;
  const eventName = asString(event?.Name) ?? '';

  // Classes — IOF 3.0 puts them under <Event><Class>; some emitters put a
  // separate Class list at the root. Accept both.
  const rawClasses: RawNode[] = [
    ...toArray(event?.Class as RawNode | RawNode[]),
    ...toArray(node.Class as RawNode | RawNode[]),
  ];
  const classes: ParsedCourseData['classes'] = [];
  const seenClassNames = new Set<string>();
  for (const c of rawClasses) {
    if (!c) continue;
    const name = asString(c.Name);
    if (!name || seenClassNames.has(name)) continue;
    seenClassNames.add(name);
    const id = asString(c.Id) ?? name;
    classes.push({ id, name, short_name: asString(c.ShortName) });
  }

  // RaceCourseData (1..n). We flatten controls + courses across races; for
  // Phase 1 single-laptop, single-race events are the norm but the schema
  // allows multi-race — we treat each Control/Course element uniformly.
  const rcdArr = toArray(node.RaceCourseData as RawNode | RawNode[]);
  const controls: ParsedCourseData['controls'] = [];
  const seenCodes = new Set<number>();
  const courses: ParsedCourseData['courses'] = [];
  // Map <ClassCourseAssignment>: CourseName → ClassNames so we can fill
  // class_id_ref / class_refs on the course rows. Many classes may share a
  // course, so every assignment is kept (02.1-14 Task 4).
  const classesByCourseName = new Map<string, string[]>();

  for (const rcd of rcdArr) {
    if (!rcd) continue;

    for (const a of toArray(rcd.ClassCourseAssignment as RawNode | RawNode[])) {
      if (!a) continue;
      const courseName = asString(a.CourseName);
      const className = asString(a.ClassName);
      if (!courseName || !className) continue;
      const refs = classesByCourseName.get(courseName) ?? [];
      if (!refs.includes(className)) refs.push(className);
      classesByCourseName.set(courseName, refs);
    }

    for (const ctl of toArray(rcd.Control as RawNode | RawNode[])) {
      if (!ctl) continue;
      // <Id> carries the control code in IOF 3.0 (the documentation reads
      // "The code of the control.").
      const code = asInt(ctl.Id);
      if (code === null) continue;
      if (seenCodes.has(code)) continue;
      seenCodes.add(code);
      controls.push({ code });
    }

    for (const crs of toArray(rcd.Course as RawNode | RawNode[])) {
      if (!crs) continue;
      const name = asString(crs.Name);
      if (!name) continue;
      const id = asString(crs.Id) ?? name;
      const lengthM = asInt(crs.Length);
      const climbM = asInt(crs.Climb);
      // CourseControl: each carries a <Control> child whose text is the
      // control code as a string. CourseControl has an optional @type
      // attribute ('Start', 'Control', 'Finish'); we keep only 'Control'
      // (the default — XSD says default is 'Control') because Start and
      // Finish do not map to punchable rows in our schema.
      const ccArr = toArray(crs.CourseControl as RawNode | RawNode[]);
      const control_codes: number[] = [];
      for (const cc of ccArr) {
        if (!cc) continue;
        const type = asString(cc['@_type']) ?? 'Control';
        if (type !== 'Control') continue;
        // Control text content can be a string, a number, or (rare) an
        // array if there are forks at this rung. We take the first element
        // in the array case.
        const rawControl = cc.Control;
        const first = Array.isArray(rawControl) ? rawControl[0] : rawControl;
        const code = asInt(first);
        if (code !== null) control_codes.push(code);
      }
      const classRefs = classesByCourseName.get(name) ?? [];
      courses.push({
        id,
        name,
        class_id_ref: classRefs[classRefs.length - 1] ?? null,
        class_refs: classRefs,
        length_m: lengthM,
        climb_m: climbM,
        control_codes,
      });
    }
  }

  return {
    kind: 'CourseData',
    event_name: eventName,
    classes,
    controls,
    courses,
  };
}

function normalizeEntryList(raw: RawNode): ParsedEntryList {
  const node = raw ?? {};
  const event = (node.Event ?? {}) as RawNode;
  const eventName = asString(event?.Name) ?? '';

  const entries = toArray(node.PersonEntry as RawNode | RawNode[]);
  const competitors: ParsedEntryList['competitors'] = [];

  for (const e of entries) {
    if (!e) continue;
    const person = (e.Person ?? {}) as RawNode;
    const personName = (person?.Name ?? {}) as RawNode;
    const given = asString(personName?.Given) ?? '';
    const family = asString(personName?.Family) ?? '';
    const name = `${given} ${family}`.trim();
    if (name.length === 0) continue;

    const org = (e.Organisation ?? {}) as RawNode;
    const club = asString(org?.Name);

    // <Class> may be Class[] or Class{}. We take the first one — IOF 3.0
    // PersonEntry allows multiple classes in order of preference; Phase 1
    // assigns to the first preference.
    const classArr = toArray(e.Class as RawNode | RawNode[]);
    const klass = classArr[0] ?? {};
    const class_name = asString((klass as RawNode)?.Name) ?? '';
    if (class_name.length === 0) continue;

    // ControlCard — keep only SI cards. The element is mixed content:
    // simpleContent extension of xsd:string with @punchingSystem attribute.
    // fast-xml-parser yields either a primitive string OR an object with
    // '#text' + '@_punchingSystem' when attrs exist.
    let card_number: number | null = null;
    for (const card of toArray(e.ControlCard as unknown)) {
      if (card === null || card === undefined) continue;
      let punchingSystem: string | null = null;
      let textValue: unknown;
      if (typeof card === 'object') {
        const c = card as Record<string, unknown>;
        punchingSystem = asString(c['@_punchingSystem']);
        textValue = c['#text'] ?? null;
      } else {
        textValue = card;
      }
      // Only accept cards with no system declared (legacy) or system="SI".
      if (punchingSystem !== null && punchingSystem !== 'SI') continue;
      const n = asInt(textValue);
      if (n !== null) {
        card_number = n;
        break;
      }
    }

    competitors.push({ name, club, class_name, card_number });
  }

  return { kind: 'EntryList', event_name: eventName, competitors };
}
