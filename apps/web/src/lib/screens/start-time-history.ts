// Authored for fartola. Not ported from upstream.
//
// Logic for the start-time history (components/StartTimeHistory.svelte):
// which changes can be undone and a refused undo as plain Swedish. Undo is
// whole or nothing, as the server does it (routes/startTimes.ts): it is
// refused when a runner's start or the class's grid changed again since,
// and a clock shift cannot be undone on its own. A start-list import also
// changed card numbers and bibs: its undo is refused when one of them
// changed again, when the old one is taken, and when a runner has read out
// with the card the import gave (the result stays).

import { ApiError, type StartTimeHistoryItem } from '#lib/api/client.ts';

export type { StartTimeHistoryItem };

export function canUndo(item: StartTimeHistoryItem): boolean {
  return !item.undone && item.cause !== 'clock_shift';
}

/** A refused undo as an i18n key and its variables. */
export function undoErrorOf(e: unknown): { key: string; vars?: Record<string, unknown> } {
  if (e instanceof ApiError && e.body !== null && typeof e.body === 'object') {
    const b = e.body as { error?: string; competitor_ids?: string[] };
    const count = b.competitor_ids?.length ?? 0;
    switch (b.error) {
      case 'start_changed_since':
        return { key: 'history.err.changedSince', vars: { count } };
      case 'card_changed_since':
        return { key: 'history.err.cardChangedSince', vars: { count } };
      case 'bib_changed_since':
        return { key: 'history.err.bibChangedSince', vars: { count } };
      case 'card_taken':
        return { key: 'history.err.cardTaken', vars: { count } };
      case 'bib_taken':
        return { key: 'history.err.bibTaken', vars: { count } };
      case 'has_result':
        return { key: 'history.err.hasResult', vars: { count } };
      case 'grid_changed_since':
        return { key: 'history.err.gridChangedSince' };
      case 'already_undone':
        return { key: 'history.err.alreadyUndone' };
      case 'clock_shift_not_undoable':
        return { key: 'history.err.clockShift' };
      case 'start_times_event_not_found':
        return { key: 'history.err.notFound' };
    }
  }
  return { key: 'history.err.failed', vars: { error: (e as Error).message } };
}
