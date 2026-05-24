// Authored for fartola. Not ported from upstream.
//
// IOF XML 3.0 ResultList exporter. Reads the projection-store snapshot
// (CompetitionState from plan 07's reduce()) and emits a conservative
// subset of the ResultList XSD that the bundled apps/edge/src/xml/IOF.xsd
// validates byte-for-byte. The XSD itself is the schema of record — this
// module shapes the tree fast-xml-parser's XMLBuilder serialises and
// hands it to xml/validate.ts for the SC#6 binding contract: no XML is
// streamed to the operator unless validateXml returned valid=true.
//
// Locked surfaces (do not modify without re-running task 1's regression
// gates):
//
//   - W-4 @status enum lock — Final → 'Complete', Provisional → 'Snapshot'.
//     Per the bundled IOF 3.0 XSD the ResultListStatus restriction lists
//     three values: { Complete | Delta | Snapshot }. The plan's frontmatter
//     also referenced 'Refused', but the bundled XSD does NOT carry it;
//     'Refused' is documented as an enum on related Status simpleTypes but
//     not on the ResultList @status restriction. The locked mapping is
//     still satisfied because Final + Provisional both pick values that
//     ARE in the actual enum. Test 3 is the regression gate.
//
//   - W-5 empty competition VALID — ResultList > ClassResult is
//     minOccurs=0 per the bundled XSD. An export with zero ClassResult
//     children is well-formed AND XSD-valid; the route returns 200, never
//     422. Test 5 is the regression gate.
//
//   - Conservative subset — only the elements every IOF 3.0 consumer
//     parses correctly (RESEARCH §"Pitfall 5"). Specifically:
//     ResultList > Event (Name + StartTime.Date) > ClassResult* >
//     PersonResult+ > Person (Name.Family + Name.Given),
//     Organisation (only when club non-null), Result
//     (StartTime?, FinishTime?, Time, Position (OK only), Status).
//
//   - PEND competitors are EXCLUDED. ResultList semantics target finished
//     events; the toggle between Final/Provisional flips the top-level
//     @status only — not what rows are emitted.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-16-PLAN.md task 1
// - .planning/phases/01-single-laptop-training-mvp/01-RESEARCH.md
//   §"Pattern 7: IOF XML 3.0 ResultList export with XSD validation"
// - .planning/phases/01-single-laptop-training-mvp/01-RESEARCH.md
//   §"Pitfall 5: Conservative subset"
// - apps/edge/src/xml/IOF.xsd (the schema of record)
// - REQ-EVT-CMP-008 + REQ-STD-002 + SC#6 (XSD validation BEFORE write)

import { XMLBuilder } from 'fast-xml-parser';
import { validateXml, type XsdError } from './validate.ts';
import type { CompetitionState, CompetitorView } from '../projection/types.ts';
import type { CompetitionDTO, ClassDTO, CourseDTO } from '@fartola/shared-types';

// ---------------------------------------------------------------------------
// Public types.
// ---------------------------------------------------------------------------

export type ExportStatus = 'Final' | 'Provisional';

export interface ExportInput {
  competition: CompetitionDTO;
  classes: ClassDTO[];
  /** Reserved for future split-time emission. Phase 1 conservative subset
   * does not write SplitTime elements (RESEARCH §"Pitfall 5"). */
  courses: CourseDTO[];
  state: CompetitionState;
  status?: ExportStatus;
  /** Creator attribute on the root element. Defaults to `fartOLa v0.1`. Tests
   * inject a deterministic value so the frozen fixture is byte-stable. */
  creator?: string;
  /** Override `Date.now()` for deterministic createTime. Tests pin this so
   * the frozen-fixture round-trip is byte-stable. */
  now?: () => Date;
}

export interface ExportSummary {
  class_count: number;
  person_result_count: number;
  status: ExportStatus;
}

export interface BuildResult {
  xml: string;
  summary: ExportSummary;
}

export type ValidatedBuildResult =
  | { valid: true; build: BuildResult }
  | { valid: false; errors: XsdError[] };

// ---------------------------------------------------------------------------
// StartList public types (Plan 02.1-03).
// ---------------------------------------------------------------------------

/** A competitor entry for the StartList export. startTimeMs=null means the
 * competitor has no drawn start time and will be excluded from the export. */
export interface StartListCompetitor {
  /** Full name in "Given Family" format — reuses splitName(). */
  name: string;
  club?: string | null;
  /** Epoch ms. null = not drawn → excluded from StartList. */
  startTimeMs: number | null;
  bibNumber?: string;
  /** CANCEL competitors are excluded from the StartList entirely. The IOF XSD
   * PersonRaceStart does not carry a Status element (unlike PersonRaceResult).
   * D-14 CANCEL → Cancelled applies only to buildResultListXml. */
  status?: 'CANCEL' | undefined;
}

