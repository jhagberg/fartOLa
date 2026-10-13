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
//     has_result, which names the runner, the card and how many reads would
//     stop counting. It goes through only when the request says
//     lose_result { card_number, reads } with exactly those values. A
//     confirmation for another card or another number of reads (a read came
//     in since, the card was changed since) is refused the same way, with
//     the values as they are now.
//   - The undo of a card change takes back what the change gave, also the
//     read-out it attached. What it may not take in silence is a read made
//     with the new card SINCE the change: one runner at a time that is the
//     same 409 and the same confirmation.
//   - Many runners at once (the start list import and its undo) never carry
//     the confirmation: the import leaves such a runner's card as it is and
//     lists the row in its answer; the undo is refused. The one-runner
//     requests are the way to do it on purpose.
//
// "In the race" is what the reset of a race counts (routes/competitions.ts,
// takenByReset): reads at or after the race start. Before the start, and
// after a reset, no read is scored.

import { and, count, eq, gt, gte, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { DbHandle } from '../db/index.ts';
import { competitions, events } from '../db/schema.ts';
import { loadCompetitionInputs } from '../projection/loader.ts';
import { reduce } from '../projection/reduce.ts';

/** How many reads of `cardNumber` count in the race now; with `afterSeq`,
 * only those stored after that event (a card change).
 * shortcut: local_seq orders the events of one node, which is all there is
 * today; compare across nodes when edge-to-edge sync is built (ADR-0004). */
export function readsOnCard(
  handle: DbHandle,
  competitionId: string,
  cardNumber: number | null,
  afterSeq = 0
): number {
  if (cardNumber === null) return 0;
  const startMs = handle.db
    .select({ t: competitions.raceStartedAtMs })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .get()?.t;
  if (startMs === null || startMs === undefined) return 0;
  return handle.db
    .select({ n: count() })
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
    .get()!.n;
}

/** Rule b: of the runners in `cardOf` (runner id → new card), those who
 * have a result now and would have none with the new cards. The reducer
 * decides, on the stored data with the cards changed; nothing is written. */
export function resultGone(
  handle: DbHandle,
  competitionId: string,
  cardOf: ReadonlyMap<string, number | null>
): Set<string> {
  const input = cardOf.size === 0 ? null : loadCompetitionInputs(handle, competitionId);
  if (input === null) return new Set();
  const before = reduce(input).competitors;
  const withResult = [...cardOf.keys()].filter(
    (id) => (before.get(id)?.status ?? 'PEND') !== 'PEND'
  );
  if (withResult.length === 0) return new Set();
  const after = reduce({
    ...input,
    competitors: input.competitors.map((c) =>
      cardOf.has(c.id) ? { ...c, cardNumber: cardOf.get(c.id)! } : c
    ),
  }).competitors;
  return new Set(withResult.filter((id) => after.get(id)?.status === 'PEND'));
}

/** The confirmation of a one-runner card change: the card the runner has
 * and how many of its reads stop counting, as the 409 has_result named
 * them (no card, or no reads: rule b). */
export const LoseResult = z
  .object({
    card_number: z.number().int().positive().nullable(),
    reads: z.number().int().min(0),
  })
  .strict();

/** The 409 body when a card change would take a result from `runner` and
 * `confirmed` does not name exactly that; null to go on. `newCard`: the
 * card the runner gets (rule a and b). `afterSeq`: the change is the undo
 * of the card change stored as that event, and only reads since it count.
 * Call it in the same tick as the write (no await in between). */
export function resultLost(
  handle: DbHandle,
  runner: { id: string; competitionId: string; name: string; cardNumber: number | null },
  change: { newCard: number | null } | { afterSeq: number },
  confirmed: z.infer<typeof LoseResult> | undefined
): {
  error: 'has_result';
  competitor_id: string;
  name: string;
  card_number: number | null;
  reads: number;
} | null {
  const reads = readsOnCard(
    handle,
    runner.competitionId,
    runner.cardNumber,
    'afterSeq' in change ? change.afterSeq : 0
  );
  const lost =
    reads > 0 ||
    ('newCard' in change &&
      resultGone(handle, runner.competitionId, new Map([[runner.id, change.newCard]])).has(
        runner.id
      ));
  if (!lost) return null;
  if (confirmed?.card_number === runner.cardNumber && confirmed.reads === reads) return null;
  return {
    error: 'has_result',
    competitor_id: runner.id,
    name: runner.name,
    card_number: runner.cardNumber,
    reads,
  };
}
