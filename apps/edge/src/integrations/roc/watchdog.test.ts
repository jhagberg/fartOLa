// Authored for fartola. Not ported from upstream.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateRadioWatchdog } from './watchdog.ts';
import type { CardPunchIn, RadioPunchIn } from './watchdog.ts';

const MIN = 60_000;
const NOW = 12 * 3600 * 1000; // 12:00:00 on the competition clock
const at = (minutesAgo: number, secs = 0) => NOW - minutesAgo * MIN + secs * 1000;

const card = (code: number, n: number, wallMs: number, siac = false): CardPunchIn => ({
  code,
  card: (siac ? 8_000_000 : 9_000_000) + n,
  timeMs: wallMs,
  siac,
});
/** delayMs: how long after the punch we received it (0 = at once). */
const radio = (
  code: number,
  n: number,
  wallMs: number,
  dateMismatch = false,
  delayMs = 0,
  siac = false
): RadioPunchIn => ({
  code,
  card: (siac ? 8_000_000 : 9_000_000) + n,
  timeMs: wallMs,
  receivedMs: wallMs + delayMs,
  delayMs,
  dateMismatch,
});

describe('evaluateRadioWatchdog', () => {
  test('coverage: share of card punches in the window with a radio punch within ±2 s', () => {
    const cards = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => card(78, n, at(15, n)));
    // 7 of 10 heard (one 2 s late = still a match; one 3 s late = no match).
    const radios = [
      ...[1, 2, 3, 4, 5].map((n) => radio(78, n, at(15, n))),
      radio(78, 6, at(15, 6 + 2)),
      radio(78, 7, at(15, 7 - 2)),
      radio(78, 8, at(15, 8 + 3)),
    ];
    const [c] = evaluateRadioWatchdog(radios, cards, { nowMs: NOW });
    assert.equal(c!.window_card_punches, 10);
    assert.equal(c!.window_matched, 7);
    assert.equal(c!.coverage, 0.7);
    assert.equal(c!.state, 'few');
    assert.equal(c!.received, 8);
  });

  test('a radio punch from another card at the same time is not a match', () => {
    const cards = [1, 2, 3, 4, 5].map((n) => card(78, n, at(5, n)));
    const radios = [1, 2, 3, 4, 5].map((n) => radio(78, n + 100, at(5, n)));
    const [c] = evaluateRadioWatchdog(radios, cards, { nowMs: NOW });
    assert.equal(c!.window_matched, 0);
  });

  test('full coverage is ok; punches older than the window are ignored', () => {
    const cards = [
      ...[1, 2, 3, 4, 5, 6].map((n) => card(78, n, at(3, n))),
      card(78, 50, at(40)), // outside M=20: unheard but not counted
    ];
    const radios = [1, 2, 3, 4, 5, 6].map((n) => radio(78, n, at(3, n)));
    const [c] = evaluateRadioWatchdog(radios, cards, { nowMs: NOW });
    assert.equal(c!.window_card_punches, 6);
    assert.equal(c!.coverage, 1);
    assert.equal(c!.state, 'ok');
  });

  test('a handful of card punches is too few to judge coverage', () => {
    const cards = [1, 2, 3].map((n) => card(78, n, at(5, n)));
    const [c] = evaluateRadioWatchdog([radio(78, 1, at(5, 1))], cards, {
      nowMs: NOW,
    });
    assert.equal(c!.coverage, 1 / 3);
    assert.equal(c!.state, 'ok');
  });

  test('silent: nothing for 10 min while read-out cards passed after the last radio punch', () => {
    const radios = [radio(100, 1, at(30))];
    const cards = [card(100, 1, at(30)), card(100, 2, at(25)), card(100, 3, at(12))];
    const [c] = evaluateRadioWatchdog(radios, cards, { nowMs: NOW });
    assert.equal(c!.state, 'silent');
    assert.equal(c!.last_heard_ms, at(30));
  });

  test('not silent when only 9 minutes have passed', () => {
    const radios = [radio(100, 1, at(9))];
    const cards = [card(100, 2, at(5))];
    const [c] = evaluateRadioWatchdog(radios, cards, { nowMs: NOW });
    assert.equal(c!.state, 'ok');
  });

  test('a quiet control is not silent: no card punches since the last radio punch', () => {
    const radios = [radio(100, 1, at(45))];
    const cards = [card(100, 1, at(45))]; // was heard; nobody since
    const [c] = evaluateRadioWatchdog(radios, cards, { nowMs: NOW });
    assert.equal(c!.state, 'ok');
  });

  test('card punches older than an hour do not make a control silent', () => {
    const radios = [radio(100, 1, at(200))];
    const cards = [card(100, 2, at(90))];
    const [c] = evaluateRadioWatchdog(radios, cards, { nowMs: NOW });
    assert.equal(c!.state, 'ok');
  });

  test('date mismatch is counted per control, next to the state', () => {
    const radios = [
      radio(78, 1, at(2)),
      radio(78, 2, at(2, 5), true),
      radio(78, 3, at(2, 9), true),
      radio(100, 4, at(2)),
    ];
    const out = evaluateRadioWatchdog(radios, [], { nowMs: NOW });
    assert.deepEqual(
      out.map((c) => [c.control_code, c.date_mismatch_count, c.state]),
      [
        [78, 2, 'ok'],
        [100, 0, 'ok'],
      ]
    );
  });

  test('the same card read twice counts once', () => {
    const cards = [1, 2, 3, 4, 5].flatMap((n) => [card(78, n, at(5, n)), card(78, n, at(5, n))]);
    const radios = [1, 2, 3, 4, 5].map((n) => radio(78, n, at(5, n)));
    const [c] = evaluateRadioWatchdog(radios, cards, { nowMs: NOW });
    assert.equal(c!.window_card_punches, 5);
  });

  test('a control with no radio punches is not listed', () => {
    assert.deepEqual(evaluateRadioWatchdog([], [card(78, 1, at(2))], { nowMs: NOW }), []);
  });

  test('last heard is when we received the punch: a late backlog does not hide silence', () => {
    // Punches from 40 min ago, delivered 35 min late = received 5 min ago: alive.
    const alive = evaluateRadioWatchdog([radio(100, 1, at(40), false, 35 * MIN)], [], {
      nowMs: NOW,
    });
    assert.equal(alive[0]!.last_heard_ms, at(5));
    // Same punch time, received 25 min ago, runners since: silent.
    const silent = evaluateRadioWatchdog(
      [radio(100, 1, at(40), false, 15 * MIN)],
      [card(100, 2, at(8))],
      { nowMs: NOW }
    );
    assert.equal(silent[0]!.last_heard_ms, at(25));
    assert.equal(silent[0]!.state, 'silent');
  });

  test('median delivery delay over the window shows a backlog or a wrong sender clock', () => {
    const radios = [
      radio(78, 1, at(10), false, 1000),
      radio(78, 2, at(9), false, 3000),
      radio(78, 3, at(8), false, 90_000),
      radio(78, 4, at(60), false, 500_000), // outside the window
    ];
    const [c] = evaluateRadioWatchdog(radios, [], { nowMs: NOW });
    assert.equal(c!.median_delay_ms, 3000);
    const none = evaluateRadioWatchdog([radio(78, 4, at(60))], [], { nowMs: NOW });
    assert.equal(none[0]!.median_delay_ms, null);
  });

  test('a listed control with no radio punch is silent once card punches at it exist', () => {
    const out = evaluateRadioWatchdog(
      [radio(78, 1, at(2))],
      [card(52, 1, at(20)), card(52, 2, at(5))],
      {
        nowMs: NOW,
        expectedCodes: [52, 78],
      }
    );
    const c52 = out.find((c) => c.control_code === 52)!;
    assert.equal(c52.state, 'silent');
    assert.equal(c52.received, 0);
    assert.equal(c52.last_heard_ms, null);
    assert.equal(c52.listed, true);
    assert.equal(out.find((c) => c.control_code === 78)!.listed, true);
  });

  test('a listed control nobody has passed is shown, not silent; unlisted senders still show', () => {
    const out = evaluateRadioWatchdog([radio(87, 1, at(2))], [], {
      nowMs: NOW,
      expectedCodes: [52],
    });
    assert.deepEqual(
      out.map((c) => [c.control_code, c.state, c.listed]),
      [
        [52, 'ok', true],
        [87, 'ok', false],
      ]
    );
  });

  test('SIAC coverage far below the others is flagged', () => {
    const cards = [
      ...[1, 2, 3, 4, 5, 6].map((n) => card(2, n, at(10, n), false)),
      ...[1, 2, 3, 4, 5, 6].map((n) => card(2, n, at(10, n + 20), true)),
    ];
    // All ordinary cards forwarded, one of six SIAC.
    const radios = [
      ...[1, 2, 3, 4, 5, 6].map((n) => radio(2, n, at(10, n))),
      radio(2, 1, at(10, 21), false, 0, true),
    ];
    const [c] = evaluateRadioWatchdog(radios, cards, { nowMs: NOW });
    assert.equal(c!.other_card_punches, 6);
    assert.equal(c!.other_matched, 6);
    assert.equal(c!.siac_card_punches, 6);
    assert.equal(c!.siac_matched, 1);
    assert.equal(c!.siac_problem, true);
  });

  test('no SIAC flag when both are poor, or with too few SIAC cards', () => {
    const mk = (siacCount: number, otherHeard: number) => {
      const cards = [
        ...[1, 2, 3, 4, 5, 6].map((n) => card(2, n, at(10, n))),
        ...Array.from({ length: siacCount }, (_, i) => card(2, i + 1, at(10, i + 20), true)),
      ];
      const radios = [1, 2, 3, 4, 5, 6].slice(0, otherHeard).map((n) => radio(2, n, at(10, n)));
      return evaluateRadioWatchdog(radios, cards, { nowMs: NOW })[0]!;
    };
    assert.equal(mk(6, 2).siac_problem, false); // others poor too
    assert.equal(mk(3, 6).siac_problem, false); // only 3 SIAC cards
  });
});
