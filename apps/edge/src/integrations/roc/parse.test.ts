// Authored for fartola. Not ported from upstream.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { parseRocResponse } from './parse.ts';

describe('parseRocResponse', () => {
  test('parses CRLF-separated rows and ignores blank lines', () => {
    const body =
      '101;78;9000001;2026-10-04 10:00:01\r\n\r\n102;100;9000002;2026-10-04 10:00:05\r\n   \r\n';
    const { rows, malformed } = parseRocResponse(body);
    assert.equal(malformed, 0);
    assert.deepEqual(rows, [
      { id: 101, code: 78, card: 9000001, date: '2026-10-04', time: '10:00:01' },
      { id: 102, code: 100, card: 9000002, date: '2026-10-04', time: '10:00:05' },
    ]);
  });

  test('an empty body (the HTTP 500 case, or no new rows) gives no rows', () => {
    assert.deepEqual(parseRocResponse(''), { rows: [], malformed: 0 });
    assert.deepEqual(parseRocResponse('\r\n'), { rows: [], malformed: 0 });
  });

  test('counts malformed lines and keeps the good ones', () => {
    const { rows, malformed } = parseRocResponse(
      'garbage\n103;78;9000003;2026-10-04 10:01:00\n104;78;x;2026-10-04 10:01:00\n105;78;9000005;2026-10-04 25:00:00'
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, 103);
    assert.equal(malformed, 3);
  });
});
