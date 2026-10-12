// Authored for fartola. Not ported from upstream.
//
// The speaker demo's data source: a recorded day (speaker-demo.json) and a
// playback clock instead of the server. At playback time T the board is the
// real one (buildSpeakerBoard, the function the server route calls) over
// everything known by T: the radio punches received, and the results of
// the cards read. boardAt keeps no state between calls, so pausing, a new
// speed or a jump back in time cannot give another board than playing
// straight to T.
//
// The dataset is written by fartOLa-tools/replay (speaker-demo): invented
// names and clubs, moved times. All its times are whole seconds since
// midnight of `date` on the competition clock.

import type { SpeakerBoard, SpeakerRunnerStatus } from '@fartola/shared-types';
// The server's own board calculation. It is pure and imports nothing that
// needs Node; the demo build (vite.demo.config.ts) fails if that changes.
import { buildSpeakerBoard, type BoardRunnerIn } from '../../../edge/src/speaker/board.ts';

export interface SpeakerDemoData {
  name: string;
  date: string;
  clock_offset_min: number;
  radio_controls: number[];
  finish_codes: number[];
  /** [from, to]: runners passed a radio control but no punch came in. */
  radio_outages: number[][];
  clubs: string[];
  /** By name; `controls` = the course's radio controls in course order. */
  classes: Array<{ name: string; controls: number[] }>;
  /** [name, club, class, start, start known from the morning (1) or only
   * from the card (0), when the result became known, final status,
   * running time if OK]. */
  runners: Array<Array<string | number | null>>;
  /** [received, runner, control code, punch time], in the order received. */
  radio: number[][];
}

type RunnerRow = [
  string,
  number | null,
  number,
  number | null,
  0 | 1,
  number,
  string,
  number | null,
];

/** Epoch ms of a time in the dataset. */
export function demoMs(data: SpeakerDemoData, seconds: number): number {
  return Date.parse(`${data.date}T00:00:00Z`) - data.clock_offset_min * 60_000 + seconds * 1000;
}

/** When something became known (a radio punch came in, a result was read),
 * ascending. The board only changes at these times. */
export function eventTimes(data: SpeakerDemoData): number[] {
  return [...data.radio.map((p) => p[0]!), ...data.runners.map((r) => r[5] as number)]
    .sort((a, b) => a - b)
    .map((s) => demoMs(data, s));
}

/** The board as the speaker saw it at `tMs`. */
export function boardAt(data: SpeakerDemoData, tMs: number): SpeakerBoard {
  const at = (s: number): number => demoMs(data, s);
  const rows = data.runners as RunnerRow[];
  const known = rows.map((r) => at(r[5]) <= tMs);
  // The result list so far: place = 1 + the number of better times, so
  // equal times share the place, as in the projection.
  const timesIn = data.classes.map((_, c) =>
    rows.flatMap((r, i) => (known[i] && r[2] === c && r[7] !== null ? [r[7]] : []))
  );
  const runners: BoardRunnerIn[] = rows.map((r, i) => {
    const [name, club, cls, start, drawn, , status, time] = r;
    const result = known[i] && time !== null ? time : null;
    const others = timesIn[cls]!;
    return {
      id: String(i),
      name,
      club: club === null ? null : data.clubs[club]!,
      class_id: String(cls),
      // The dataset has no card numbers: a runner's index stands in.
      card_number: i,
      start_time_ms: start !== null && (drawn === 1 || known[i]) ? at(start) : null,
      status: known[i] ? (status as SpeakerRunnerStatus) : 'PEND',
      elapsed_time_ms: result === null ? null : result * 1000,
      place: result === null ? null : 1 + others.filter((t) => t < result).length,
      behind_leader_ms: result === null ? null : (result - Math.min(...others)) * 1000,
      // Never after the read-out: an event the speaker sees at T is not
      // stamped later than T (a card clock can run ahead of the reader's).
      finish_at_ms: result === null || start === null ? null : at(Math.min(start + result, r[5])),
    };
  });
  return buildSpeakerBoard({
    classes: data.classes.map((c, i) => ({ id: String(i), name: c.name, course_id: String(i) })),
    courses: data.classes.map((c, i) => ({
      id: String(i),
      class_id: String(i),
      controls: c.controls.map((control_code, order_idx) => ({ control_code, order_idx })),
    })),
    runners,
    radio: data.radio
      .filter((p) => at(p[0]!) <= tMs)
      .map((p) => ({ card: p[1]!, code: p[2]!, timeMs: at(p[3]!) })),
    radioControls: data.radio_controls,
    finishCodes: data.finish_codes,
    clockOffsetMin: data.clock_offset_min,
  });
}

