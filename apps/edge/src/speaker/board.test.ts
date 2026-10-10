// Authored for fartola. Not ported from upstream.
//
// The speaker board: radio places per class, the finish, the expected
// finish and the events strip. Synthetic runners and card numbers only.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSpeakerBoard, type BoardInput, type BoardRunnerIn } from './board.ts';

const T0 = 1_760_000_000_000; // any epoch ms; all times are offsets from it
const MIN = 60_000;

function runner(over: Partial<BoardRunnerIn> & { id: string; card: number }): BoardRunnerIn {
  return {
    name: `Runner ${over.id}`,
    club: 'OK Test',
    class_id: 'c1',
    card_number: over.card,
    start_time_ms: T0,
    status: 'PEND',
    elapsed_time_ms: null,
    place: null,
    behind_leader_ms: null,
    finish_at_ms: null,
    ...over,
  };
}

function input(over: Partial<BoardInput> = {}): BoardInput {
  return {
    classes: [
      { id: 'c1', name: 'H21', course_id: 'k1' },
      { id: 'c2', name: 'D21', course_id: 'k2' },
    ],
    courses: [
      {
        id: 'k1',
        class_id: null,
        controls: [31, 50, 32, 60, 33].map((c, i) => ({ control_code: c, order_idx: i })),
      },
      {
        id: 'k2',
        class_id: null,
        controls: [60, 34, 50].map((c, i) => ({ control_code: c, order_idx: i })),
      },
    ],
    runners: [],
    radio: [],
    radioControls: [50, 60],
    finishCodes: [100],
    ...over,
  };
}

const punch = (card: number, code: number, afterMin: number) => ({
  card,
  code,
  timeMs: T0 + afterMin * MIN,
});

