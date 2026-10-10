// Authored for fartola. Not ported from upstream.
//
// Start times from the event log (ADR-0003 update 2026-10). Each
// start_times_set event carries the new start of one or more runners; the
// last one in log order wins. A runner no event mentions keeps
// competitors.start_time_ms: a start written before start times became
// events (or by a test fixture).

import type { EventPayload } from '../db/schema.ts';
import type { Competitor, Event } from '../db/types.ts';

/** `competitors` with startTimeMs replaced by the folded value (events in
 * write order, local_seq; any input order works). */
export function withEventStartTimes(
  competitors: readonly Competitor[],
  events: readonly Event[],
  competitionId: string
): Competitor[] {
  const start = new Map<string, number | null>();
  // Write order (local_seq), not event time: the cache is written in write
  // order, and a laptop clock set back must not reorder start-time edits.
  const sets = events
    .filter((e) => e.competitionId === competitionId && e.eventType === 'start_times_set')
    .sort((a, b) => a.localSeq - b.localSeq || a.nodeId.localeCompare(b.nodeId));
  for (const e of sets) {
    const p = e.payload as EventPayload;
    if (p.event_type !== 'start_times_set') continue;
    for (const c of p.changes) start.set(c.competitor_id, c.start_time_ms);
  }
  return competitors.map((c) => (start.has(c.id) ? { ...c, startTimeMs: start.get(c.id)! } : c));
}

/** What the start list says about a runner's start (todo start-list
 * markers, ADR-0016 rule 7: in text): 'new_time' set by hand or from a
 * missing start, 'late_entrant' placed as a late entrant (SOFT TR 7.5.8),
 * 'restart' in a pursuit's restart block (TR 7.4.1). */
export type StartMarker = 'new_time' | 'late_entrant' | 'restart';

/** The marker of each runner, from the event that gave its current start.
 * A whole-class draw also clears or sets the markers of the class's runners
 * whose start it kept (writeStartTimes leaves unchanged starts out of the
 * event). Undo gives back the markers from before the undone event, so an
 * undo need not be of the latest event; an undone undo gives the event's
 * markers back. A clock shift moves every start and keeps the markers.
 * `runners` are the competition's runners now (class and stored start).
 * Runners without a marker are left out. */
export function startMarkers(
  events: readonly Event[],
  competitionId: string,
  runners: ReadonlyArray<{ id: string; classId: string; startTimeMs: number | null }>
): Map<string, StartMarker> {
  type Payload = Extract<EventPayload, { event_type: 'start_times_set' }>;
  const sets = events
    .filter((e) => e.competitionId === competitionId && e.eventType === 'start_times_set')
    .sort((a, b) => a.localSeq - b.localSeq || a.nodeId.localeCompare(b.nodeId));
  const markerOf = (p: Payload, startMs: number | null): StartMarker | null =>
    p.cause === 'manual' || p.cause === 'missing_starts'
      ? 'new_time'
      : p.cause === 'late_entrants'
        ? 'late_entrant'
        : p.cause === 'draw' &&
            p.restart_ms !== undefined &&
            startMs !== null &&
            startMs >= p.restart_ms
          ? 'restart'
          : null;
  const stored = new Map(runners.map((r) => [r.id, r.startTimeMs]));
  const current = new Map<string, StartMarker | null>();
  const start = new Map<string, number | null>();
  /** Per event, each touched runner's marker before it. */
  const before = new Map<string, Map<string, StartMarker | null>>();
  for (const e of sets) {
    const p = e.payload as Payload;
    for (const c of p.changes) start.set(c.competitor_id, c.start_time_ms);
    if (p.cause === 'clock_shift') continue;
    const prior = new Map<string, StartMarker | null>();
    const set = (id: string, m: StartMarker | null) => {
      if (!prior.has(id)) prior.set(id, current.get(id) ?? null);
      current.set(id, m);
    };
    if (p.cause === 'undo') {
      const undone =
        p.undoes === undefined
          ? undefined
          : before.get(`${p.undoes.node_id}:${p.undoes.local_seq}`);
      for (const [id, m] of undone ?? []) set(id, m);
    } else {
      for (const c of p.changes) set(c.competitor_id, markerOf(p, c.start_time_ms));
      if (p.cause === 'draw' && p.class_id !== null)
        for (const r of runners)
          if (r.classId === p.class_id && !prior.has(r.id))
            set(r.id, markerOf(p, start.has(r.id) ? start.get(r.id)! : (stored.get(r.id) ?? null)));
    }
    before.set(`${e.nodeId}:${e.localSeq}`, prior);
  }
  const out = new Map<string, StartMarker>();
  for (const [id, m] of current) if (m !== null) out.set(id, m);
  return out;
}
