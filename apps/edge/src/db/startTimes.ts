// Authored for fartola. Not ported from upstream.
//
// The one way to change start times (ADR-0003 update 2026-10, ADR-0016
// rule 2): append a start_times_set event and update the
// competitors.start_time_ms cache in the same transaction. Every writer —
// draw, late entrants, hand edit, missing starts, start-list import, undo —
// goes through writeStartTimes, so the event log can rebuild every start
// and undo is a compensating event. rebuildStartTimeCache rewrites the
// cache from the events (at every startup, from openDatabase). No other
// code may write competitors.start_time_ms (startTimesGuard.test.ts).

import { and, asc, eq, inArray } from 'drizzle-orm';

import type { DbHandle } from './index.ts';
import { classes, competitors, events, type EventPayload, type StartTimeCause } from './schema.ts';
import { insertEvent } from '../si/eventInserter.ts';

type StartTimesSet = Extract<EventPayload, { event_type: 'start_times_set' }>;
type ClassGrid = NonNullable<StartTimesSet['class_grid']>;
type ClassGrids = NonNullable<StartTimesSet['class_grids']>;

/** Every class grid an event set: its class_grid (one class, class_id) and
 * its class_grids (several classes). */
export function gridsOf(p: StartTimesSet): ClassGrids {
  return [
    ...(p.class_grid !== undefined && p.class_id !== null
      ? [{ class_id: p.class_id, ...p.class_grid }]
      : []),
    ...(p.class_grids ?? []),
  ];
}

type EventRef = { node_id: string; local_seq: number };

export interface StartTimeWrite {
  cause: StartTimeCause;
  classId: string | null;
  changes: ReadonlyArray<{ competitorId: string; startTimeMs: number | null }>;
  /** A draw's start grid for the class (classes.first_start_ms, start_interval_sec). */
  classGrid?: { firstStartMs: number | null; intervalSec: number | null };
  /** Grids of several classes, written in the same event as the starts. */
  classGrids?: ReadonlyArray<{
    classId: string;
    firstStartMs: number | null;
    intervalSec: number | null;
  }>;
  undoes?: { node_id: string; local_seq: number };
  /** Card numbers changed with the starts (start-list import and its undo),
   * applied in this order: each is a card_bound (or card_unbound) event of
   * its own, and the start event records them (payload card_changes). A
   * card is cleared only by an undo, which names the bind it takes back. */
  cardChanges?: ReadonlyArray<
    | { competitorId: string; cardNumber: number; undoes?: EventRef }
    | { competitorId: string; cardNumber: null; undoes: EventRef }
  >;
  /** Bibs changed with the starts (payload bib_changes). */
  bibChanges?: ReadonlyArray<{ competitorId: string; bib: string | null }>;
  /** A pursuit draw's restart block start (payload restart_ms). */
  restartMs?: number;
  /** A draw that overrode a start clash: the operator's reason (payload
   * start_clash_reason). */
  startClashReason?: string;
}

/** What a write changed: runners with a new start, card number, bib. */
export interface StartTimesWritten {
  local_seq: number;
  changed: number;
  cards: number;
  bibs: number;
}

/** A competitor id that is not in the competition. Nothing was written. */
export class UnknownCompetitor extends Error {
  readonly competitorId: string;
  constructor(competitorId: string) {
    super(`competitor ${competitorId} is not in this competition`);
    this.competitorId = competitorId;
  }
}

/** Write the changes as one start_times_set event plus the cache. Changes
 * that keep a runner's start (card, bib) are dropped; with nothing left (and
 * no grid change) no event is written and the result is null. Throws
 * UnknownCompetitor, and then nothing is written. The caller marks the
 * projection dirty. */
