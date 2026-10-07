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
