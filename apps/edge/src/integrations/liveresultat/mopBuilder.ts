// Authored for fartola. Not ported from upstream.
//
// MOP XML 2.0 builder for liveresultat.orientering.se push integration.
//
// Builds a <MOPComplete> snapshot from the current projection state. The
// liveresultat push protocol (D-09) requires MOP 2.0 format — a stripped-
// down variant of MeOS Online Protocol used only for push (not for the full
// MOP CRUD flow).
//
// MOP time semantics (RESEARCH Pitfall 5):
//   - All times are in tenths of a second (1/10 s), NOT milliseconds.
//   - start (base @st): epoch UTC in tenths. Math.round(epoch_ms / 100).
//     The liveresultat server interprets this relative to competition date.
//   - rt (running time, base @rt): elapsed in tenths. Math.round(elapsed_ms / 100).
//
// MOP status codes (MOP 2.0 spec, same as mop.xsd):
//   0 = unknown (used for PEND — not started yet)
//   1 = OK (finished, status OK)
//   2 = DNS (did not start)
//   3 = DNF / MissingPunch
//   4 = DSQ
//   9 = not started yet (alternative for future use)
//   10 = cancelled
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-07-PLAN.md task 1
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-RESEARCH.md Pitfall 5
// - REQ-STD-004

import { XMLBuilder } from 'fast-xml-parser';
import type { CompetitionState, PunchStatus } from '../../projection/types.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MopCompetition {
  id: string;
  name: string;
  /** YYYY-MM-DD */
  date: string;
}

export interface MopClass {
  id: string;
  name: string;
}

export interface MopClub {
  id: string;
  name: string;
}

export interface MopBuildInput {
  state: CompetitionState;
  competition: MopCompetition;
  classes: MopClass[];
  clubs: MopClub[];
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

/** Map PunchStatus → MOP 2.0 stat integer.
 *
 * MOP 2.0 stat values:
 *   0 = unknown     (PEND)
 *   1 = OK          (OK)
 *   2 = DNS         (DNS)
 *   3 = DNF/MP      (MP, DNF)
 *   4 = DSQ         (DQ)
 *   10 = cancelled  (CANCEL, MAX treated as cancelled for liveresultat) */
function mopStat(status: PunchStatus): number {
  switch (status) {
    case 'OK':
      return 1;
    case 'DNS':
      return 2;
    case 'MP':
    case 'DNF':
      return 3;
    case 'DQ':
      return 4;
    case 'CANCEL':
    case 'MAX':
      return 10;
    case 'PEND':
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

const mopBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  format: false, // Compact output for push
  suppressEmptyNode: false,
});

/** Build a MOPComplete XML 2.0 snapshot from the projection state.
 *
 * The output is ready to POST to liveresultat.orientering.se as the XML
 * blob field in the push FormData. */
export function buildMopXml(input: MopBuildInput): string {
  const { state, competition, classes, clubs } = input;

  // Build a name→id map for clubs so cmp elements can reference org by id.
  const clubIdByName = new Map<string, string>(clubs.map((c) => [c.name, c.id]));

  // ---- <competition> -------------------------------------------------------
  const competitionEl = {
    '@_id': competition.id,
    '@_name': competition.name,
    '@_date': competition.date,
  };

  // ---- <cls> ---------------------------------------------------------------
  // Only emit classes that are referenced by at least one competitor.
  const referencedClassIds = new Set<string>();
  for (const cv of state.competitors.values()) {
    referencedClassIds.add(cv.class_id);
  }
  const clsEls = classes
    .filter((c) => referencedClassIds.has(c.id))
    .map((c) => ({
      '@_id': c.id,
      '#text': c.name,
    }));

  // ---- <org> ---------------------------------------------------------------
  // Emit all clubs that appear in competitor data.
  const referencedClubNames = new Set<string>();
  for (const cv of state.competitors.values()) {
    if (cv.club) referencedClubNames.add(cv.club);
  }
  const orgEls = clubs
    .filter((c) => referencedClubNames.has(c.name))
    .map((c) => ({
      '@_id': c.id,
      '#text': c.name,
    }));

  // ---- <cmp> ---------------------------------------------------------------
  const cmpEls = Array.from(state.competitors.values()).map((cv) => {
    const stat = mopStat(cv.status);
    const orgId = cv.club ? (clubIdByName.get(cv.club) ?? null) : null;

    // Build base attributes
    const baseAttrs: Record<string, unknown> = {
      '@_cls': cv.class_id,
      '@_stat': stat,
    };
    if (orgId !== null) {
      baseAttrs['@_org'] = orgId;
    }
    // Start time in tenths (epoch ms / 100)
    if (cv.start_time_ms !== null) {
      baseAttrs['@_st'] = Math.round(cv.start_time_ms / 100);
    }
    // Running time in tenths
    if (cv.elapsed_time_ms !== null) {
      baseAttrs['@_rt'] = Math.round(cv.elapsed_time_ms / 100);
    }
    baseAttrs['#text'] = cv.name;

    return {
      '@_id': cv.id,
      base: baseAttrs,
    };
  });

  // ---- Assemble tree -------------------------------------------------------
  const tree: Record<string, unknown> = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    MOPComplete: {
      '@_xmlns': 'http://www.melin.nu/mop',
      competition: competitionEl,
      ...(clsEls.length > 0 ? { cls: clsEls } : {}),
      ...(orgEls.length > 0 ? { org: orgEls } : {}),
      ...(cmpEls.length > 0 ? { cmp: cmpEls } : {}),
    },
  };

  return mopBuilder.build(tree) as string;
}
