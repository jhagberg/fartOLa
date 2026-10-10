// Authored for fartola. Not ported from upstream.
//
// What the IOF ResultList needs beyond the projection, shared by the export
// download and the Eventor push: the courses (length per class, SOFT TR
// 7.8.2), each runner's Eventor person id (SOFT TA till TR 7.8.3) and the
// fees fartOLa charged (SOFT TR 4.12.4, 4.12.6).

import { and, eq, isNotNull, or } from 'drizzle-orm';

import type { DbHandle } from '../db/index.ts';
import { competitors, hiredCards } from '../db/schema.ts';
import type { ExportInput, RunnerFees } from '../xml/iofExport.ts';
import { loadCourseDTOs } from './_courses.ts';

export function resultListInputs(
  handle: DbHandle,
  competitionId: string
): Pick<ExportInput, 'courses' | 'eventorPersonIds' | 'fees'> {
  const ids = handle.db
    .select({ id: competitors.id, eventorPersonId: competitors.eventorPersonId })
    .from(competitors)
    .where(
      and(eq(competitors.competitionId, competitionId), isNotNull(competitors.eventorPersonId))
    )
    .all();
  // A rental belongs to the runner who holds the card now.
  const charged = handle.db
    .select({
      id: competitors.id,
      entry: competitors.entryFee,
      late: competitors.lateFee,
      card: hiredCards.fee,
    })
    .from(competitors)
    .leftJoin(
      hiredCards,
      and(
        eq(hiredCards.competitionId, competitors.competitionId),
        eq(hiredCards.cardNumber, competitors.cardNumber)
      )
    )
    .where(
      and(
        eq(competitors.competitionId, competitionId),
        or(isNotNull(competitors.entryFee), isNotNull(hiredCards.fee))
      )
    )
    .all();
  return {
    courses: loadCourseDTOs(handle, competitionId),
    eventorPersonIds: new Map(ids.map((r) => [r.id, r.eventorPersonId!])),
    fees: new Map(charged.map((r): [string, RunnerFees] => [r.id, r])),
  };
}
