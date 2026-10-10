// Authored for fartola. Not ported from upstream.

import { describe, it, expect } from 'vitest';
import type { SpeakerClass, SpeakerRunner } from '@fartola/shared-types';
import { passedCounts, speakerGrid, speakerPanel } from './speaker.ts';

const NOW = 1_760_000_000_000;
const MIN = 60_000;

const runner = (over: Partial<SpeakerRunner> & { competitor_id: string }): SpeakerRunner => ({
  name: `Runner ${over.competitor_id}`,
  club: 'OK Test',
  start_ms: NOW - 30 * MIN,
  status: 'PEND',
  passings: [null, null],
  finish: null,
  radio_finish_ms: null,
  expected_finish_ms: null,
  ...over,
});

const split = (elapsedMin: number, place: number) => ({
  elapsed_ms: elapsedMin * MIN,
  place,
  behind_ms: 0,
});

const cls = (runners: SpeakerRunner[]): SpeakerClass => ({
  class_id: 'c1',
  class_name: 'H21',
  controls: [50, 60],
  runners,
});

describe('speakerGrid', () => {
  it.each([
    [1, 1, 1],
    [2, 2, 1],
    [3, 2, 2],
    [4, 2, 2],
    [5, 3, 2],
    [6, 3, 2],
    [9, 3, 3],
  ])('%i classes → %i×%i', (n, cols, rows) => {
    expect(speakerGrid(n)).toEqual({ cols, rows });
  });
});

describe('speakerPanel', () => {
  it('DNS, MP and not-started runners never become time rows', () => {
    const p = speakerPanel(
      cls([
        runner({ competitor_id: 'dns', status: 'DNS', start_ms: NOW - 40 * MIN }),
        runner({ competitor_id: 'mp', status: 'MP', passings: [split(10, 1), null] }),
        runner({ competitor_id: 'later', start_ms: NOW + 5 * MIN }),
        runner({ competitor_id: 'nodraw', start_ms: null }),
        runner({ competitor_id: 'running' }),
      ]),
      NOW
    );
    expect(p.rows).toEqual([]);
    expect(p.notStarted.map((r) => r.competitor_id)).toEqual(['later', 'nodraw']);
    expect(p.inForest).toBe(1);
    expect(p.out.map((g) => [g.status, g.runners.length])).toEqual([
      ['DNS', 1],
      ['MP', 1],
    ]);
  });

  it('rows: finished by place, then not read out, then by the furthest radio', () => {
    const p = speakerPanel(
      cls([
        runner({ competitor_id: 'r1', passings: [split(10, 2), null] }),
        runner({ competitor_id: 'r2', passings: [split(9, 1), split(20, 1)] }),
        runner({
          competitor_id: 'f2',
          status: 'OK',
          passings: [split(11, 3), split(22, 2)],
          finish: split(31, 2),
        }),
        runner({
          competitor_id: 'f1',
          status: 'OK',
          passings: [split(12, 4), split(23, 3)],
          finish: split(30, 1),
        }),
        runner({ competitor_id: 'rf', radio_finish_ms: 33 * MIN }),
      ]),
      NOW
    );
    expect(p.rows.map((r) => r.competitor_id)).toEqual(['f1', 'f2', 'rf', 'r2', 'r1']);
  });

  it('on the way in: past the last radio control, not finished; soonest first', () => {
    const p = speakerPanel(
      cls([
        runner({ competitor_id: 'early', passings: [split(9, 1), null] }),
        runner({
          competitor_id: 'b',
          passings: [split(10, 2), split(20, 2)],
          expected_finish_ms: NOW + 5 * MIN,
        }),
        runner({
          competitor_id: 'a',
          passings: [split(9, 1), split(19, 1)],
          expected_finish_ms: NOW + 2 * MIN,
        }),
        runner({ competitor_id: 'rf', passings: [split(9, 1), split(19, 1)], radio_finish_ms: 1 }),
      ]),
      NOW
    );
    expect(p.onWay.map((r) => r.competitor_id)).toEqual(['a', 'b']);
  });
});

describe('passedCounts', () => {
  it('counts the runners through each radio control and the finish', () => {
    const counts = passedCounts(
      cls([
        runner({ competitor_id: 'a', passings: [split(10, 2), null] }),
        runner({ competitor_id: 'b', passings: [split(9, 1), split(19, 1)] }),
        runner({ competitor_id: 'c', status: 'OK', finish: split(30, 1) }),
      ])
    );
    expect(counts).toEqual([2, 1, 1]);
  });
});
