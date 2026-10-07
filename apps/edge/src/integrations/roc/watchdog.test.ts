// Authored for fartola. Not ported from upstream.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateRadioWatchdog } from './watchdog.ts';
import type { CardPunchIn, RadioPunchIn } from './watchdog.ts';

const MIN = 60_000;
const NOW = 12 * 3600 * 1000; // 12:00:00 on the wall clock
const at = (minutesAgo: number, secs = 0) => NOW - minutesAgo * MIN + secs * 1000;

const card = (code: number, n: number, wallMs: number): CardPunchIn => ({
  code,
  card: 9_000_000 + n,
  wallMs,
});
const radio = (code: number, n: number, wallMs: number, dateMismatch = false): RadioPunchIn => ({
  code,
  card: 9_000_000 + n,
  wallMs,
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
    const [c] = evaluateRadioWatchdog(radios, cards, { nowWallMs: NOW });
    assert.equal(c!.window_card_punches, 10);
    assert.equal(c!.window_matched, 7);
    assert.equal(c!.coverage, 0.7);
    assert.equal(c!.state, 'few');
    assert.equal(c!.received, 8);
  });

  test('a radio punch from another card at the same time is not a match', () => {
    const cards = [1, 2, 3, 4, 5].map((n) => card(78, n, at(5, n)));
    const radios = [1, 2, 3, 4, 5].map((n) => radio(78, n + 100, at(5, n)));
    const [c] = evaluateRadioWatchdog(radios, cards, { nowWallMs: NOW });
    assert.equal(c!.window_matched, 0);
  });

  test('full coverage is ok; punches older than the window are ignored', () => {
    const cards = [
      ...[1, 2, 3, 4, 5, 6].map((n) => card(78, n, at(3, n))),
      card(78, 50, at(40)), // outside M=20: unheard but not counted
    ];
    const radios = [1, 2, 3, 4, 5, 6].map((n) => radio(78, n, at(3, n)));
    const [c] = evaluateRadioWatchdog(radios, cards, { nowWallMs: NOW });
    assert.equal(c!.window_card_punches, 6);
    assert.equal(c!.coverage, 1);
    assert.equal(c!.state, 'ok');
  });

  test('a handful of card punches is too few to judge coverage', () => {
    const cards = [1, 2, 3].map((n) => card(78, n, at(5, n)));
    const [c] = evaluateRadioWatchdog([radio(78, 1, at(5, 1))], cards, { nowWallMs: NOW });
    assert.equal(c!.coverage, 1 / 3);
    assert.equal(c!.state, 'ok');
  });

  test('silent: nothing for 10 min while read-out cards passed after the last radio punch', () => {
    const radios = [radio(100, 1, at(30))];
    const cards = [card(100, 1, at(30)), card(100, 2, at(25)), card(100, 3, at(12))];
    const [c] = evaluateRadioWatchdog(radios, cards, { nowWallMs: NOW });
    assert.equal(c!.state, 'silent');
    assert.equal(c!.last_heard_ms, at(30));
  });

  test('not silent when only 9 minutes have passed', () => {
    const radios = [radio(100, 1, at(9))];
    const cards = [card(100, 2, at(5))];
    const [c] = evaluateRadioWatchdog(radios, cards, { nowWallMs: NOW });
    assert.equal(c!.state, 'ok');
  });

  test('a quiet control is not silent: no card punches since the last radio punch', () => {
    const radios = [radio(100, 1, at(45))];
    const cards = [card(100, 1, at(45))]; // was heard; nobody since
    const [c] = evaluateRadioWatchdog(radios, cards, { nowWallMs: NOW });
    assert.equal(c!.state, 'ok');
  });

  test('card punches older than an hour do not make a control silent', () => {
    const radios = [radio(100, 1, at(200))];
    const cards = [card(100, 2, at(90))];
    const [c] = evaluateRadioWatchdog(radios, cards, { nowWallMs: NOW });
    assert.equal(c!.state, 'ok');
  });

  test('date mismatch is counted per control, next to the state', () => {
    const radios = [
      radio(78, 1, at(2)),
      radio(78, 2, at(2, 5), true),
      radio(78, 3, at(2, 9), true),
      radio(100, 4, at(2)),
    ];
    const out = evaluateRadioWatchdog(radios, [], { nowWallMs: NOW });
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
    const [c] = evaluateRadioWatchdog(radios, cards, { nowWallMs: NOW });
    assert.equal(c!.window_card_punches, 5);
  });

  test('a control with no radio punches is not listed', () => {
    assert.deepEqual(evaluateRadioWatchdog([], [card(78, 1, at(2))], { nowWallMs: NOW }), []);
  });
});
