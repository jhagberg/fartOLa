// Authored for fartola. Not ported from upstream.
//
// The demo's playback source on an invented day: one class, radio control
// 31 and finish unit 2. The board at T holds exactly what was known by T,
// however the clock got there.

import { describe, it, expect } from 'vitest';
import {
  boardAt,
  boardSource,
  createClock,
  demoMs,
  density,
  eventTimes,
  firstFinishMs,
  type SpeakerDemoData,
} from './playback.ts';

const H = 3600;
// Runner 0 and 1 have a drawn start; runner 2 starts on the start punch, so
// the start is known only when the card is read. Runner 3 never starts.
const data: SpeakerDemoData = {
  name: 'Testtävlingen',
  date: '2031-06-07',
  clock_offset_min: 120,
  radio_controls: [31],
  finish_codes: [2],
  radio_outages: [],
  clubs: ['OK Test', 'IF Prov'],
  classes: [
    { name: 'H21', controls: [31] },
    { name: 'D21', controls: [] },
  ],
  runners: [
    ['Runner A', 0, 0, 10 * H, 1, 10 * H + 2000, 'OK', 1800],
    ['Runner B', 1, 0, 10 * H + 120, 1, 10 * H + 2100, 'OK', 1800],
    ['Runner C', null, 0, 10 * H + 240, 0, 10 * H + 2400, 'OK', 1700],
    ['Runner D', 0, 0, 10 * H + 360, 1, 10 * H + 3000, 'DNS', null],
    ['Runner E', 0, 1, 10 * H, 1, 10 * H + 1500, 'MP', null],
  ],
  radio: [
    [10 * H + 905, 0, 31, 10 * H + 900],
    [10 * H + 1000, 2, 31, 10 * H + 240 + 700],
    [10 * H + 1025, 1, 31, 10 * H + 120 + 880],
    [10 * H + 1803, 0, 2, 10 * H + 1800],
  ],
};
const at = (s: number): number => demoMs(data, 10 * H + s);
const h21 = (tMs: number) => boardAt(data, tMs).classes.find((c) => c.class_name === 'H21')!;

describe('boardAt', () => {
  it('times are on the competition clock of the dataset', () => {
    expect(new Date(demoMs(data, 10 * H)).toISOString()).toBe('2031-06-07T08:00:00.000Z');
    expect(boardAt(data, at(0)).clock_offset_min).toBe(120);
  });

  it('a radio punch counts from the moment it was received, not before', () => {
    expect(h21(at(904)).runners[0]!.passings).toEqual([null]);
    expect(h21(at(905)).runners[0]!.passings[0]).toMatchObject({ elapsed_ms: 900_000, place: 1 });
    // Runner B's punch comes in later and is faster: both places follow.
    const later = h21(at(1025));
    expect(later.runners[1]!.passings[0]).toMatchObject({ elapsed_ms: 880_000, place: 1 });
    expect(later.runners[0]!.passings[0]!.place).toBe(2);
  });

  it('the finish punch comes first, the result when the card is read', () => {
    const punched = h21(at(1803)).runners[0]!;
    expect(punched).toMatchObject({ status: 'PEND', finish: null, radio_finish_ms: 1_800_000 });
    const read = h21(at(2000)).runners[0]!;
    expect(read.status).toBe('OK');
    expect(read.finish).toEqual({ elapsed_ms: 1_800_000, place: 1, behind_ms: 0 });
  });

  it('places count only the results known so far, and equal times share one', () => {
    const two = h21(at(2100));
    expect(two.runners.map((r) => r.finish?.place ?? null)).toEqual([1, 1, null, null]);
    const three = h21(at(2400));
    expect(three.runners.map((r) => r.finish?.place ?? null)).toEqual([2, 2, 1, null]);
    expect(three.runners[0]!.finish!.behind_ms).toBe(100_000);
  });

  it('a start read off the card is unknown until the read-out', () => {
    const before = h21(at(2399)).runners[2]!;
    expect(before.start_ms).toBeNull();
    expect(before.passings).toEqual([null]);
    const after = h21(at(2400)).runners[2]!;
    expect(after.start_ms).toBe(at(240));
    expect(after.passings[0]!.elapsed_ms).toBe(700_000);
  });

  it('a finish is never stamped later than the read-out that made it known', () => {
    // Runner A's card says 1800 s, but it is read 1700 s after the start.
    const early = structuredClone(data);
    early.runners[0]![5] = 10 * H + 1700;
    const board = boardAt(early, at(1700));
    const finish = board.events.find((e) => e.kind === 'finish' && e.competitor_id === '0')!;
    expect(finish.at_ms).toBe(at(1700));
    expect(finish.elapsed_ms).toBe(1_800_000);
  });

  it('a status shows when it was set', () => {
    expect(h21(at(2999)).runners[3]!.status).toBe('PEND');
    expect(h21(at(3000)).runners[3]!.status).toBe('DNS');
  });

  it('holds exactly the events up to T at every moment of the day', () => {
    const moments = eventTimes(data).flatMap((t) => [t - 1, t]);
    for (const tMs of moments) {
      const board = boardAt(data, tMs);
      const results = board.classes.flatMap((c) => c.runners).filter((r) => r.status !== 'PEND');
      expect(results.length).toBe(
        data.runners.filter((r) => demoMs(data, r[5] as number) <= tMs).length
      );
      // Radio: every punch received shows as a passing or a finish punch
      // (runner C's only once its start is known), and nothing else does.
      const shown = board.classes
        .flatMap((c) => c.runners)
        .reduce((n, r) => n + r.passings.filter(Boolean).length, 0);
      const received = data.radio.filter(
        (p) =>
          p[2] === 31 &&
          demoMs(data, p[0]!) <= tMs &&
          (p[1] !== 2 || demoMs(data, data.runners[2]![5] as number) <= tMs)
      );
      expect(shown).toBe(received.length);
      expect(board.events.every((e) => e.at_ms <= tMs)).toBe(true);
    }
  });
});

