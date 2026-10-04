// Authored for fartola. Not ported from upstream.
//
// Logic for the "Saknade starttider" panel (02.1-14 Task 15,
// components/MissingStartsPanel.svelte): the header numbers, the start
// field's initial text, the resulting time for an edited start, and the
// batch apply. Kept out of the component so it can be tested without
// mounting Svelte.

import { formatLocalTime } from '@fartola/shared-types';
import {
  applyMissingStarts,
  type MissingStartItem,
  type MissingStartsResponse,
} from '#lib/api/client.ts';
import { formatElapsed, parseStartTimeInput } from './readout-types.ts';

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

/** The editable start field starts at the suggestion (HH:MM:SS), or empty. */
export function initialStartText(item: MissingStartItem): string {
  return item.suggested_start_ms === null ? '' : formatLocalTime(item.suggested_start_ms);
}

/** Start text → epoch ms on the runner's day (the finish anchors it). */
function parseStart(item: MissingStartItem, text: string): number | null {
  return parseStartTimeInput(text, item.suggested_start_ms ?? item.finish_ms);
}

/** Running time with the edited start; null when the text is not a time or
 * the start is after the finish. */
export function resultingTimeMs(item: MissingStartItem, text: string): number | null {
  const start = parseStart(item, text);
  if (start === null || start > item.finish_ms) return null;
  return item.finish_ms - start;
}

/** "Sätt" / "Sätt alla": one batch. Any row without a valid time → nothing
 * is sent and those competitor ids come back. */
export async function applyMissingStartRows(
  competitionId: string,
  rows: Array<{ item: MissingStartItem; text: string }>
): Promise<{ ok: true; updated: number } | { ok: false; invalid: string[] }> {
  const parsed = rows.map((r) => ({ id: r.item.competitor_id, start: parseStart(r.item, r.text) }));
  const invalid = parsed.filter((p) => p.start === null).map((p) => p.id);
  if (invalid.length > 0) return { ok: false, invalid };
  const { updated } = await applyMissingStarts(
    competitionId,
    parsed.map((p) => ({ competitor_id: p.id, start_time_ms: p.start! }))
  );
  return { ok: true, updated };
}
