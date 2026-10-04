// Authored for fartola. Not ported from upstream.
//
// Competition clock: start times are stored as epoch ms everywhere; these
// helpers convert to and from the competition's local wall clock. Lives in
// shared-types so apps/edge (via src/time/competitionClock.ts) and apps/web
// share one implementation and one time-zone constant.
//
// "Seconds since local midnight" means wall-clock seconds (h*3600+m*60+s),
// the same scale MeOS and the MOP `st` attribute use.
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-14-REPLAY-READINESS-PLAN.md Task 1

/** The one place the competition time zone is defined. */
export const COMPETITION_TZ = 'Europe/Stockholm';

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (f === undefined) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Local wall-clock fields for an epoch ms. */
function localParts(epochMs: number, tz: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of formatterFor(tz).formatToParts(epochMs)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

/** Offset (local − UTC) in ms at the given instant. */
function offsetMs(epochMs: number, tz: string): number {
  const p = localParts(epochMs, tz);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return asUtc - (epochMs - (((epochMs % 1000) + 1000) % 1000));
}

/** 'YYYY-MM-DD' + seconds after local midnight → epoch ms. */
export function localToEpochMs(
  date: string,
  secondsSinceMidnight: number,
  tz: string = COMPETITION_TZ
): number {
  const [y, m, d] = date.split('-').map(Number);
  const naive = Date.UTC(y!, m! - 1, d!) + secondsSinceMidnight * 1000;
  // Guess with the offset at the naive instant, then correct once with the
  // offset at the guess (handles the DST switch between the two).
  const guess = naive - offsetMs(naive, tz);
  return naive - offsetMs(guess, tz);
}

/** Epoch ms → seconds after local midnight on that local day (fractional
 * when the input has sub-second ms). */
export function epochToLocalSeconds(epochMs: number, tz: string = COMPETITION_TZ): number {
  const p = localParts(epochMs, tz);
  const ms = ((epochMs % 1000) + 1000) % 1000;
  return p.hour! * 3600 + p.minute! * 60 + p.second! + ms / 1000;
}

/** Epoch ms → 'HH:MM:SS' local. */
export function formatLocalTime(epochMs: number, tz: string = COMPETITION_TZ): string {
  const p = localParts(epochMs, tz);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(p.hour!)}:${pad(p.minute!)}:${pad(p.second!)}`;
}