/** boardAt, computed again only when something new is known at `tMs`. */
export function boardSource(data: SpeakerDemoData): (tMs: number) => SpeakerBoard {
  const times = eventTimes(data);
  let count = -1;
  let board: SpeakerBoard;
  return (tMs) => {
    const n = times.filter((t) => t <= tMs).length;
    if (n !== count) {
      board = boardAt(data, tMs);
      count = n;
    }
    return board;
  };
}

/** The first finish in the named classes (the radio punch at the finish, or
 * the read-out if no punch came in); null if nobody finished. */
export function firstFinishMs(data: SpeakerDemoData, classNames: string[]): number | null {
  const chosen = (runner: number): boolean =>
    classNames.includes(data.classes[data.runners[runner]![2] as number]!.name);
  const times = [
    ...data.radio
      .filter((p) => data.finish_codes.includes(p[2]!) && chosen(p[1]!))
      .map((p) => p[0]!),
    ...data.runners.flatMap((r, i) => (r[6] === 'OK' && chosen(i) ? [r[5] as number] : [])),
  ];
  return times.length === 0 ? null : demoMs(data, Math.min(...times));
}

/** How many events fall in each of `buckets` equal parts of [from, to]. */
export function density(times: number[], fromMs: number, toMs: number, buckets: number): number[] {
  const out = new Array<number>(buckets).fill(0);
  for (const t of times) {
    if (t < fromMs || t > toMs) continue;
    out[Math.min(buckets - 1, Math.floor(((t - fromMs) / (toMs - fromMs)) * buckets))]!++;
  }
  return out;
}

export interface PlaybackClock {
  /** Playback time now, epoch ms, within [startMs, endMs]. */
  time(): number;
  readonly playing: boolean;
  readonly speed: number;
  readonly startMs: number;
  readonly endMs: number;
  play(): void;
  pause(): void;
  setSpeed(speed: number): void;
  seek(tMs: number): void;
}

/**
 * Playback time = where it was last set + the real time since then × speed.
 * It is set again (anchored) on every pause, speed change and jump, so none
 * of them moves the clock. Stops at the end. `now` is the real clock in ms.
 */
export function createClock(
  startMs: number,
  endMs: number,
  now: () => number = () => performance.now()
): PlaybackClock {
  let anchor = startMs;
  let anchorReal = now();
  let playing = false;
  let speed = 1;
  const time = (): number =>
    Math.min(endMs, Math.max(startMs, playing ? anchor + (now() - anchorReal) * speed : anchor));
  const set = (tMs: number): void => {
    // Ran to the end: stopped, so a jump back does not start it again.
    if (time() >= endMs) playing = false;
    anchor = Math.min(endMs, Math.max(startMs, tMs));
    anchorReal = now();
  };
  return {
    time,
    get playing() {
      return playing && time() < endMs;
    },
    get speed() {
      return speed;
    },
    startMs,
    endMs,
    play() {
      set(time() >= endMs ? startMs : time());
      playing = true;
    },
    pause() {
      set(time());
      playing = false;
    },
    setSpeed(next) {
      set(time());
      speed = next;
    },
    seek: set,
  };
}