export function writeStartTimes(
  handle: DbHandle,
  nodeId: string,
  competitionId: string,
  write: StartTimeWrite
): StartTimesWritten | null {
  let result: StartTimesWritten | null = null;
  handle.sqlite.transaction(() => {
    // A competitor named twice gets the last value (one change per runner,
    // so undo can restore it).
    const lastOf = new Map(write.changes.map((c) => [c.competitorId, c.startTimeMs]));
    const wanted = [...lastOf].map(([competitorId, startTimeMs]) => ({
      competitorId,
      startTimeMs,
    }));
    const ids = [...lastOf.keys()];
    const current = new Map(
      (ids.length === 0
        ? []
        : handle.db
            .select({ id: competitors.id, startTimeMs: competitors.startTimeMs })
            .from(competitors)
            .where(and(eq(competitors.competitionId, competitionId), inArray(competitors.id, ids)))
            .all()
      ).map((r) => [r.id, r.startTimeMs])
    );
    for (const id of ids) if (!current.has(id)) throw new UnknownCompetitor(id);
    const changes = wanted
      .filter((c) => current.get(c.competitorId) !== c.startTimeMs)
      .map((c) => ({
        competitor_id: c.competitorId,
        start_time_ms: c.startTimeMs,
        previous_ms: current.get(c.competitorId)!,
      }));

    // Set a class's grid; the event records it when it changed.
    const setGrid = (
      classId: string,
      g: { firstStartMs: number | null; intervalSec: number | null }
    ): ClassGrid | undefined => {
      const row = handle.db
        .select({ first: classes.firstStartMs, interval: classes.startIntervalSec })
        .from(classes)
        .where(eq(classes.id, classId))
        .get();
      if (row === undefined || (row.first === g.firstStartMs && row.interval === g.intervalSec))
        return undefined;
      handle.db
        .update(classes)
        .set({ firstStartMs: g.firstStartMs, startIntervalSec: g.intervalSec })
        .where(eq(classes.id, classId))
        .run();
      return {
        first_start_ms: g.firstStartMs,
        interval_sec: g.intervalSec,
        previous_first_start_ms: row.first,
        previous_interval_sec: row.interval,
      };
    };
    const classGrid =
      write.classGrid !== undefined && write.classId !== null
        ? setGrid(write.classId, write.classGrid)
        : undefined;
    const classGrids = (write.classGrids ?? []).flatMap((g) => {
      const set = setGrid(g.classId, g);
      return set === undefined ? [] : [{ class_id: g.classId, ...set }];
    });

    // Cards and bibs: the previous value is read here, in the transaction
    // that changes it, and recorded in the event for the undo.
    const now = Date.now();
    const rowOf = (id: string) => {
      const row = handle.db
        .select({
          card: competitors.cardNumber,
          bib: competitors.bib,
          consentAtMs: competitors.consentAtMs,
        })
        .from(competitors)
        .where(and(eq(competitors.competitionId, competitionId), eq(competitors.id, id)))
        .get();
      if (row === undefined) throw new UnknownCompetitor(id);
      return row;
    };
    const cardChanges = (write.cardChanges ?? []).flatMap((c) => {
      const row = rowOf(c.competitorId);
      if (row.card === c.cardNumber) return [];
      handle.db
        .update(competitors)
        .set({ cardNumber: c.cardNumber })
        .where(eq(competitors.id, c.competitorId))
        .run();
      const payload: EventPayload =
        c.cardNumber === null
          ? {
              event_type: 'card_unbound',
              competitor_id: c.competitorId,
              // Not null: it differs from the new card, which is null.
              card_number: row.card as number,
              undoes: c.undoes,
            }
          : {
              event_type: 'card_bound',
              competitor_id: c.competitorId,
              card_number: c.cardNumber,
              walkup: false,
              consent_at_ms: row.consentAtMs ?? now,
              previous_card_number: row.card,
              ...(c.undoes !== undefined ? { undoes: c.undoes } : {}),
            };
      const bound = insertEvent(handle, nodeId, payload.event_type, now, payload, competitionId);
      return [
        {
          competitor_id: c.competitorId,
          card_number: c.cardNumber,
          previous_card_number: row.card,
          local_seq: bound.local_seq,
        },
      ];
    });
    const bibChanges = (write.bibChanges ?? []).flatMap((b) => {
      const previous = rowOf(b.competitorId).bib;
      return previous === b.bib
        ? []
        : [{ competitor_id: b.competitorId, bib: b.bib, previous_bib: previous }];
    });
    // Clear first, so a bib moving between two runners never collides.
    const setBib = (id: string, bib: string | null) =>
      handle.db.update(competitors).set({ bib }).where(eq(competitors.id, id)).run();
    for (const b of bibChanges) setBib(b.competitor_id, null);
    for (const b of bibChanges) if (b.bib !== null) setBib(b.competitor_id, b.bib);

    if (
      changes.length === 0 &&
      classGrid === undefined &&
      classGrids.length === 0 &&
      cardChanges.length === 0 &&
      bibChanges.length === 0
    )
      return;

    const r = insertEvent(
      handle,
      nodeId,
      'start_times_set',
      now,
      {
        event_type: 'start_times_set',
        cause: write.cause,
        class_id: write.classId,
        changes,
        ...(classGrid !== undefined ? { class_grid: classGrid } : {}),
        ...(classGrids.length > 0 ? { class_grids: classGrids } : {}),
        ...(write.undoes !== undefined ? { undoes: write.undoes } : {}),
        ...(cardChanges.length > 0 ? { card_changes: cardChanges } : {}),
        ...(bibChanges.length > 0 ? { bib_changes: bibChanges } : {}),
        ...(write.restartMs !== undefined ? { restart_ms: write.restartMs } : {}),
        ...(write.startClashReason !== undefined
          ? { start_clash_reason: write.startClashReason }
          : {}),
      },
      competitionId
    );
    for (const c of changes)
      handle.db
        .update(competitors)
        .set({ startTimeMs: c.start_time_ms })
        .where(eq(competitors.id, c.competitor_id))
        .run();
    result = {
      local_seq: r.local_seq,
      changed: changes.length,
      cards: cardChanges.length,
      bibs: bibChanges.length,
    };
  })();
  return result;
}

