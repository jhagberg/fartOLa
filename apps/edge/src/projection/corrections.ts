// Authored for fartola. Not ported from upstream.
//
// Secretariat corrections per competitor, folded over the whole event log:
// the final state applies to every read, whichever order the correction
// and the read-outs came in. A later read-out therefore never overwrites a
// correction; it stays until the secretariat removes it (a compensating
// event), unlike a manual status, which a read-out during the race clears.

import type { Event } from '../db/types.ts';
import type { EventPayload } from '../db/schema.ts';

export interface Corrections {
  /** Finish time entered by hand (epoch ms), SOFT TR 4.20.6: the time the
   * runner crossed the finish line, when the finish unit failed or the
   * card is missing. Wins over the card's finish punch. */
  finish_ms: number | null;
  finish_reason: string | null;
}

const none = (): Corrections => ({ finish_ms: null, finish_reason: null });

/** Corrections by competitor id. `events` must be sorted by
 * (event_time_ms, local_seq). Competitors without any are absent. */
export function foldCorrections(
  events: readonly Event[],
  competitionId: string
): Map<string, Corrections> {
  const byCompetitor = new Map<string, Corrections>();
  const of = (id: string): Corrections => {
    let c = byCompetitor.get(id);
    if (c === undefined) byCompetitor.set(id, (c = none()));
    return c;
  };
  for (const e of events) {
    if (e.competitionId !== competitionId) continue;
    const payload = e.payload as EventPayload;
    switch (payload.event_type) {
      case 'manual_finish_set': {
        const c = of(payload.competitor_id);
        c.finish_ms = payload.finish_ms;
        c.finish_reason = payload.reason;
        break;
      }
      case 'manual_finish_cleared': {
        const c = of(payload.competitor_id);
        c.finish_ms = null;
        c.finish_reason = null;
        break;
      }
      default:
        break;
    }
  }
  return byCompetitor;
}
