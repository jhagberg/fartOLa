// Authored for fartola. Not ported from upstream.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { kindConfirmed, pursuitBanned, suggestClassKind } from './classKind.ts';

const asTuple = (name: string, type: number | null = null) => {
  const s = suggestClassKind(name, type);
  return s === null ? null : [s.kind, s.ageClass, s.source];
};

describe('suggestClassKind (SOFT TR 3.4.6, TR 3.4.9)', () => {
  test('SOFT TR 3.4.2: SOFT class names get their category; an unknown name gets none', () => {
    const cases: Array<[string, unknown]> = [
      ['D10', ['ungdom', 10, 'name']],
      ['H 12', ['ungdom', 12, 'name']],
      ['H12K', ['ungdom', 12, 'name']],
      ['D/H12', ['ungdom', 12, 'name']],
      ['H12-14', ['ungdom', 12, 'name']],
      ['D16', ['ungdom', 16, 'name']],
      ['H18', ['junior', 18, 'name']],
      ['D20', ['junior', 20, 'name']],
      ['H21', ['senior', 21, 'name']],
      ['D21 Kort', ['senior', 21, 'name']],
      ['H35', ['veteran', 35, 'name']],
      ['D80', ['veteran', 80, 'name']],
      ['H21 Elit', ['elit', 21, 'name']],
      ['D18 Elit', ['elit', 18, 'name']],
      ['D20 elit', ['elit', 20, 'name']],
      ['Inskolning 2,0', ['inskolning', null, 'name']],
      ['Vit 2,0', ['oppen', null, 'name']],
      ['Gul 2,5', ['oppen', null, 'name']],
      ['Orange 5,0', ['oppen', null, 'name']],
      ['Blå 3,0', ['oppen', null, 'name']],
      ['Svart 7,0', ['oppen', null, 'name']],
      ['Öppen 1', ['oppen', null, 'name']],
      ['H19', null],
      ['H120', null],
      ['U12', null],
      ['Elitserie', null],
      ['Motion kort', null],
      ['Lilla banan', null],
    ];
    for (const [name, want] of cases) assert.deepEqual(asTuple(name), want, name);
  });

  test("SOFT TR 3.4.2: Eventor's ClassTypeId wins over the name (17 åldersklass, 19 öppen klass)", () => {
    assert.deepEqual(asTuple('D21 Kort', 17), ['senior', 21, 'eventor']);
    assert.deepEqual(asTuple('H21 Elit', 17), ['elit', 21, 'eventor']);
    assert.deepEqual(asTuple('Lilla banan', 19), ['oppen', null, 'eventor']);
    assert.deepEqual(asTuple('Inskolning', 19), ['inskolning', null, 'eventor']);
    assert.deepEqual(asTuple('H21', 19), ['oppen', null, 'eventor']);
    assert.equal(asTuple('Lilla banan', 17), null, 'an age class whose age cannot be read');
    assert.deepEqual(asTuple('H21', 99), ['senior', 21, 'name'], 'an unknown type id is ignored');
  });

  test('a kind guessed from the name is not confirmed; Eventor and the operator confirm', () => {
    const c = (
      classKind: 'oppen' | null,
      classKindSource: 'eventor' | 'name' | 'operator' | null
    ) => kindConfirmed({ classKind, classKindSource });
    assert.equal(c('oppen', 'name'), false);
    assert.equal(c('oppen', 'eventor'), true);
    assert.equal(c('oppen', 'operator'), true);
    assert.equal(c(null, null), false);
  });

  test('SOFT TR 7.4.1: pursuit banned in inskolning and D/H10–12 by stored kind and age', () => {
    assert.equal(pursuitBanned('inskolning', null), true);
    assert.equal(pursuitBanned('ungdom', 10), true);
    assert.equal(pursuitBanned('ungdom', 12), true);
    assert.equal(pursuitBanned('ungdom', 14), false);
    assert.equal(pursuitBanned('oppen', null), false);
    assert.equal(pursuitBanned('senior', 21), false);
  });
});