/** Rewrite competitors.start_time_ms (and each class's start grid) from the
 * start_times_set events, in log order, the same fold as the projection
 * (projection/startTimes.ts). A runner no event names is left alone (a
 * start from before start times were events). Returns how many cache rows
 * changed. Runs at every startup (openDatabase). */
export function rebuildStartTimeCache(handle: DbHandle): number {
  const rows = handle.db
    .select({ competitionId: events.competitionId, payload: events.payload })
    .from(events)
    .where(eq(events.eventType, 'start_times_set'))
    .orderBy(asc(events.localSeq), asc(events.nodeId))
    .all();
  if (rows.length === 0) return 0;
  const start = new Map<string, number | null>();
  const grid = new Map<string, { first: number | null; interval: number | null }>();
  for (const r of rows) {
    const p = r.payload as StartTimesSet;
    for (const c of p.changes) start.set(c.competitor_id, c.start_time_ms);
    for (const g of gridsOf(p))
      grid.set(g.class_id, { first: g.first_start_ms, interval: g.interval_sec });
  }
  let changed = 0;
  handle.sqlite.transaction(() => {
    for (const [id, startTimeMs] of start) {
      const row = handle.db
        .select({ t: competitors.startTimeMs })
        .from(competitors)
        .where(eq(competitors.id, id))
        .get();
      if (row === undefined || row.t === startTimeMs) continue;
      handle.db.update(competitors).set({ startTimeMs }).where(eq(competitors.id, id)).run();
      changed++;
    }
    for (const [id, g] of grid)
      handle.db
        .update(classes)
        .set({ firstStartMs: g.first, startIntervalSec: g.interval })
        .where(eq(classes.id, id))
        .run();
  })();
  return changed;
}
