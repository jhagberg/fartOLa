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
//     Course? (Name, Length, Climb, NumberOfControls — SOFT TR 7.8.2:
//     banlängd), PersonResult+ > Person (Id type="Sweden" when the Eventor
//     person id is known — SOFT TA till TR 7.8.3, Name.Family + Name.Given),
//     Organisation (only when club non-null), Result
//     (StartTime?, FinishTime?, Time, Position (OK only), Status).
//
//   - PEND competitors (never read out): a Final list (@status Complete)
//     reports them as DidNotStart, "Ej start" in SOFT's terms (TA till TR
//     7.8.2); fartOLa has no results-locked state, so the Final export is
//     what "final" means. A Provisional list (Snapshot) leaves them out —
//     they may still be in the forest.
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
import { startMs } from '../projection/dnfMp.ts';
import { cardClockToEpochMs } from '../projection/halfDayClockMath.ts';
import { formatClockDateTime } from '../time/competitionClock.ts';
import type { CompetitionDTO, ClassDTO, CourseDTO } from '@fartola/shared-types';

// ---------------------------------------------------------------------------
// Public types.
// ---------------------------------------------------------------------------

export type ExportStatus = 'Final' | 'Provisional';

export interface ExportInput {
  competition: CompetitionDTO;
  classes: ClassDTO[];
  /** Each class's course (ClassDTO.course_id, else the course whose
   * class_id is the class) gives ClassResult > Course: name, length, climb
   * and number of controls (SOFT TR 7.8.2). No SplitTime elements yet
   * (RESEARCH §"Pitfall 5"). */
  courses: CourseDTO[];
  /** Competitor id → Eventor person id (EntryList import), written as
   * Person > Id so Eventor links the results (SOFT TA till TR 7.8.3). */
  eventorPersonIds?: ReadonlyMap<string, number>;
  /** Competitor id → the fees fartOLa charged (SOFT TR 4.12.4, 4.12.6):
   * class fee and surcharge of a walk-up or late entry (null for a
   * pre-entry, whose fee Eventor decided) and the card rental fee. */
  fees?: ReadonlyMap<string, RunnerFees>;
  state: CompetitionState;
  status?: ExportStatus;
  /** Creator attribute on the root element. Defaults to `fartOLa v0.1`. Tests
   * inject a deterministic value so the frozen fixture is byte-stable. */
  creator?: string;
  /** Override `Date.now()` for deterministic createTime. Tests pin this so
   * the frozen-fixture round-trip is byte-stable. */
  now?: () => Date;
}

export interface RunnerFees {
  entry: number | null;
  late: number | null;
  card: number | null;
  /** Eventor's EntryFeeId for the class fee and the late fee, written as
   * Fee/Id so Eventor can invoice them; null = not from Eventor. */
  entryFeeId?: number | null;
  lateFeeId?: number | null;
}

export interface ExportSummary {
  class_count: number;
  person_result_count: number;
  /** Runners left out because they have no result yet (PEND, never read
   * out). The UI warns "N löpare saknar resultat" (SOFT TA till TR 7.8.2). */
  pending_count: number;
  status: ExportStatus;
}

export interface BuildResult {
  xml: string;
  summary: ExportSummary;
}

export type ValidatedBuildResult =
  { valid: true; build: BuildResult } | { valid: false; errors: XsdError[] };

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
  /** SOFT TR 7.5.4: the class's course (IOF ClassStart/Course). */
  course?: { name: string; lengthM: number | null; climbM: number | null };
  /** SOFT TR 7.5.4: the class's start place (IOF ClassStart/StartName). */
  startName?: string | null;
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
  { valid: true; build: StartListBuildResult } | { valid: false; errors: XsdError[] };

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
 * PEND — a Provisional export leaves those competitors out, a Final one
 * reports them as DidNotStart (see buildPersonResult).
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

interface FeeNode {
  '@_type'?: 'Normal' | 'Late';
  Id?: number;
  Name: string;
  Amount: { '@_currency': 'SEK'; '#text': number };
}

interface ResultNode {
  StartTime?: string;
  FinishTime?: string;
  Time?: number;
  Position?: number;
  Status: IofResultStatus;
  AssignedFee?: { Fee: FeeNode }[];
  ServiceRequest?: {
    Service: { '@_type': 'RentalCard'; Name: string };
    RequestedQuantity: 1;
    AssignedFee: { Fee: FeeNode };
  };
}

