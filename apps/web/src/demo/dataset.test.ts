// Authored for fartola. Not ported from upstream.
//
// The published demo dataset (speaker-demo.json): it loads, the classes
// shown from the start are in it, and it carries no card numbers or ids.
//
// The dataset comes from a real day, with invented names and clubs and
// moved times (fartOLa-tools/replay, speaker-demo). The generator refuses
// to write if a real club or time is left. The last test repeats that check
// here against the generator's private list of the real values; it runs
// only where FARTOLA_DEMO_AVOID points at that file, so not in CI. It
// reports counts, never the values.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { DEMO_CLASSES, demoData as data } from './dataset.ts';
import { boardAt, demoMs, eventTimes, firstFinishMs } from './playback.ts';

const className = (r: Array<string | number | null>): string => data.classes[r[2] as number]!.name;

describe('speaker demo dataset', () => {
  it('has the eight classes shown from the start, with runners and finishes', () => {
    for (const name of DEMO_CLASSES) {
      const runners = data.runners.filter((r) => className(r) === name);
      expect(runners.length, name).toBeGreaterThan(3);
      expect(
        runners.some((r) => r[6] === 'OK'),
        name
      ).toBe(true);
    }
    expect(firstFinishMs(data, DEMO_CLASSES)).not.toBeNull();
  });

  it('is well formed: one calendar day, known classes and clubs', () => {
    expect(data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const r of data.runners) {
      expect(r).toHaveLength(8);
      expect(typeof r[0]).toBe('string');
      expect(r[1] === null || data.clubs[r[1] as number] !== undefined).toBe(true);
      expect(data.classes[r[2] as number]).toBeDefined();
      expect(['OK', 'MP', 'DNF', 'DNS', 'DQ', 'MAX']).toContain(r[6]);
    }
    const seconds = [
      ...data.runners.flatMap((r) => [r[3] ?? 0, r[5]] as number[]),
      ...data.radio.flatMap((p) => [p[0]!, p[3]!]),
      ...data.radio_outages.flat(),
    ];
    expect(seconds.every((s) => Number.isInteger(s) && s >= 0 && s < 86_400)).toBe(true);
    expect(data.radio.every((p) => data.runners[p[1]!] !== undefined)).toBe(true);
  });

  it('carries only what the board needs: no card numbers, ids or birth years', () => {
    expect(Object.keys(data).sort()).toEqual(
      [
        'classes',
        'clock_offset_min',
        'clubs',
        'date',
        'finish_codes',
        'name',
        'radio',
        'radio_controls',
        'radio_outages',
        'runners',
      ].sort()
    );
    // No number in a runner row is large enough to be an SI card.
    const numbers = data.runners.flatMap((r) => r.filter((v) => typeof v === 'number'));
    expect(Math.max(...numbers)).toBeLessThan(86_400);
  });

  it('gives a full board at the end of the day', () => {
    const board = boardAt(data, eventTimes(data).at(-1)!);
    expect(board.classes).toHaveLength(data.classes.length);
    const finished = board.classes.flatMap((c) => c.runners).filter((r) => r.finish !== null);
    expect(finished.length).toBe(data.runners.filter((r) => r[7] !== null).length);
  });

  const avoidPath = process.env['FARTOLA_DEMO_AVOID'];
  it.skipIf(!avoidPath)('holds no real club, running time, finish time or radio time', () => {
    const avoid = JSON.parse(readFileSync(avoidPath!, 'utf-8')) as {
      event: string;
      date: string;
      clubs: string[];
      times: Record<string, number[]>;
      finishes: Record<string, number[]>;
      splits: Record<string, number[]>;
    };
    const words = new Set(
      [data.name, data.date, ...data.clubs, ...data.runners.map((r) => r[0] as string)].map((s) =>
        s.toLowerCase()
      )
    );
    const real = (list: number[] | undefined, v: number): boolean => list?.includes(v) ?? false;
    const found = {
      event: Number(words.has(avoid.event.toLowerCase())) + Number(words.has(avoid.date)),
      clubs: avoid.clubs.filter((c) => words.has(c.toLowerCase())).length,
      runningTimes: data.runners.filter(
        (r) => r[7] !== null && real(avoid.times[className(r)], r[7] as number)
      ).length,
      finishTimes: data.runners.filter(
        (r) =>
          r[7] !== null &&
          r[3] !== null &&
          real(avoid.finishes[className(r)], (r[3] as number) + (r[7] as number))
      ).length,
      radioTimes: data.radio.filter(([, runner, code, time]) => {
        const r = data.runners[runner!]!;
        if (r[3] === null) return false;
        const elapsed = time! - (r[3] as number);
        return data.finish_codes.includes(code!)
          ? real(avoid.times[className(r)], elapsed) || real(avoid.finishes[className(r)], time!)
          : real(avoid.splits[`${className(r)}:${code}`], elapsed);
      }).length,
    };
    expect(avoid.clubs.length).toBeGreaterThan(0);
    expect(found).toEqual({ event: 0, clubs: 0, runningTimes: 0, finishTimes: 0, radioTimes: 0 });
    expect(demoMs(data, 0)).not.toBe(Date.parse(`${avoid.date}T00:00:00Z`));
  });
});
