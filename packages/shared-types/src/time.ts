// Authored for fartola. Not ported from upstream.
//
// Competition clock: every timestamp is stored as epoch ms; times shown to
// people, read off SI cards and exchanged with IOF/MOP are on the
// competition clock = epoch + ONE constant UTC offset per competition
// (ADR-0012). That is what an SI station is: a clock set once to a fixed
// offset, which does not switch at DST. The default offset is the zone's at
// local noon of the competition date; competitions.clock_offset_min
// overrides it. Lives in shared-types so apps/edge (via
// src/time/competitionClock.ts) and apps/web share one implementation.
//
// Civil, DST-aware time (localToEpochMs) is only for the calendar: picking
// the default offset and event-code expiry. Never for timing.
//
// "Seconds since midnight" means clock seconds (h*3600+m*60+s), the same
// scale MeOS and the MOP `st` attribute use.
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-14-REPLAY-READINESS-PLAN.md Task 1
// - docs/decisions/0012-competition-time-on-local-wall-clock.md

/** The one place the competition time zone is defined. */
export const COMPETITION_TZ = 'Europe/Stockholm';

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

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

/** The zone's civil offset (local − UTC) in ms at the given instant. Civil
 * time: for the calendar and for migrating data written on the old civil
 * clock (apps/edge db/migrate.ts), never for timing. */
export function zoneOffsetMs(epochMs: number, tz: string = COMPETITION_TZ): number {
  const p: Record<string, number> = {};
  for (const part of formatterFor(tz).formatToParts(epochMs)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return asUtc - (epochMs - (((epochMs % 1000) + 1000) % 1000));
}

/** Civil time: 'YYYY-MM-DD' + seconds after local midnight in `tz` → epoch
 * ms, DST-aware. For the calendar only (event-code expiry, the default clock
 * offset); timing uses clockToEpochMs. */
export function localToEpochMs(
  date: string,
  secondsSinceMidnight: number,
  tz: string = COMPETITION_TZ
): number {
  const [y, m, d] = date.split('-').map(Number);
  const naive = Date.UTC(y!, m! - 1, d!) + secondsSinceMidnight * 1000;
  // Guess with the offset at the naive instant, then correct once with the
  // offset at the guess (handles the DST switch between the two).
  const guess = naive - zoneOffsetMs(naive, tz);
  return naive - zoneOffsetMs(guess, tz);
}

/** The default competition-clock offset in minutes: the zone's UTC offset at
 * local noon of the competition date (the offset stations are synced to on
 * a day race, and on a night race dated the evening it starts). */
export function defaultClockOffsetMin(date: string, tz: string = COMPETITION_TZ): number {
  return zoneOffsetMs(localToEpochMs(date, 12 * 3600, tz), tz) / MIN_MS;
}

/** The competition clock's offset in minutes: the operator's override
 * (competitions.clock_offset_min), else the date's default. */
export function competitionClockOffsetMin(
  date: string,
  overrideMin: number | null | undefined
): number {
  return overrideMin ?? defaultClockOffsetMin(date);
}

/** 'YYYY-MM-DD' + seconds after midnight on the competition clock → epoch ms. */
export function clockToEpochMs(
  date: string,
  secondsSinceMidnight: number,
  offsetMin: number
): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!) + secondsSinceMidnight * 1000 - offsetMin * MIN_MS;
}

/** Epoch ms → seconds after midnight on the competition clock (fractional
 * when the input has sub-second ms). */
export function epochToClockSeconds(epochMs: number, offsetMin: number): number {
  const clock = epochMs + offsetMin * MIN_MS;
  return (((clock % DAY_MS) + DAY_MS) % DAY_MS) / 1000;
}

/** Epoch ms → 'HH:MM:SS' on the competition clock. */
export function formatClockTime(epochMs: number, offsetMin: number): string {
  const secs = Math.floor(epochToClockSeconds(epochMs, offsetMin));
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(Math.floor(secs / 3600))}:${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}`;
}

/** Epoch ms → xs:dateTime on the competition clock with its offset, e.g.
 * '2026-03-29T02:00:54+01:00' ('.sss' when not a whole second): the exact
 * instant, reading as the station time. */
export function formatClockDateTime(epochMs: number, offsetMin: number): string {
  const clock = new Date(epochMs + offsetMin * MIN_MS).toISOString();
  const abs = Math.abs(offsetMin);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const offset = `${offsetMin < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return clock.slice(0, epochMs % 1000 === 0 ? 19 : 23) + offset;
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

/** A start entered as a time of day (seconds after midnight on the
 * competition clock) as epoch ms: the latest such time not after
 * `finishMs`, so 23:50 against a finish at 00:10 is the day before. Null
 * when that is more than 12 h before the finish — the start is after it
 * (10:30 against 10:00). Fixed offset, so DST nights are no different. */
export function startBeforeFinishMs(
  secondsOfDay: number,
  finishMs: number,
  offsetMin: number
): number | null {
  const finishClock = finishMs + offsetMin * MIN_MS;
  const midnight = finishClock - (((finishClock % DAY_MS) + DAY_MS) % DAY_MS);
  let start = midnight + secondsOfDay * 1000;
  if (start > finishClock) start -= DAY_MS;
  return finishClock - start > MAX_RUN_MS ? null : start - offsetMin * MIN_MS;
}