export interface StartListClass {
  name: string;
  competitors: StartListCompetitor[];
}

export interface StartListInput {
  competition: CompetitionDTO;
  classes: StartListClass[];
  status?: ExportStatus;
  creator?: string;
  now?: () => Date;
}

export interface StartListSummary {
  class_count: number;
  person_start_count: number;
  status: ExportStatus;
}

export interface StartListBuildResult {
  xml: string;
  summary: StartListSummary;
}

export type ValidatedStartListBuildResult =
  | { valid: true; build: StartListBuildResult }
  | { valid: false; errors: XsdError[] };

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Split "Given Family" on the LAST space (Swedish naming convention: the
 * trailing token is the family name). Single-token names treat the token as
 * the family with an empty given (the XSD still requires the <Given> child). */
export function splitName(full: string): { family: string; given: string } {
  const trimmed = full.trim();
  if (trimmed.length === 0) return { family: '', given: '' };
  const idx = trimmed.lastIndexOf(' ');
  if (idx < 0) return { family: trimmed, given: '' };
  return { family: trimmed.slice(idx + 1).trim(), given: trimmed.slice(0, idx).trim() };
}

/** All IOF v3 ResultStatus values fartola emits. The bundled IOF.xsd carries
 * the full 14-value enum; we restrict to the subset our projection produces. */
export type IofResultStatus =
  | 'OK'
  | 'MissingPunch'
  | 'DidNotFinish'
  | 'DidNotStart'
  | 'Disqualified'
  | 'Cancelled'
  | 'OverTime';

/** Internal projection status → IOF ResultStatus enum value. Returns null for
 * PEND — those competitors are excluded from the export entirely.
 *
 * The Phase 2.0 manual states (DNS/DQ/CANCEL/MAX) round-trip into the IOF
 * XSD enum via the obvious mapping (DidNotStart / Disqualified / Cancelled
 * / OverTime). All four are valid values per apps/edge/src/xml/IOF.xsd lines
 * 2994 / 2931 / 3008 / 2959 — the validator gate keeps that contract. */
export function statusForXml(s: CompetitorView['status']): IofResultStatus | null {
  switch (s) {
    case 'OK':
      return 'OK';
    case 'MP':
      return 'MissingPunch';
    case 'DNF':
      return 'DidNotFinish';
    case 'DNS':
      return 'DidNotStart';
    case 'DQ':
      return 'Disqualified';
    case 'CANCEL':
      return 'Cancelled';
    case 'MAX':
      return 'OverTime';
    case 'PEND':
      return null;
  }
}

/** W-4 LOCKED: top-level @status mapping. Final → 'Complete' (the canonical
 * value for a closed result list per the IOF XSD documentation),
 * Provisional → 'Snapshot' ("results so far while the event is under way"). */
export function resultListStatusFor(input: ExportStatus): 'Complete' | 'Snapshot' {
  return input === 'Final' ? 'Complete' : 'Snapshot';
}

// ---------------------------------------------------------------------------
// Internal shapes — the typed tree we hand to fast-xml-parser's XMLBuilder.
// These are intentionally `any`-ish at the leaves because fast-xml-parser
// accepts plain objects with `@_` attribute keys; the type system can't
// represent that cleanly, and over-typing the tree would force casts at
// every push.
// ---------------------------------------------------------------------------

interface ResultNode {
  StartTime?: string;
  FinishTime?: string;
  Time?: number;
  Position?: number;
  Status: IofResultStatus;
}

interface PersonResultNode {
  Person: { Name: { Family: string; Given: string } };
  Organisation?: { '@_type': 'Club'; Name: string };
  Result: ResultNode;
}

interface ClassResultNode {
  Class: { Name: string };
  PersonResult: PersonResultNode[];
}

interface ResultListNode {
  '@_xmlns': 'http://www.orienteering.org/datastandard/3.0';
  '@_iofVersion': '3.0';
  '@_createTime': string;
  '@_creator': string;
  '@_status': 'Complete' | 'Snapshot';
  Event: { Name: string; StartTime: { Date: string } };
  ClassResult?: ClassResultNode[];
}

// ---------------------------------------------------------------------------
// Build a single PersonResult subtree. Returns null for PEND (excluded from
// the export entirely).
// ---------------------------------------------------------------------------

