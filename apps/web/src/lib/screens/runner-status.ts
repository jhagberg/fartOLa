// Authored for fartola. Not ported from upstream.
//
// Status filters on the Anmälda list (todo 2026-10-05-runners-list-with-
// status): the everyday secretariat questions, answered from the projection
// (GET …/runner-status) and the class's no_timing flag.

import type { ClassDTO, CompetitorDTO } from '@fartola/shared-types';
import type { RunnerStatus } from '#lib/api/client.ts';

export const STATUS_FILTERS = ['missingStart', 'mp', 'notRead', 'manual', 'noTiming'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export function isStatusFilter(v: string | null): v is StatusFilter {
  return (STATUS_FILTERS as readonly string[]).includes(v ?? '');
}

/** Whether the runner answers the filter. A runner the projection does not
 * know yet only matches noTiming. */
export function matchesStatus(
  filter: StatusFilter,
  runner: Pick<CompetitorDTO, 'class_id'>,
  status: RunnerStatus | undefined,
  classById: ReadonlyMap<string, Pick<ClassDTO, 'no_timing'>>
): boolean {
  switch (filter) {
    case 'missingStart':
      return status?.missing_start === true;
    case 'mp':
      return status?.status === 'MP';
    case 'notRead':
      return status?.status === 'PEND';
    case 'manual':
      return (status?.manual_status ?? null) !== null;
    case 'noTiming':
      return classById.get(runner.class_id)?.no_timing === true;
  }
}
