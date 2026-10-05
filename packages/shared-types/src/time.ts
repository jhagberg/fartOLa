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
const DAY_MS = 86_400_000;
const BUCKET_MS = 15 * 60_000;
const offsetCache = new Map<string, number>();

/**
 * The zone's UTC offset, cached per 15 minutes of UTC time: offsets only
 * change at DST transitions, which fall on whole quarter hours, and
 * `formatToParts` is far too slow to call for every punch in a reduce.
 */
function cachedOffsetMs(epochMs: number, tz: string): number {
  const key = `${tz}|${Math.floor(epochMs / BUCKET_MS)}`;
  let offset = offsetCache.get(key);
  if (offset === undefined) {
    if (offsetCache.size > 10_000) offsetCache.clear();
    offset = offsetMs(epochMs, tz);
    offsetCache.set(key, offset);
  }
  return offset;
}

export function localToEpochMs(
  date: string,
  secondsSinceMidnight: number,
  tz: string = COMPETITION_TZ
): number {
  const [y, m, d] = date.split('-').map(Number);
  const naive = Date.UTC(y!, m! - 1, d!) + secondsSinceMidnight * 1000;
  // Guess with the offset at the naive instant, then correct once with the
  // offset at the guess (handles the DST switch between the two).
  const guess = naive - cachedOffsetMs(naive, tz);
  return naive - cachedOffsetMs(guess, tz);
}

/** Epoch ms → the local wall clock, as ms since 1970-01-01 00:00 local. */
export function epochToWallClockMs(epochMs: number, tz: string = COMPETITION_TZ): number {
  return epochMs + cachedOffsetMs(epochMs, tz);
}

/**
 * Every epoch ms whose local wall clock reads `wallMs` (epochToWallClockMs's
 * scale), ascending: two in the hour repeated when DST ends, otherwise one.
 * A wall time skipped when DST starts gets the instant localToEpochMs gives
 * (read with the offset before the switch).
 */
export function wallClockToEpochMs(wallMs: number, tz: string = COMPETITION_TZ): number[] {
  // The offsets in force half a day either side cover any switch near wallMs.
  const offsets = new Set([
    cachedOffsetMs(wallMs - DAY_MS / 2, tz),
    cachedOffsetMs(wallMs + DAY_MS / 2, tz),
  ]);
  const out: number[] = [];
  for (const offset of offsets) {
    if (cachedOffsetMs(wallMs - offset, tz) === offset) out.push(wallMs - offset);
  }
  if (out.length === 0) out.push(wallMs - cachedOffsetMs(wallMs - cachedOffsetMs(wallMs, tz), tz));
  return out.sort((a, b) => a - b);
}

/** Epoch ms → seconds after local midnight on that local day (fractional
 * when the input has sub-second ms). */
export function epochToLocalSeconds(epochMs: number, tz: string = COMPETITION_TZ): number {
  const local = epochMs + cachedOffsetMs(epochMs, tz);
  return (((local % DAY_MS) + DAY_MS) % DAY_MS) / 1000;
}

/** Epoch ms → 'HH:MM:SS' local. */
export function formatLocalTime(epochMs: number, tz: string = COMPETITION_TZ): string {
  const secs = Math.floor(epochToLocalSeconds(epochMs, tz));
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(Math.floor(secs / 3600))}:${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}`;
}

/** A wall-clock ms (epochToWallClockMs's scale) as 'YYYY-MM-DDTHH:MM:SS'
 * local, no offset ('.sss' appended when not a whole second). The wire form
 * of a wall-clock time: unlike epoch ms it can name a time in the hour
 * skipped when DST starts — where SI stations, which never switch, still
 * stamp punches. */
export function formatWallClock(wallMs: number): string {
  return new Date(wallMs).toISOString().slice(0, wallMs % 1000 === 0 ? 19 : 23);
}

const WALL_CLOCK_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?$/;

/** 'YYYY-MM-DDTHH:MM:SS[.sss]' local → wall-clock ms; null when not that
 * shape or not a real calendar date and time (formatWallClock's inverse). */
export function parseWallClock(text: string): number | null {
  if (!WALL_CLOCK_RE.test(text)) return null;
  const ms = Date.parse(`${text}Z`);
  if (Number.isNaN(ms)) return null;
  // Date.parse rolls 2026-02-30 over to March and T24:00 to the next day;
  // the round trip catches both.
  return new Date(ms).toISOString().slice(0, 19) === text.slice(0, 19) ? ms : null;
}

/** 'HH:MM' or 'HH:MM:SS' (spaces around allowed) → seconds after midnight;
 * null when not a time of day. */
export function parseTimeOfDay(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  if (!m) return null;
  const [h, min, sec] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  if (h > 23 || min > 59 || sec > 59) return null;
  return h * 3600 + min * 60 + sec;
}

/** Longest run a start entered as a time of day is placed for: 12 h, the
 * bound card clocks are resolved within (apps/edge halfDayClockMath.ts). */
const MAX_RUN_MS = 12 * 3600 * 1000;

/** A start entered as a time of day (seconds after midnight), on the
 * wall-clock timeline of `finishWallMs` (epochToWallClockMs's scale, the one
 * the running time is computed on): the latest such wall time not after the
 * finish, so 23:50 against a finish at 00:10 is the day before. Null when
 * that is more than 12 h before the finish — the start is after it (10:30
 * against 10:00). Plain arithmetic on the wall clock, so DST nights are
 * no different. */
export function startBeforeFinishWallMs(secondsOfDay: number, finishWallMs: number): number | null {
  const midnight = finishWallMs - (((finishWallMs % DAY_MS) + DAY_MS) % DAY_MS);
  let start = midnight + secondsOfDay * 1000;
  if (start > finishWallMs) start -= DAY_MS;
  return finishWallMs - start > MAX_RUN_MS ? null : start;
}