describe('playback clock', () => {
  const start = at(0);
  const end = at(3600);
  function fake() {
    let now = 0;
    const clock = createClock(start, end, () => now);
    return { clock, pass: (ms: number) => (now += ms) };
  }

  it('runs at the chosen speed and stands still while paused', () => {
    const { clock, pass } = fake();
    pass(5000);
    expect(clock.time()).toBe(start);
    clock.play();
    pass(1000);
    expect(clock.time()).toBe(start + 1000);
    clock.setSpeed(60);
    pass(1000);
    expect(clock.time()).toBe(start + 61_000);
    clock.pause();
    pass(60_000);
    expect(clock.time()).toBe(start + 61_000);
    expect(clock.playing).toBe(false);
  });

  it('stops at the end, and play starts over from there', () => {
    const { clock, pass } = fake();
    clock.setSpeed(60);
    clock.play();
    pass(10 * 60_000);
    expect(clock.time()).toBe(end);
    expect(clock.playing).toBe(false);
    clock.play();
    pass(1000);
    expect(clock.time()).toBe(start + 60_000);
  });

  it('pausing, changing speed and jumping back give the same board as playing straight', () => {
    const target = at(2050);
    const straight = fake();
    straight.clock.play();
    straight.pass(2_050_000);

    const { clock, pass } = fake();
    const source = boardSource(data);
    clock.setSpeed(10);
    clock.play();
    pass(250_000); // 2500 s in: past the target
    source(clock.time());
    clock.pause();
    pass(30_000);
    clock.seek(at(1000)); // back
    source(clock.time());
    clock.setSpeed(60);
    clock.play();
    pass(10_000); // to 1600 s
    clock.setSpeed(1);
    pass(450_000); // to 2050 s
    expect(clock.time()).toBe(target);
    expect(clock.time()).toBe(straight.clock.time());
    expect(source(clock.time())).toEqual(boardAt(data, target));
  });

  it('stays stopped after the end when the viewer jumps back', () => {
    const { clock, pass } = fake();
    clock.setSpeed(60);
    clock.play();
    pass(10 * 60_000);
    expect(clock.playing).toBe(false);
    clock.seek(at(100));
    pass(5000);
    expect(clock.playing).toBe(false);
    expect(clock.time()).toBe(at(100));
  });

  it('a jump outside the day lands on its edge', () => {
    const { clock } = fake();
    clock.seek(end + 1);
    expect(clock.time()).toBe(end);
    clock.seek(start - 1);
    expect(clock.time()).toBe(start);
  });
});

describe('timeline helpers', () => {
  it('the board source computes again only when something new is known', () => {
    const source = boardSource(data);
    const a = source(at(906));
    expect(source(at(999))).toBe(a);
    expect(source(at(1000))).not.toBe(a);
  });

  it('density counts the events in each part of the day', () => {
    const times = eventTimes(data);
    expect(times).toHaveLength(9);
    const bars = density(times, at(0), at(3000), 3);
    expect(bars).toEqual([1, 4, 4]);
  });

  it('the first finish is the first finish punch or read-out in the classes asked for', () => {
    expect(firstFinishMs(data, ['H21'])).toBe(at(1803));
    expect(firstFinishMs(data, ['D21'])).toBeNull();
  });
});
