// Authored for fartola. Not ported from upstream.
//
// The speaker view's pure parts: how many panels per row, and how one
// class's board splits into what the speaker reads (todo
// 2026-10-07-speaker-view). Runners who have not started, and DNS, MP, DNF
// and the other final statuses, never become time rows: they fold into
// counts (MeOS's speaker windows filled with "27:00 −11:03 Ej start").

import type { SpeakerClass, SpeakerRunner, SpeakerRunnerStatus } from '@fartola/shared-types';

/** Panels per row and rows: 1 → 1×1, 2 → 2×1, 3–4 → 2×2, 5–6 → 3×2, 7–9 → 3×3. */
export function speakerGrid(n: number): { cols: number; rows: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  return { cols, rows: Math.max(1, Math.ceil(n / cols)) };
}

export type OutStatus = Exclude<SpeakerRunnerStatus, 'PEND' | 'OK'>;
const OUT_ORDER: OutStatus[] = ['DNS', 'MP', 'DNF', 'DQ', 'MAX', 'CANCEL'];

export interface SpeakerPanel {
  /** Passed the last radio control, not finished: soonest expected first. */
  onWay: SpeakerRunner[];
  /** Everyone with a time somewhere: furthest point first, then by place. */
  rows: SpeakerRunner[];
  /** Started, no time anywhere yet. */
  inForest: number;
  /** Start time still ahead (or none drawn). */
  notStarted: SpeakerRunner[];
  /** Final statuses other than OK, in a fixed order, empty groups left out. */
  out: Array<{ status: OutStatus; runners: SpeakerRunner[] }>;
}

/** How far a runner has come (higher = further) and its place there. */
function progress(r: SpeakerRunner): [number, number] {
  if (r.finish) return [r.passings.length + 2, r.finish.place];
  if (r.radio_finish_ms !== null) return [r.passings.length + 1, r.radio_finish_ms];
  const j = r.passings.findLastIndex((p) => p !== null);
  return j < 0 ? [0, 0] : [j + 1, r.passings[j]!.place];
}

export function speakerPanel(cls: SpeakerClass, nowMs: number): SpeakerPanel {
  const panel: SpeakerPanel = { onWay: [], rows: [], inForest: 0, notStarted: [], out: [] };
  const outBy = new Map<OutStatus, SpeakerRunner[]>();
  const last = cls.controls.length - 1;
  for (const r of cls.runners) {
    if (r.status !== 'PEND' && r.status !== 'OK') {
      outBy.set(r.status, [...(outBy.get(r.status) ?? []), r]);
      continue;
    }
    const [point] = progress(r);
    if (point > 0) panel.rows.push(r);
    else if (r.start_ms === null || r.start_ms > nowMs) panel.notStarted.push(r);
    else panel.inForest++;
    if (last >= 0 && r.passings[last] && !r.finish && r.radio_finish_ms === null) {
      panel.onWay.push(r);
    }
  }
  panel.rows.sort((a, b) => {
    const [pa, qa] = progress(a);
    const [pb, qb] = progress(b);
    return pb - pa || qa - qb;
  });
  panel.onWay.sort(
    (a, b) => (a.expected_finish_ms ?? Infinity) - (b.expected_finish_ms ?? Infinity)
  );
  panel.out = OUT_ORDER.filter((s) => outBy.has(s)).map((status) => ({
    status,
    runners: outBy.get(status)!,
  }));
  return panel;
}

/** How many are through each radio control, then the finish. The leader
 * there is the row with place 1 in that column. */
export function passedCounts(cls: SpeakerClass): number[] {
  return [
    ...cls.controls.map((_, i) => cls.runners.filter((r) => r.passings[i]).length),
    cls.runners.filter((r) => r.finish).length,
  ];
}
