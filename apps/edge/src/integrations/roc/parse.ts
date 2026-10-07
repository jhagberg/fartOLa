// Authored for fartola. Not ported from upstream.
//
// Parser for ROC's getpunches.asp response: CRLF-separated lines
// `id;code;card;YYYY-MM-DD HH:MM:SS`. Blank lines are ignored. A line that
// does not parse is counted, never thrown on, so one bad row cannot stall
// the poller (the next poll still advances lastId past the good rows).

export interface RocRow {
  id: number;
  code: number;
  card: number;
  /** 'YYYY-MM-DD' as stamped by the ROC sender (may be wrong). */
  date: string;
  /** 'HH:MM:SS' local wall clock, no zone. */
  time: string;
}

export interface ParsedRocResponse {
  rows: RocRow[];
  /** Non-blank lines that were not a valid row. */
  malformed: number;
}

const ROW_RE = /^(\d+);(\d+);(\d+);(\d{4}-\d{2}-\d{2}) ([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/;

export function parseRocResponse(body: string): ParsedRocResponse {
  const rows: RocRow[] = [];
  let malformed = 0;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    const m = ROW_RE.exec(line);
    if (m === null) {
      malformed++;
      continue;
    }
    rows.push({
      id: Number(m[1]),
      code: Number(m[2]),
      card: Number(m[3]),
      date: m[4]!,
      time: `${m[5]}:${m[6]}:${m[7]}`,
    });
  }
  return { rows, malformed };
}