function buildPersonResult(view: CompetitorView, place: number | null): PersonResultNode | null {
  const xmlStatus = statusForXml(view.status);
  if (xmlStatus === null) return null;

  const { family, given } = splitName(view.name);

  // Build the Result subtree in the XSD-required element order. The
  // PersonRaceResult sequence is: BibNumber?, StartTime?, FinishTime?,
  // Time?, TimeBehind?, Position?, Status (required), Score*, ...
  // (apps/edge/src/xml/IOF.xsd lines 2406-2540). Insertion order into
  // a plain JS object IS preserved by fast-xml-parser's XMLBuilder, so
  // we MUST build the keys top-down.
  //
  // StartTime + FinishTime are optional in the XSD (minOccurs=0). For
  // Phase 1 we don't have an absolute ISO wall-clock without combining
  // competition.date with the HalfDayClock; rather than risk an invalid
  // dateTime, we omit both when we don't have a robust source. A later
  // plan can add proper TZ-aware reconstruction when the operator-set
  // event start time lands.
  const result: Partial<ResultNode> = {};
  if (view.elapsed_time_ms !== null) {
    // Time is xsd:double in the IOF XSD — emit decimal seconds. We carry
    // millisecond precision in the projection; round down to whole seconds
    // because the receipt and the on-screen results table both round.
    result.Time = Math.floor(view.elapsed_time_ms / 1000);
  }
  if (xmlStatus === 'OK' && place !== null) {
    // Position must only be present when Status='OK' (per the XSD's
    // PersonRaceResult documentation).
    result.Position = place;
  }
  // Status is required and MUST be the trailing key of the keys we emit.
  result.Status = xmlStatus;

  // PersonResult sequence order per IOF.xsd lines 2360-2404:
  // EntryId?, Person, Organisation?, Result*, Extensions?. We emit
  // Person + (optional Organisation) + Result.
  const node: Partial<PersonResultNode> = {
    Person: { Name: { Family: family, Given: given } },
  };
  if (view.club !== null && view.club.length > 0) {
    node.Organisation = { '@_type': 'Club', Name: view.club };
  }
  node.Result = result as ResultNode;
  return node as PersonResultNode;
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/** Build the IOF XML 3.0 ResultList string from a CompetitionState snapshot.
 *
 * Pure: no IO, no validation. Use {@link validateAndBuild} when the SC#6
 * binding contract applies (i.e. the response body is about to be streamed
 * to a browser or written to disk). */
export function buildResultListXml(input: ExportInput): BuildResult {
  const status: ExportStatus = input.status ?? 'Final';
  const creator = input.creator ?? 'fartOLa v0.1';
  const now = input.now ?? (() => new Date());
  const xmlStatusAttr = resultListStatusFor(status);

  const classResults: ClassResultNode[] = [];
  let personResultCount = 0;

  for (const cls of input.classes) {
    const rows = input.state.results_by_class.get(cls.id) ?? [];
    const personResults: PersonResultNode[] = [];
    for (const row of rows) {
      const view = input.state.competitors.get(row.competitor_id);
      if (view === undefined) continue;
      const node = buildPersonResult(view, row.place);
      if (node === null) continue; // PEND: skipped
      personResults.push(node);
      personResultCount += 1;
    }
    // Drop classes with zero exportable rows so empty heats don't pollute
    // the output. The empty-competition path (W-5) emits zero ClassResult
    // children when this loop produces no entries at all.
    if (personResults.length === 0) continue;
    classResults.push({
      Class: { Name: cls.name },
      PersonResult: personResults,
    });
  }

  const resultListNode: ResultListNode = {
    '@_xmlns': 'http://www.orienteering.org/datastandard/3.0',
    '@_iofVersion': '3.0',
    '@_createTime': now().toISOString(),
    '@_creator': creator,
    '@_status': xmlStatusAttr,
    Event: { Name: input.competition.name, StartTime: { Date: input.competition.date } },
  };
  if (classResults.length > 0) {
    resultListNode.ClassResult = classResults;
  }

  const tree = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    ResultList: resultListNode,
  };

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    format: true,
    indentBy: '  ',
    suppressEmptyNode: false,
  });
  const xml = builder.build(tree) as string;

  return {
    xml,
    summary: {
      class_count: classResults.length,
      person_result_count: personResultCount,
      status,
    },
  };
}

/** Build + validate. The route layer's SC#6 binding contract: only stream
 * the body when valid=true. */
export async function validateAndBuild(input: ExportInput): Promise<ValidatedBuildResult> {
  const built = buildResultListXml(input);
  const v = await validateXml(built.xml);
  if (!v.valid) {
    return { valid: false, errors: v.errors };
  }
  return { valid: true, build: built };
}

// ---------------------------------------------------------------------------
// IOF XML 3.0 StartList builder (Plan 02.1-03).
//
// Mirrors the buildResultListXml structure but uses the StartList root element.
// Key differences from ResultList:
//   - Root element is StartList (no @status attribute — StartList XSD does not
//     carry a status restriction unlike ResultList).
//   - ClassStart > PersonStart > Start > StartTime (NOT ClassResult/PersonResult).
//   - StartTime is xsd:dateTime (UTC ISO with Z suffix).
//   - Competitors with null startTimeMs are excluded (not yet drawn).
//   - CANCEL status emits <Status>Cancelled</Status> (per D-14).
//
// SC#6 binding contract (same as ResultList): only call validateAndBuildStartList
// when you intend to stream to a browser; use buildStartListXml for unit work.
// ---------------------------------------------------------------------------

