// Authored for fartola. Not ported from upstream.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { softStatus, SOFT_STATUS_SV } from './index.ts';

const label = (...args: Parameters<typeof softStatus>): string =>
  SOFT_STATUS_SV[softStatus(...args)];

describe('softStatus', () => {
  test('SOFT TA till TR 7.8.2: MP, DNF and MAX → "Ej godkänd", DQ → "Diskad", DNS → "Ej start"', () => {
    assert.equal(label('MP'), 'Ej godkänd');
    assert.equal(label('DNF'), 'Ej godkänd');
    assert.equal(label('MAX'), 'Ej godkänd');
    assert.equal(label('DQ'), 'Diskad');
    assert.equal(label('DNS'), 'Ej start');
    assert.equal(label('OK'), 'Godkänd');
    assert.equal(label('CANCEL'), 'Återbud');
  });

  test('SOFT TA till TR 7.8.2: a runner never read out is "Ej utläst" live and "Ej start" once final', () => {
    assert.equal(label('PEND'), 'Ej utläst');
    assert.equal(label('PEND', { final: false }), 'Ej utläst');
    assert.equal(label('PEND', { final: true }), 'Ej start');
  });

  test('SOFT TR 4.21.3: OK in a class without timing → "Deltagit"', () => {
    assert.equal(label('OK', { noTiming: true }), 'Deltagit');
    // Only OK becomes Deltagit; the other statuses keep their names.
    assert.equal(label('MP', { noTiming: true }), 'Ej godkänd');
  });
});
