// Authored for fartola. Not ported from upstream.
//
// A runner who has a result keeps it. The rule for every request that
// changes a runner's card number:
//
//   - A read-out belongs to the runner who has that card number now
//     (projection/reduce.ts, cardIndex). A card change takes a result away
//     in two ways, and both count:
//       a. the runner has reads in the race on the card that is taken away.
//          They stop counting: the runner is "not read out" again, or gets
//          another result (the new card's reads, or a finish entered by hand
//          without the punches);
//       b. the runner has a result and would have none with the new card.
//          That is a status set by hand: it follows the runner, not the
//          card, but a read of the new card made in a race that was reset
//          since clears it and scores nothing.
//   - One runner at a time ("Ändra", "Byt bricka"): refused with 409
//     has_result { competitor_id, name, lose_result }. lose_result names
//     what is lost: the card the runner has and the card change that gave
//     it, the runner's status, how many reads of the card count and which
//     is the newest. The request goes through only when it sends that
//     lose_result back unchanged. When any of it has changed (another card,
//     the same card given again, another read, another status, a reset) the
//     confirmation is for something else and the answer is the same 409,
//     with lose_result as it is now.
//   - The undo of a card change gives back what was there before it. It
//     takes back what the change gave: the read-out it attached, and a
//     status set by hand that came back into view when the old card's reads
//     left the runner. What it may not take in silence is what came SINCE
//     the change: a read made with the new card (a), or a result the runner
//     has without the new card that the OLD card's reads would clear, when
//     the runner's result was changed by hand, or the old card was read,
//     since the change (b). One runner at a time that is the same 409 and
//     the same confirmation.
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

/** The projection of the competition as stored, with some runners' cards
 * changed (runner id → card). Nothing is written. */
function statusesWith(
  handle: DbHandle,
  competitionId: string,
  cardOf: ReadonlyMap<string, number | null>
): (id: string) => string {
  const input = loadCompetitionInputs(handle, competitionId);
  if (input === null) return () => 'PEND';
  const state = reduce({
    ...input,
    competitors: input.competitors.map((c) =>
      cardOf.has(c.id) ? { ...c, cardNumber: cardOf.get(c.id)! } : c
    ),
  });
  return (id) => state.competitors.get(id)?.status ?? 'PEND';
}

/** For the undo of the card change stored as event `seq`: whether, since
 * then, the old card was read or anything was stored about the runner
 * (a status, a finish, a punch by hand) other than a card change. */
export function touchedSince(
  handle: DbHandle,
  competitionId: string,
  runnerId: string,
  previousCard: number | null,
  seq: number
): boolean {
  return (
    handle.db
      .select({ n: count() })
      .from(events)
      .where(
        and(
          eq(events.competitionId, competitionId),
          gt(events.localSeq, seq),
          sql`((${events.eventType} = 'card_read'
                AND json_extract(${events.payload}, '$.card_number') = ${previousCard})
            OR (${events.eventType} NOT IN ('card_bound', 'card_unbound')
                AND json_extract(${events.payload}, '$.competitor_id') = ${runnerId}))`
        )
      )
      .get()!.n > 0
  );
}

/** Rule b: of the runners in `cardOf` (runner id → new card), those who
 * have a result now and would have none with the new cards. The reducer
 * decides. `from`: compare with these cards instead of the stored ones (an
 * undo: the runners with no card, so that a read-out the change attached
 * is not counted as a result). */
export function resultGone(
  handle: DbHandle,
  competitionId: string,
  cardOf: ReadonlyMap<string, number | null>,
  from: ReadonlyMap<string, number | null> = new Map()
): Set<string> {
  if (cardOf.size === 0) return new Set();
  const before = statusesWith(handle, competitionId, from);
  const withResult = [...cardOf.keys()].filter((id) => before(id) !== 'PEND');
  if (withResult.length === 0) return new Set();
  const after = statusesWith(handle, competitionId, cardOf);
  return new Set(withResult.filter((id) => after(id) === 'PEND'));
}

/** The 409 body when a card change would take a result from `runner` and
 * `confirmed` is not exactly what would be lost; null to go on. `newCard`:
 * the card the runner gets. `undoOf`: the change is the undo of the card
 * change stored as that event (see the rule: only what came since it).
 * Call it in the same tick as the write (no await in between). */
export function resultLost(
  handle: DbHandle,
  runner: { id: string; competitionId: string; name: string; cardNumber: number | null },
  change: { newCard: number | null; undoOf?: number },
  confirmed: LoseResult | undefined
): { error: 'has_result'; competitor_id: string; name: string; lose_result: LoseResult } | null {
  const reads = readsOnCard(handle, runner.competitionId, runner.cardNumber, change.undoOf ?? 0);
  const lost =
    reads.reads > 0 ||
    ((change.undoOf === undefined ||
      touchedSince(handle, runner.competitionId, runner.id, change.newCard, change.undoOf)) &&
      resultGone(
        handle,
        runner.competitionId,
        new Map([[runner.id, change.newCard]]),
        change.undoOf === undefined ? undefined : new Map([[runner.id, null]])
      ).has(runner.id));
  if (!lost) return null;
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
            eq(events.competitionId, runner.competitionId),
            inArray(events.eventType, ['card_bound', 'card_unbound']),
            sql`json_extract(${events.payload}, '$.competitor_id') = ${runner.id}`
          )
        )
        .get()?.seq ?? 0,
    status: statusesWith(handle, runner.competitionId, new Map())(runner.id),
    ...reads,
  };
  if (isDeepStrictEqual(confirmed, lose)) return null;
  return { error: 'has_result', competitor_id: runner.id, name: runner.name, lose_result: lose };
}