describe('speaker board', () => {
  test('radio controls follow each class course order', () => {
    const b = buildSpeakerBoard(input());
    assert.deepEqual(
      b.classes.map((c) => c.controls),
      [
        [50, 60],
        [60, 50],
      ]
    );
  });

  test('a class without timing has no radio controls', () => {
    const b = buildSpeakerBoard(
      input({
        classes: [{ id: 'c1', name: 'U10', course_id: 'k1', no_timing: true }],
        runners: [runner({ id: 'a', card: 1 })],
        radio: [punch(1, 50, 10)],
      })
    );
    assert.deepEqual(b.classes[0]!.controls, []);
    assert.deepEqual(b.events, []);
  });

  test('without a radio control list, the codes that received punches count', () => {
    const b = buildSpeakerBoard(
      input({
        radioControls: [],
        runners: [runner({ id: 'a', card: 1 })],
        radio: [punch(1, 32, 10), punch(1, 100, 30)],
      })
    );
    assert.deepEqual(b.classes[0]!.controls, [32]);
  });

  test('place and time behind at a radio control; ties share the place', () => {
    const b = buildSpeakerBoard(
      input({
        runners: [
          runner({ id: 'a', card: 1 }),
          runner({ id: 'b', card: 2 }),
          runner({ id: 'c', card: 3 }),
          runner({ id: 'd', card: 4, start_time_ms: T0 + 2 * MIN }),
        ],
        radio: [punch(1, 50, 12), punch(2, 50, 10), punch(3, 50, 12), punch(4, 50, 15)],
      })
    );
    const at50 = b.classes[0]!.runners.map((r) => r.passings[0]);
    assert.deepEqual(at50, [
      { elapsed_ms: 12 * MIN, place: 2, behind_ms: 2 * MIN },
      { elapsed_ms: 10 * MIN, place: 1, behind_ms: 0 },
      { elapsed_ms: 12 * MIN, place: 2, behind_ms: 2 * MIN },
      { elapsed_ms: 13 * MIN, place: 4, behind_ms: 3 * MIN },
    ]);
    assert.equal(b.classes[0]!.runners[0]!.passings[1], null);
  });

  test('a radio passing changes only its own class', () => {
    const base = input({
      runners: [
        runner({ id: 'a', card: 1 }),
        runner({ id: 'x', card: 9, class_id: 'c2' }),
        runner({ id: 'y', card: 8, class_id: 'c2' }),
      ],
      radio: [punch(9, 60, 8), punch(8, 60, 9)],
    });
    const before = buildSpeakerBoard(base);
    const after = buildSpeakerBoard({ ...base, radio: [...base.radio, punch(1, 50, 5)] });
    assert.deepEqual(after.classes[1], before.classes[1]);
    assert.notDeepEqual(after.classes[0], before.classes[0]);
  });

  test('duplicate rows count once; punches before the start are ignored', () => {
    const b = buildSpeakerBoard(
      input({
        runners: [runner({ id: 'a', card: 1, start_time_ms: T0 + 20 * MIN })],
        radio: [punch(1, 50, 10), punch(1, 50, 30), punch(1, 50, 30)],
      })
    );
    assert.equal(b.classes[0]!.runners[0]!.passings[0]!.elapsed_ms, 10 * MIN);
    assert.equal(b.events.length, 1);
  });

  test('DNS, MP and DNF runners get no passings and no events', () => {
    const b = buildSpeakerBoard(
      input({
        runners: [
          runner({ id: 'a', card: 1, status: 'MP' }),
          runner({ id: 'b', card: 2, status: 'DNS' }),
          runner({ id: 'c', card: 3 }),
        ],
        radio: [punch(1, 50, 8), punch(2, 50, 9), punch(3, 50, 10)],
      })
    );
    const [a, bb, c] = b.classes[0]!.runners;
    assert.deepEqual(a!.passings, [null, null]);
    assert.deepEqual(bb!.passings, [null, null]);
    assert.deepEqual(c!.passings[0], { elapsed_ms: 10 * MIN, place: 1, behind_ms: 0 });
    assert.deepEqual(
      b.events.map((e) => e.competitor_id),
      ['c']
    );
  });

  test('the finish comes from the read-out result; a finish radio punch only until then', () => {
    const b = buildSpeakerBoard(
      input({
        runners: [
          runner({
            id: 'a',
            card: 1,
            status: 'OK',
            elapsed_time_ms: 30 * MIN,
            place: 1,
            behind_leader_ms: 0,
            finish_at_ms: T0 + 30 * MIN,
          }),
          runner({ id: 'b', card: 2 }),
        ],
        radio: [punch(1, 100, 30), punch(2, 100, 33)],
      })
    );
    const [a, bb] = b.classes[0]!.runners;
    assert.deepEqual(a!.finish, { elapsed_ms: 30 * MIN, place: 1, behind_ms: 0 });
    assert.equal(a!.radio_finish_ms, null);
    assert.equal(bb!.finish, null);
    assert.equal(bb!.radio_finish_ms, 33 * MIN);
  });

  test('expected finish: last radio time plus the best leg to the finish, scaled by the runner speed', () => {
    // a: 50 at 10, finish 30 (leg 20). b: 50 at 15 → 1.5× a's pace → 15 + 30 = 45.
    const b = buildSpeakerBoard(
      input({
        runners: [
          runner({
            id: 'a',
            card: 1,
            status: 'OK',
            elapsed_time_ms: 30 * MIN,
            place: 1,
            behind_leader_ms: 0,
            finish_at_ms: T0 + 30 * MIN,
          }),
          runner({ id: 'b', card: 2 }),
          runner({ id: 'c', card: 3 }),
        ],
        radio: [punch(1, 50, 10), punch(2, 50, 15)],
      })
    );
    const [a, bb, c] = b.classes[0]!.runners;
    assert.equal(a!.expected_finish_ms, null);
    assert.equal(bb!.expected_finish_ms, T0 + 45 * MIN);
    assert.equal(c!.expected_finish_ms, null);
  });

  test('no expected finish while nobody has finished', () => {
    const b = buildSpeakerBoard(
      input({ runners: [runner({ id: 'a', card: 1 })], radio: [punch(1, 50, 10)] })
    );
    assert.equal(b.classes[0]!.runners[0]!.expected_finish_ms, null);
  });

  test('events: newest first, with the place when it happened and new leaders marked', () => {
    const b = buildSpeakerBoard(
      input({
        runners: [
          runner({ id: 'a', card: 1 }),
          runner({ id: 'b', card: 2, start_time_ms: T0 + 2 * MIN }),
          runner({ id: 'c', card: 3, start_time_ms: T0 + 4 * MIN }),
        ],
        // a 12:00 elapsed (first), b 11:00 (new leader), c 13:00 (third).
        radio: [punch(1, 50, 12), punch(2, 50, 13), punch(3, 50, 17)],
      })
    );
    assert.deepEqual(
      b.events.map((e) => [e.competitor_id, e.place, e.behind_ms, e.new_leader]),
      [
        ['c', 3, 2 * MIN, false],
        ['b', 1, 0, true],
        ['a', 1, 0, true],
      ]
    );
    assert.equal(b.events[0]!.control_code, 50);
    assert.equal(b.events[0]!.kind, 'radio');
  });

  test('a finish event and a finish radio event', () => {
    const b = buildSpeakerBoard(
      input({
        runners: [
          runner({
            id: 'a',
            card: 1,
            status: 'OK',
            elapsed_time_ms: 30 * MIN,
            place: 1,
            behind_leader_ms: 0,
            finish_at_ms: T0 + 30 * MIN,
          }),
          runner({ id: 'b', card: 2 }),
        ],
        radio: [punch(2, 100, 31)],
      })
    );
    assert.deepEqual(
      b.events.map((e) => [e.competitor_id, e.kind, e.control_code, e.place, e.new_leader]),
      [
        ['b', 'radio_finish', null, null, false],
        ['a', 'finish', null, 1, true],
      ]
    );
  });
});
