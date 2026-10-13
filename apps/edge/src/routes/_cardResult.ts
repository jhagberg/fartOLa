// Authored for fartola. Not ported from upstream.
//
// A runner keeps the result they have. One rule for every request that
// changes a runner's card number ("Ändra", "Byt bricka", the start list
// import, and the undo of each of them):
//
//   Ask the reducer what the runner has now and what the runner would have
//   with the new card: the status, the time, and the reads that count in
//   the race (resultChanged). When the runner has something now and it is
//   not the same afterwards, the request takes a result away or replaces a
//   decision the operator made, and it does not go through in silence.
//
// A read-out belongs to the runner who has that card number now
// (projection/reduce.ts, cardIndex), so the difference comes about in more
// ways than one: the runner's own reads stop counting; a status set by hand
// is replaced by what a read of the new card says (DNS becomes OK); a read
// of the new card made in a race that was reset since clears a status set
// by hand and scores nothing. The comparison does not care which. A runner
// who has nothing now can only gain, and is never asked about. A read that
// is added to a runner whose status and time stay as they are (a DQ set by
// hand) is no difference either.
//
//   - One runner at a time ("Ändra", "Byt bricka"): refused with 409
//     has_result { competitor_id, name, lose_result }. lose_result names
//     what the runner has: the card and the card change that gave it, the
//     status, how many reads of the card count and which is the newest. The
//     request goes through only when it sends that lose_result back
//     unchanged. When any of it has changed (another card, the same card
//     given again, another read, another status, a reset) the confirmation
//     is for something else and the answer is the same 409, with
//     lose_result as it is now.
//   - The undo of a card change is what the rule's exception is for: it
//     gives back what was there before the change, and with nothing stored
//     since about the runner or the two cards (touchedSince) the difference
//     is exactly what the change itself gave. Then it goes through. When
//     something has come since (a read of either card, a status, a finish
//     or a punch by hand), the comparison decides as for any other change:
//     one runner at a time the same 409 and the same confirmation.
//   - Many runners at once (the start list import and its undo) never carry
//     the confirmation: the import leaves such a runner's card as it is and
//     lists the row in its answer; the undo is refused. The one-runner
//     requests are the way to do it on purpose.
//   - A request that changes nothing (the runner has that card already) is
//     not asked about and not refused, so the same request sent twice
//     leaves what one leaves.
//
// "In the race" is what the reset of a race counts (routes/competitions.ts,
// takenByReset): reads at or after the race start. Before the start, and
// after a reset, no read is scored.

import { isDeepStrictEqual } from 'node:util';
import { and, count, eq, gt, gte, inArray, max, sql } from 'drizzle-orm';

import type { LoseResult } from '@fartola/shared-types';

import type { DbHandle } from '../db/index.ts';
import { competitions, events } from '../db/schema.ts';
import { loadCompetitionInputs } from '../projection/loader.ts';
import { reduce } from '../projection/reduce.ts';

/** The reads of `cardNumber` that count in the race now: how many, and the
 * local_seq of the newest (0: none). With `afterSeq`, only those stored
 * after that event (a card change).
 * shortcut: local_seq orders the events of one node, which is all there is
 * today; compare across nodes when edge-to-edge sync is built (ADR-0004). */
export function readsOnCard(
  handle: DbHandle,
  competitionId: string,
  cardNumber: number | null,
  afterSeq = 0
): { reads: number; last_read_seq: number } {
  const none = { reads: 0, last_read_seq: 0 };
  if (cardNumber === null) return none;
  const startMs = handle.db
    .select({ t: competitions.raceStartedAtMs })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .get()?.t;
  if (startMs === null || startMs === undefined) return none;
  const row = handle.db
    .select({ reads: count(), last: max(events.localSeq) })
    .from(events)
    .where(
      and(
        eq(events.competitionId, competitionId),
        eq(events.eventType, 'card_read'),
        gte(events.eventTimeMs, startMs),
        gt(events.localSeq, afterSeq),
        sql`json_extract(${events.payload}, '$.card_number') = ${cardNumber}`
      )
    )
    .get()!;
  return { reads: row.reads, last_read_seq: row.last ?? 0 };
}

/** For the undo of the card change stored as event `seq`: whether, since
 * then, one of the two cards was read or anything was stored about the
 * runner (a status, a finish, a punch by hand). A card change and a
 * confirmed consent decide nothing about a result and do not count. */
