// Authored for fartola. Not ported from upstream.
//
// The speaker board (GET /api/competitions/:id/speaker): per class the
// radio controls in course order, each runner's place and time behind at
// each of them and at the finish, an expected finish time, and the events
// strip. A pure function of the projection's runners and the stored radio
// punches; radio punches never change results (the reducer ignores them).
//
// The prognosis mimics MeOS's speaker module (oEventSpeaker.cpp:1960-2030,
// read, not ported): expected = time at the last radio control + the best
// time anyone ran from there to the finish × the runner's relative speed,
// i.e. its time at that control over the best other runner's time there.
// MeOS predicts the next radio control as well; the board only predicts the
// finish, which is what the speaker announces.

import type {
  CourseControlDTO,
  SpeakerBoard,
  SpeakerClass,
  SpeakerEvent,
  SpeakerRunner,
  SpeakerRunnerStatus,
  SpeakerSplit,
} from '@fartola/shared-types';

export interface BoardRunnerIn {
  id: string;
  name: string;
  club: string | null;
  class_id: string;
  card_number: number | null;
  /** The start the running time is measured from (by the class's start
   * method), epoch ms; null when not known yet. */
  start_time_ms: number | null;
  status: SpeakerRunnerStatus;
  elapsed_time_ms: number | null;
  place: number | null;
  behind_leader_ms: number | null;
  /** Wall-clock finish (epoch ms) for the events strip; null if unknown. */
  finish_at_ms: number | null;
}

export interface BoardInput {
  /** In display order. */
  classes: Array<{ id: string; name: string; course_id: string | null; no_timing?: boolean }>;
  courses: Array<{ id: string; class_id: string | null; controls: CourseControlDTO[] }>;
  runners: BoardRunnerIn[];
  /** Radio punches placed on the competition clock (epoch ms). */
  radio: Array<{ card: number; code: number; timeMs: number }>;
  /** The competition's radio control codes; [] = every code that got punches. */
  radioControls: number[];
  /** Codes of finish radio units. */
  finishCodes: number[];
}

/** Final statuses that fold away: no passings, no events. */
const OUT: ReadonlySet<SpeakerRunnerStatus> = new Set(['MP', 'DNF', 'DNS', 'DQ', 'CANCEL', 'MAX']);
/** Per class, so the classes a speaker picked keep theirs however busy the
 * others are; the view filters and takes the newest. */
const MAX_EVENTS_PER_CLASS = 30;

/** Place = 1 + number of strictly better times; behind the best. */
function split(elapsed: number, all: number[]): SpeakerSplit {
  const best = Math.min(...all);
  return {
    elapsed_ms: elapsed,
    place: 1 + all.filter((t) => t < elapsed).length,
    behind_ms: elapsed - best,
  };
}

