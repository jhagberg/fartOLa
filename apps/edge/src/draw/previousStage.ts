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
  const prevByName = new Map<string, PreviousResult[]>();
  for (const p of previous) {
    if (p.eventorPersonId !== null) byPerson.set(p.eventorPersonId, p);
    const k = key(p.name, p.club);
    prevByName.set(k, [...(prevByName.get(k) ?? []), p]);
  }
  const currentByName = new Map<string, number>();
  for (const c of current) {
    const k = key(c.name, c.club);
    currentByName.set(k, (currentByName.get(k) ?? 0) + 1);
  }
  const matched: Array<{ id: string; timeMs: number | null; status: string | null }> = [];
  const unmatched: StageEntry[] = [];
  for (const c of current) {
    let p: PreviousResult | undefined;
    const byId = c.eventorPersonId !== null ? byPerson.get(c.eventorPersonId) : undefined;
    if (byId !== undefined) p = byId;
    else {
      // Name and club only when unique on both sides, and never against a
      // result that carries another person's Eventor id.
      const k = key(c.name, c.club);
      const cands = (prevByName.get(k) ?? []).filter(
        (x) =>
          c.eventorPersonId === null ||
          x.eventorPersonId === null ||
          x.eventorPersonId === c.eventorPersonId
      );
      if (cands.length === 1 && currentByName.get(k) === 1) p = cands[0];
    }
    if (p === undefined) unmatched.push(c);
    else matched.push({ id: c.id, timeMs: p.timeMs, status: p.status });
  }
  return { matched, unmatched };
}
