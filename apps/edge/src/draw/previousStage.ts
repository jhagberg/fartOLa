// Authored for fartola. Not ported from upstream.
//
// Match an earlier stage's results (an IOF XML 3.0 ResultList, e.g. day 1
// exported from MeOS, OLA or Eventor) to this competition's runners for a
// pursuit (SOFT TR 7.4.1): by Eventor person id when both have one,
// otherwise by name and club when that pair is unique in the file. Runners
// without a match are reported, not refused: they start in the restart
// block. MeOS keeps the result on the runner (inputTime/inputStatus).

export interface StageEntry {
  id: string;
  name: string;
  club: string | null;
  eventorPersonId: number | null;
}

export interface PreviousResult {
  name: string;
  club: string | null;
  eventorPersonId: number | null;
  timeMs: number | null;
  status: string | null;
}

const key = (name: string, club: string | null) =>
  `${name.trim().toLowerCase()}|${(club ?? '').trim().toLowerCase()}`;

export function matchPreviousStage(
  current: readonly StageEntry[],
  previous: readonly PreviousResult[]
): {
  matched: Array<{ id: string; timeMs: number | null; status: string | null }>;
  unmatched: StageEntry[];
} {
  const byPerson = new Map<number, PreviousResult>();
  const byName = new Map<string, PreviousResult | null>(); // null = ambiguous
  for (const p of previous) {
    if (p.eventorPersonId !== null) byPerson.set(p.eventorPersonId, p);
    const k = key(p.name, p.club);
    byName.set(k, byName.has(k) ? null : p);
  }
  const matched: Array<{ id: string; timeMs: number | null; status: string | null }> = [];
  const unmatched: StageEntry[] = [];
  for (const c of current) {
    const p =
      (c.eventorPersonId !== null ? byPerson.get(c.eventorPersonId) : undefined) ??
      byName.get(key(c.name, c.club)) ??
      undefined;
    if (p === undefined) unmatched.push(c);
    else matched.push({ id: c.id, timeMs: p.timeMs, status: p.status });
  }
  return { matched, unmatched };
}
