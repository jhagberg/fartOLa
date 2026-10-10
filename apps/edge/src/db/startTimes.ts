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
  /** A pursuit draw's restart block start (payload restart_ms). */
  restartMs?: number;
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
 * that keep a runner's start are dropped; with nothing left (and no grid
 * change) no event is written and the result is null. Throws
 * UnknownCompetitor before writing anything. The caller marks the
 * projection dirty. */
export function writeStartTimes(
  handle: DbHandle,
  nodeId: string,
  competitionId: string,
  write: StartTimeWrite
): { local_seq: number; changed: number } | null {
  let result: { local_seq: number; changed: number } | null = null;
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
    if (changes.length === 0 && classGrid === undefined && classGrids.length === 0) return;

    const r = insertEvent(
      handle,
      nodeId,
      'start_times_set',
      Date.now(),
      {
        event_type: 'start_times_set',
        cause: write.cause,
        class_id: write.classId,
        changes,
        ...(classGrid !== undefined ? { class_grid: classGrid } : {}),
        ...(classGrids.length > 0 ? { class_grids: classGrids } : {}),
        ...(write.undoes !== undefined ? { undoes: write.undoes } : {}),
        ...(write.restartMs !== undefined ? { restart_ms: write.restartMs } : {}),
      },
      competitionId
    );
    for (const c of changes)
      handle.db
        .update(competitors)
        .set({ startTimeMs: c.start_time_ms })
        .where(eq(competitors.id, c.competitor_id))
        .run();
    result = { local_seq: r.local_seq, changed: changes.length };
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
