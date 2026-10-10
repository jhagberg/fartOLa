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

/** The marker of each runner whose start an event set, from the event that
 * gave the current start. Undo gives back the marker before the undone
 * event (undo is only allowed while that event gave the current start); an
 * undone undo gives the event's marker back. A clock shift moves every
 * start and keeps the markers. Runners without a marker are left out. */
export function startMarkers(
  events: readonly Event[],
  competitionId: string
): Map<string, StartMarker> {
  type Payload = Extract<EventPayload, { event_type: 'start_times_set' }>;
  const sets = events
    .filter((e) => e.competitionId === competitionId && e.eventType === 'start_times_set')
    .sort((a, b) => a.localSeq - b.localSeq || a.nodeId.localeCompare(b.nodeId));
  const byKey = new Map(sets.map((e) => [`${e.nodeId}:${e.localSeq}`, e.payload as Payload]));
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
  const stacks = new Map<string, Array<StartMarker | null>>();
  for (const e of sets) {
    const p = e.payload as Payload;
    if (p.cause === 'clock_shift') continue;
    // An undo of an undo of … : odd depth takes the marker back, even depth
    // applies the original event again.
    let original: Payload | undefined = p;
    let depth = 0;
    while (original?.cause === 'undo' && original.undoes !== undefined) {
      original = byKey.get(`${original.undoes.node_id}:${original.undoes.local_seq}`);
      depth++;
    }
    for (const c of p.changes) {
      const stack = stacks.get(c.competitor_id) ?? [];
      if (depth % 2 === 1) stack.pop();
      else stack.push(original === undefined ? null : markerOf(original, c.start_time_ms));
      stacks.set(c.competitor_id, stack);
    }
  }
  const out = new Map<string, StartMarker>();
  for (const [id, stack] of stacks) {
    const top = stack.at(-1);
    if (top != null) out.set(id, top);
  }
  return out;
}