interface PersonResultNode {
  Person: {
    Id?: { '@_type': 'Sweden'; '#text': number };
    Name: { Family: string; Given: string };
  };
  Organisation?: { '@_type': 'Club'; Name: string };
  Result: ResultNode;
}

interface CourseNode {
  Name: string;
  Length?: number;
  Climb?: number;
  NumberOfControls: number;
}

interface ClassResultNode {
  Class: { '@_resultListMode'?: 'UnorderedNoTimes'; Name: string };
  Course?: CourseNode;
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
// Build a single PersonResult subtree. Returns null for PEND: a runner never
// read out is left out of every list, Final too. Unread is not "not started"
// (SOFT TA till TR 7.8.2); the operator sets them to DNS ("Sätt ej utlästa
// till Ej start", routes/manual.ts) and the summary counts the rest.
// ---------------------------------------------------------------------------

/** Start and finish (epoch ms) for the Result element: from the latest
 * read-out, the start chosen by the class's start method as for the running
 * time (dnfMp.startMs). A runner without a read-out has at most the drawn
 * start time; one who did not start (or never read out) has neither. */
function raceTimes(
  view: CompetitorView,
  cls: ClassDTO,
  clockOffsetMin: number
): { start: number | null; finish: number | null } {
  if (view.status === 'PEND' || view.status === 'DNS' || view.status === 'CANCEL') {
    return { start: null, finish: null };
  }
  const read = view.card_read_history[view.card_read_history.length - 1];
  if (read === undefined) return { start: view.start_time_ms, finish: view.manual_finish_ms };
  // The same start and finish the running time is computed from.
  return {
    start: startMs({
      start: read.start,
      cardType: read.card_type,
      readAtMs: read.event_time_ms,
      drawnStartMs: view.start_time_ms,
      clockOffsetMin,
      startMethod: cls.start_method,
    }),
    finish:
      view.manual_finish_ms ??
      (read.finish === null
        ? null
        : cardClockToEpochMs(read.finish, read.card_type, read.event_time_ms, clockOffsetMin)),
  };
}

function buildPersonResult(
  view: CompetitorView,
  place: number | null,
  cls: ClassDTO,
  eventorPersonId: number | undefined,
  clockOffsetMin: number,
  fees: RunnerFees | undefined
): PersonResultNode | null {
  const xmlStatus = statusForXml(view.status);
  if (xmlStatus === null) return null;
  const noTiming = cls.no_timing;

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
  // StartTime / FinishTime as xsd:dateTime on the competition clock with
  // its explicit offset (ADR-0012, like the StartList): the exact instant,
  // reading as the station time. An untimed class exports neither.
  if (!noTiming) {
    const { start, finish } = raceTimes(view, cls, clockOffsetMin);
    if (start !== null) result.StartTime = formatClockDateTime(start, clockOffsetMin);
    if (finish !== null) result.FinishTime = formatClockDateTime(finish, clockOffsetMin);
  }
  // 02.1-14 Task 9: an untimed class exports no Time / Position (as MeOS
  // iof30interface.cpp writePersonResult with hasTiming=false, and Eventor).
  if (view.elapsed_time_ms !== null && !noTiming) {
    // Time is xsd:double in the IOF XSD. The projection's time is already
    // the official one in whole seconds (SOFT TR 4.20.7, dnfMp.officialMs).
    result.Time = Math.round(view.elapsed_time_ms / 1000);
  }
  if (xmlStatus === 'OK' && place !== null && !noTiming) {
    // Position must only be present when Status='OK' (per the XSD's
    // PersonRaceResult documentation).
    result.Position = place;
  }
  // Status is required and comes after the timing keys.
  result.Status = xmlStatus;
  // After Status in PersonRaceResult: AssignedFee*, ServiceRequest*. The
  // class fee and the surcharge are separate fees, "Normal" and "Late", and
  // a rental card is a ServiceRequest of type "RentalCard", as MeOS writes
  // them (iof30interface.cpp:2838-2915, writeAssignedFee and
  // writeRentalCardService); SOFT TR 4.12.9 wants the late fee apart from
  // the base fee. Fee/Id is Eventor's EntryFeeId when the class fees came
  // from Eventor. No PaidAmount: fartOLa takes no payments.
  const amount = (n: number) => ({ '@_currency': 'SEK' as const, '#text': n });
  const id = (n: number | null | undefined) => (n == null ? {} : { Id: n });
  const assigned: { Fee: FeeNode }[] = [];
  if (fees?.entry != null)
    assigned.push({
      Fee: {
        '@_type': 'Normal',
        ...id(fees.entryFeeId),
        Name: 'Anmälningsavgift',
        Amount: amount(fees.entry),
      },
    });
  if (fees?.late != null && fees.late > 0)
    assigned.push({
      Fee: {
        '@_type': 'Late',
        ...id(fees.lateFeeId),
        Name: 'Efteranmälningsavgift',
        Amount: amount(fees.late),
      },
    });
  if (assigned.length > 0) result.AssignedFee = assigned;
  if (fees?.card != null && fees.card > 0)
    result.ServiceRequest = {
      Service: { '@_type': 'RentalCard', Name: 'Hyrbricka' },
      RequestedQuantity: 1,
      AssignedFee: { Fee: { Name: 'Brickhyra', Amount: amount(fees.card) } },
    };

  // PersonResult sequence order per IOF.xsd lines 2360-2404:
  // EntryId?, Person, Organisation?, Result*, Extensions?. We emit
  // Person + (optional Organisation) + Result.
  // Person sequence: Id*, Name, … (IOF.xsd Person). Eventor types its own
  // person ids "Sweden" in IOF 3.0 output (eventor/__fixtures__/
  // competitors-sample.xml), so the export does the same.
  const node: Partial<PersonResultNode> = {
    Person:
      eventorPersonId === undefined
        ? { Name: { Family: family, Given: given } }
        : {
            Id: { '@_type': 'Sweden', '#text': eventorPersonId },
            Name: { Family: family, Given: given },
          },
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

/** SOFT TR 7.8.2: the class's course with its length (metres), in the
 * SimpleCourse element order Name, Length, Climb, NumberOfControls. */
function courseNode(course: CourseDTO): CourseNode {
  return {
    Name: course.name,
    ...(course.length_m === null ? {} : { Length: course.length_m }),
    ...(course.climb_m === null ? {} : { Climb: course.climb_m }),
    NumberOfControls: course.controls.length,
  };
}

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
  let pendingCount = 0;

  for (const cls of input.classes) {
    const rows = input.state.results_by_class.get(cls.id) ?? [];
    const personResults: PersonResultNode[] = [];
    for (const row of rows) {
      const view = input.state.competitors.get(row.competitor_id);
      if (view === undefined) continue;
      const node = buildPersonResult(
        view,
        row.place,
        cls,
        input.eventorPersonIds?.get(view.id),
        input.competition.clock_offset_min,
        input.fees?.get(view.id)
      );
      if (node === null) {
        pendingCount += 1; // PEND: no result yet, left out
        continue;
      }
      personResults.push(node);
      personResultCount += 1;
    }
    // Drop classes with zero exportable rows so empty heats don't pollute
    // the output. The empty-competition path (W-5) emits zero ClassResult
    // children when this loop produces no entries at all.
    if (personResults.length === 0) continue;
    const course =
      input.courses.find((c) => c.id === cls.course_id) ??
      input.courses.find((c) => c.class_id === cls.id);
    classResults.push({
      // 02.1-14 Task 9: mirror Eventor's ResultList for untimed classes.
      Class: cls.no_timing
        ? { '@_resultListMode': 'UnorderedNoTimes', Name: cls.name }
        : { Name: cls.name },
      // ClassResult sequence: Class, Course*, PersonResult* (IOF.xsd).
      ...(course === undefined ? {} : { Course: courseNode(course) }),
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
      pending_count: pendingCount,
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
//   - StartTime is xsd:dateTime on the competition clock with its explicit
//     offset (ADR-0012), e.g. 2026-03-29T02:00:54+01:00.
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
  Course?: { Name: string; Length?: number; Climb?: number };
  StartName?: string;
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
      // An explicit offset, never a bare local time (RESEARCH Pitfall 4).
      start.StartTime = formatClockDateTime(
        competitor.startTimeMs,
        input.competition.clock_offset_min
      );

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

    // XSD order: Class, Course*, StartName*, PersonStart* (IOF.xsd lines
    // 1930-1951); keys are built top-down.
    const classStart: ClassStartNode = { Class: { Name: cls.name } };
    if (cls.course !== undefined)
      classStart.Course = {
        Name: cls.course.name,
        ...(cls.course.lengthM !== null ? { Length: cls.course.lengthM } : {}),
        ...(cls.course.climbM !== null ? { Climb: cls.course.climbM } : {}),
      };
    if (cls.startName != null && cls.startName.length > 0) classStart.StartName = cls.startName;
    classStart.PersonStart = personStarts;
    classStarts.push(classStart);
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