interface PersonRaceStartNode {
  BibNumber?: string;
  StartTime?: string;
}

interface PersonStartNode {
  Person: { Name: { Family: string; Given: string } };
  Organisation?: { '@_type': 'Club'; Name: string };
  Start: PersonRaceStartNode;
}

interface ClassStartNode {
  Class: { Name: string };
  PersonStart?: PersonStartNode[];
}

interface StartListNode {
  '@_xmlns': 'http://www.orienteering.org/datastandard/3.0';
  '@_iofVersion': '3.0';
  '@_createTime': string;
  '@_creator': string;
  Event: { Name: string; StartTime: { Date: string } };
  ClassStart?: ClassStartNode[];
}

/** Build the IOF XML 3.0 StartList string from a StartListInput.
 *
 * Pure: no IO, no validation. Use {@link validateAndBuildStartList} when the
 * SC#6 binding contract applies (i.e. the response body is about to be streamed
 * to a browser or written to disk). */
export function buildStartListXml(input: StartListInput): StartListBuildResult {
  const status: ExportStatus = input.status ?? 'Final';
  const creator = input.creator ?? 'fartOLa v0.1';
  const now = input.now ?? (() => new Date());

  const classStarts: ClassStartNode[] = [];
  let personStartCount = 0;

  for (const cls of input.classes) {
    const personStarts: PersonStartNode[] = [];

    for (const competitor of cls.competitors) {
      // Exclude competitors without a drawn start time (null = not yet drawn).
      if (competitor.startTimeMs === null || competitor.startTimeMs === undefined) continue;

      // Exclude CANCEL competitors from the StartList. The IOF XML 3.0 XSD
      // does NOT include a Status element in PersonRaceStart (unlike
      // PersonRaceResult). Cancelled competitors are not announced — the
      // caller should use buildResultListXml for status reporting (D-14:
      // CANCEL → Cancelled applies only to the ResultList).
      if (competitor.status === 'CANCEL') continue;

      const { family, given } = splitName(competitor.name);

      // Build PersonRaceStart (the Start child). BibNumber before StartTime
      // per XSD sequence order (IOF.xsd lines 2055-2097).
      const start: PersonRaceStartNode = {};
      if (competitor.bibNumber !== undefined && competitor.bibNumber !== null) {
        start.BibNumber = competitor.bibNumber;
      }
      // Emit UTC ISO string with Z suffix (RESEARCH Pitfall 4).
      start.StartTime = new Date(competitor.startTimeMs).toISOString();

      // Build PersonStart with XSD-required element order:
      // EntryId?, Person?, Organisation?, Start+ (IOF.xsd lines 2009-2044).
      // JS object key insertion order IS preserved by fast-xml-parser's
      // XMLBuilder, so we MUST build keys top-down.
      const hasClub =
        competitor.club !== null && competitor.club !== undefined && competitor.club.length > 0;
      const personStart: PersonStartNode = hasClub
        ? {
            Person: { Name: { Family: family, Given: given } },
            Organisation: { '@_type': 'Club', Name: competitor.club as string },
            Start: start,
          }
        : {
            Person: { Name: { Family: family, Given: given } },
            Start: start,
          };

      personStarts.push(personStart);
      personStartCount += 1;
    }

    // Only include classes with at least one drawn competitor (mirrors ResultList
    // behavior where empty classes are dropped).
    if (personStarts.length === 0) continue;

    classStarts.push({
      Class: { Name: cls.name },
      PersonStart: personStarts,
    });
  }

  const startListNode: StartListNode = {
    '@_xmlns': 'http://www.orienteering.org/datastandard/3.0',
    '@_iofVersion': '3.0',
    '@_createTime': now().toISOString(),
    '@_creator': creator,
    Event: { Name: input.competition.name, StartTime: { Date: input.competition.date } },
  };
  if (classStarts.length > 0) {
    startListNode.ClassStart = classStarts;
  }

  const tree = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    StartList: startListNode,
  };

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    format: true,
    indentBy: '  ',
    suppressEmptyNode: false,
  });
  const xml = builder.build(tree) as string;

  return {
    xml,
    summary: {
      class_count: classStarts.length,
      person_start_count: personStartCount,
      status,
    },
  };
}

/** Build + validate a StartList. The route layer's SC#6 binding contract: only
 * stream the body when valid=true. */
export async function validateAndBuildStartList(
  input: StartListInput
): Promise<ValidatedStartListBuildResult> {
  const built = buildStartListXml(input);
  const v = await validateXml(built.xml);
  if (!v.valid) {
    return { valid: false, errors: v.errors };
  }
  return { valid: true, build: built };
}