export function buildSpeakerBoard(input: BoardInput): SpeakerBoard {
  const finishCodes = new Set(input.finishCodes);
  // The same punch can arrive as two rows (two sender types): once per
  // (card, code, time), as the watchdog counts it.
  const byCard = new Map<number, Array<{ code: number; timeMs: number }>>();
  const seen = new Set<string>();
  for (const p of input.radio) {
    const k = `${p.card}:${p.code}:${p.timeMs}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const list = byCard.get(p.card) ?? [];
    list.push(p);
    byCard.set(p.card, list);
  }
  for (const list of byCard.values()) list.sort((a, b) => a.timeMs - b.timeMs);

  const radioCodes = new Set(
    input.radioControls.length > 0
      ? input.radioControls
      : input.radio.map((p) => p.code).filter((c) => !finishCodes.has(c))
  );

  /** The runner's punches from its start on. */
  const punchesOf = (r: BoardRunnerIn): Array<{ code: number; timeMs: number }> => {
    if (r.start_time_ms === null || r.card_number === null) return [];
    const start = r.start_time_ms;
    return (byCard.get(r.card_number) ?? []).filter((x) => x.timeMs >= start);
  };
  /** Elapsed at each radio occurrence in course order. The punches are
   * aligned to the occurrences in order, as many as possible (longest
   * common subsequence), so a control visited twice (butterfly, laps) gets
   * each visit and a missed passing does not shift the later ones. */
  const passingsOf = (r: BoardRunnerIn, controls: number[]): Array<number | null> => {
    const punches = punchesOf(r);
    const n = controls.length;
    const m = punches.length;
    const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i]![j] =
          controls[i] === punches[j]!.code
            ? 1 + dp[i + 1]![j + 1]!
            : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
    const out: Array<number | null> = controls.map(() => null);
    for (let i = 0, j = 0; i < n && j < m;) {
      if (controls[i] === punches[j]!.code && dp[i]![j] === 1 + dp[i + 1]![j + 1]!) {
        out[i] = punches[j]!.timeMs - r.start_time_ms!;
        i++;
        j++;
      } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
      else j++;
    }
    return out;
  };

  const classes: SpeakerClass[] = [];
  const events: SpeakerEvent[] = [];

  for (const cls of input.classes) {
    const course =
      input.courses.find((c) => c.id === cls.course_id) ??
      input.courses.find((c) => c.class_id === cls.id);
    // A class without timing shows no times anywhere public (no places either).
    const ordered = cls.no_timing
      ? []
      : [...(course?.controls ?? [])].sort((a, b) => a.order_idx - b.order_idx);
    const controls = ordered.map((cc) => cc.control_code).filter((c) => radioCodes.has(c));

    const ins = input.runners.filter((r) => r.class_id === cls.id);
    const elapsed = ins.map((r) =>
      OUT.has(r.status) ? controls.map(() => null) : passingsOf(r, controls)
    );
    const timesAt = controls.map((_, i) =>
      elapsed.map((row) => row[i]).filter((t): t is number => t !== null)
    );
    const finishOf = (r: BoardRunnerIn): SpeakerSplit | null =>
      r.status === 'OK' && r.place !== null && r.elapsed_time_ms !== null
        ? { elapsed_ms: r.elapsed_time_ms, place: r.place, behind_ms: r.behind_leader_ms ?? 0 }
        : null;

    // Best time from each radio control to the finish (MeOS bestLegTime).
    const bestLeg = controls.map((_, i) => {
      let best: number | null = null;
      ins.forEach((r, k) => {
        const at = elapsed[k]![i];
        const fin = finishOf(r);
        if (at == null || fin === null || fin.elapsed_ms <= at) return;
        const leg = fin.elapsed_ms - at;
        if (best === null || leg < best) best = leg;
      });
      return best;
    });

    const runners: SpeakerRunner[] = ins.map((r, k) => {
      const row = elapsed[k]!;
      const finish = finishOf(r);
      const finishPunch =
        r.status === 'PEND' && finish === null && !cls.no_timing
          ? punchesOf(r).find((p) => finishCodes.has(p.code))
          : undefined;
      const radioFinish = finishPunch ? finishPunch.timeMs - r.start_time_ms! : null;
      let expected: number | null = null;
      const j = row.findLastIndex((t) => t !== null);
      const leg = j >= 0 ? bestLeg[j] : null;
      if (r.status === 'PEND' && radioFinish === null && leg != null && r.start_time_ms !== null) {
        const at = row[j]!;
        // Relative speed against the best OTHER runner here (MeOS takes the
        // second best when the runner is the best).
        const others = timesAt[j]!.filter((_, idx) => idx !== timesAt[j]!.indexOf(at));
        const ref = others.length > 0 ? Math.min(...others) : at;
        expected = r.start_time_ms + at + Math.round(leg * (at / ref));
      }
      return {
        competitor_id: r.id,
        name: r.name,
        club: r.club,
        start_ms: r.start_time_ms,
        status: r.status,
        passings: row.map((t, i) => (t === null ? null : split(t, timesAt[i]!))),
        finish,
        radio_finish_ms: radioFinish,
        expected_finish_ms: expected,
      };
    });
    classes.push({ class_id: cls.id, class_name: cls.name, controls, runners });

    // Events: at each point, in the order they happened, the place counts
    // only the runners already through.
    const classEvents: SpeakerEvent[] = [];
    const base = (r: BoardRunnerIn) => ({
      class_id: cls.id,
      competitor_id: r.id,
      name: r.name,
      club: r.club,
    });
    const points: Array<Array<{ r: BoardRunnerIn; at: number; t: number; code: number | null }>> =
      controls.map((code, i) =>
        ins.flatMap((r, k) => {
          const t = elapsed[k]![i];
          return t == null ? [] : [{ r, at: r.start_time_ms! + t, t, code }];
        })
      );
    points.push(
      ins.flatMap((r) => {
        const fin = finishOf(r);
        return fin && r.finish_at_ms !== null
          ? [{ r, at: r.finish_at_ms, t: fin.elapsed_ms, code: null }]
          : [];
      })
    );
    for (const point of points) {
      point.sort((a, b) => a.at - b.at);
      const before: number[] = [];
      for (const p of point) {
        const s = split(p.t, [...before, p.t]);
        classEvents.push({
          ...base(p.r),
          at_ms: p.at,
          kind: p.code === null ? 'finish' : 'radio',
          control_code: p.code,
          elapsed_ms: p.t,
          place: s.place,
          behind_ms: s.behind_ms,
          new_leader: before.length === 0 || p.t < Math.min(...before),
        });
        before.push(p.t);
      }
    }
    ins.forEach((r, k) => {
      const t = runners[k]!.radio_finish_ms;
      if (t === null) return;
      classEvents.push({
        ...base(r),
        at_ms: r.start_time_ms! + t,
        kind: 'radio_finish',
        control_code: null,
        elapsed_ms: t,
        place: null,
        behind_ms: null,
        new_leader: false,
      });
    });
    classEvents.sort((a, b) => b.at_ms - a.at_ms);
    events.push(...classEvents.slice(0, MAX_EVENTS_PER_CLASS));
  }

  events.sort((a, b) => b.at_ms - a.at_ms);
  return { classes, events };
}
