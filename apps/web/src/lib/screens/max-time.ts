// Authored for fartola. Not ported from upstream.
// A max time as the operator types it, on Lottning and Tävlingsinfo alike:
// mm:ss (or h:mm:ss), such as 150:00.

/** Seconds as the mm:ss the field takes; '' = none. */
export function formatMaxTime(sec: number | null | undefined): string {
  if (sec == null) return '';
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/** Parse a max time: empty = clear (null), mm:ss or h:mm:ss = seconds
 * (> 0), anything else is 'invalid' and must never be saved. */
export function parseMaxTime(raw: string): number | null | 'invalid' {
  const v = raw.trim();
  if (v === '') return null;
  const m = /^(?:(\d{1,3}):([0-5]\d)|(\d{1,3}):([0-5]\d):([0-5]\d))$/.exec(v);
  if (m === null) return 'invalid';
  const sec =
    m[1] !== undefined
      ? Number(m[1]) * 60 + Number(m[2])
      : Number(m[3]) * 3600 + Number(m[4]) * 60 + Number(m[5]);
  return sec > 0 ? sec : 'invalid';
}