export function touchedSince(
  handle: DbHandle,
  competitionId: string,
  runnerId: string,
  cards: readonly [number | null, number | null],
  seq: number
): boolean {
  const card = sql`json_extract(${events.payload}, '$.card_number')`;
  return (
    handle.db
      .select({ n: count() })
      .from(events)
      .where(
        and(
          eq(events.competitionId, competitionId),
          gt(events.localSeq, seq),
          sql`((${events.eventType} = 'card_read' AND (${card} = ${cards[0]} OR ${card} = ${cards[1]}))
            OR (${events.eventType} NOT IN ('card_bound', 'card_unbound', 'consent_confirmed')
                AND json_extract(${events.payload}, '$.competitor_id') = ${runnerId}))`
        )
      )
      .get()!.n > 0
  );
}

/** What the reducer gives each runner on the stored data, with some
 * runners' cards changed (runner id → card): the status, the time and the
 * reads that count in the race. Nothing is written. */
function resultsWith(
  handle: DbHandle,
  competitionId: string,
  cardOf: ReadonlyMap<string, number | null>
): (id: string) => { status: string; elapsedMs: number | null; reads: string[] } {
  const input = loadCompetitionInputs(handle, competitionId);
  const nothing = { status: 'PEND', elapsedMs: null, reads: [] };
  if (input === null) return () => nothing;
  const state = reduce({
    ...input,
    competitors: input.competitors.map((c) =>
      cardOf.has(c.id) ? { ...c, cardNumber: cardOf.get(c.id)! } : c
    ),
  });
  const startMs = input.race_started_at_ms ?? null;
  return (id) => {
    const view = state.competitors.get(id);
    if (view === undefined) return nothing;
    return {
      status: view.status,
      elapsedMs: view.elapsed_time_ms,
      reads:
        startMs === null
          ? []
          : view.card_read_history
              .filter((r) => r.event_time_ms >= startMs)
              .map((r) => `${r.card_number}:${r.event_time_ms}`),
    };
  };
}

/** The rule: of the runners in `cardOf` (runner id → new card), those who
 * have something now that they would not have, or not the same, with the
 * new cards; with the status each of them has now. */
export function resultChanged(
  handle: DbHandle,
  competitionId: string,
  cardOf: ReadonlyMap<string, number | null>
): Map<string, string> {
  const changed = new Map<string, string>();
  if (cardOf.size === 0) return changed;
  const before = resultsWith(handle, competitionId, new Map());
  const after = resultsWith(handle, competitionId, cardOf);
  for (const id of cardOf.keys()) {
    const was = before(id);
    const is = after(id);
    if (was.status === 'PEND' && was.reads.length === 0) continue;
    if (
      was.status !== is.status ||
      was.elapsedMs !== is.elapsedMs ||
      was.reads.some((r) => !is.reads.includes(r))
    )
      changed.set(id, was.status);
  }
  return changed;
}

/** The 409 body when a card change would take or replace what `runner`
 * has and `confirmed` is not exactly that; null to go on. `newCard`: the
 * card the runner gets. `undoOf`: the change is the undo of the card change
 * stored as that event (the rule's exception). Call it in the same tick as
 * the write (no await in between), and after the check that no other
 * runner has `newCard`. */
export function resultLost(
  handle: DbHandle,
  runner: { id: string; competitionId: string; name: string; cardNumber: number | null },
  change: { newCard: number | null; undoOf?: number },
  confirmed: LoseResult | undefined
): { error: 'has_result'; competitor_id: string; name: string; lose_result: LoseResult } | null {
  const { id, competitionId } = runner;
  if (
    change.undoOf !== undefined &&
    !touchedSince(handle, competitionId, id, [runner.cardNumber, change.newCard], change.undoOf)
  )
    return null;
  const status = resultChanged(handle, competitionId, new Map([[id, change.newCard]])).get(id);
  if (status === undefined) return null;
  const lose: LoseResult = {
    card_number: runner.cardNumber,
    // The newest card change of the runner: a change made and taken back
    // since the warning is not the state the warning was for.
    card_seq:
      handle.db
        .select({ seq: max(events.localSeq) })
        .from(events)
        .where(
          and(
            eq(events.competitionId, competitionId),
            inArray(events.eventType, ['card_bound', 'card_unbound']),
            sql`json_extract(${events.payload}, '$.competitor_id') = ${id}`
          )
        )
        .get()?.seq ?? 0,
    status,
    // For an undo: the reads made with the card since the change.
    ...readsOnCard(handle, competitionId, runner.cardNumber, change.undoOf ?? 0),
  };
  if (isDeepStrictEqual(confirmed, lose)) return null;
  return { error: 'has_result', competitor_id: id, name: runner.name, lose_result: lose };
}
