// Authored for fartola. Not ported from upstream.
//
// Logic for the "Saknade starttider" panel (02.1-14 Task 15,
// components/MissingStartsPanel.svelte): the header numbers, the start
// field's initial text, the resulting time for an edited start, and the
// batch apply. Kept out of the component so it can be tested without
// mounting Svelte.

import { formatWallClock, parseWallClock } from '@fartola/shared-types';
import {
  applyMissingStarts,
  type MissingStartItem,
  type MissingStartsResponse,
} from '$lib/api/client.ts';
import {
  formatElapsed,
  resolveStartInput,
  wallTimeOfDay,
  type StartEntry,
} from './readout-types.ts';

export type { MissingStartItem, MissingStartsResponse };

/** Below this many runners with check + start the suggestion uses the
 * 1:54 default (edge reduce.ts MIN_CHECK_TO_START_SAMPLES). */
const MIN_SAMPLES = 10;

/** "median 1:54 (medel 2:07, n=213)", or the default under 10 runners. */
export function statsLabel(
  r: Pick<MissingStartsResponse, 'n' | 'median_ms' | 'mean_ms' | 'offset_ms'>
):
  | { key: 'ms.stats'; vars: { median: string; mean: string; n: number } }
  | { key: 'ms.statsFallback'; vars: { offset: string; n: number } } {
  if (r.n >= MIN_SAMPLES && r.median_ms !== null && r.mean_ms !== null) {
    return {
      key: 'ms.stats',
      vars: { median: formatElapsed(r.median_ms), mean: formatElapsed(r.mean_ms), n: r.n },
    };
  }
  return { key: 'ms.statsFallback', vars: { offset: formatElapsed(r.offset_ms), n: r.n } };
}

/** A listed wall-clock time ('YYYY-MM-DDTHH:MM:SS') as 'HH:MM:SS', or ''. */
export function wallText(wall: string | null): string {
  const ms = wall === null ? null : parseWallClock(wall);
  return ms === null ? '' : wallTimeOfDay(ms);
}

/** The editable start field starts at the suggestion (HH:MM:SS), or empty. */
export function initialStartText(item: MissingStartItem): string {
  return wallText(item.suggested_start_wall);
}

/** Start text → a start on the runner's wall-clock timeline, before the
 * finish (readout-types resolveStartInput). */
function parseStart(item: MissingStartItem, text: string): StartEntry {
  return resolveStartInput(text, item.finish_wall);
}

/** Running time with the edited start: finish − start on the wall clock,
 * as the backend computes it; null when the text is not a time or the start
 * is after the finish. */
export function resultingTimeMs(item: MissingStartItem, text: string): number | null {
  const start = parseStart(item, text);
  if ('error' in start) return null;
  return parseWallClock(item.finish_wall)! - start.wallMs;
}

/** "Sätt" / "Sätt alla": one batch. Any row without a valid start → nothing
 * is sent and those competitor ids come back, with the first one's reason. */
export async function applyMissingStartRows(
  competitionId: string,
  rows: Array<{ item: MissingStartItem; text: string }>
): Promise<
  | { ok: true; updated: number }
  | { ok: false; invalid: string[]; error: 'invalid' | 'after_finish' }
> {
  const parsed = rows.map((r) => ({ id: r.item.competitor_id, start: parseStart(r.item, r.text) }));
  const bad = parsed.filter((p) => 'error' in p.start);
  if (bad.length > 0) {
    const first = bad[0]!.start as { error: 'invalid' | 'after_finish' };
    return { ok: false, invalid: bad.map((p) => p.id), error: first.error };
  }
  const { updated } = await applyMissingStarts(
    competitionId,
    parsed.map((p) => ({
      competitor_id: p.id,
      start_wall: formatWallClock((p.start as { wallMs: number }).wallMs),
    }))
  );
  return { ok: true, updated };
}
