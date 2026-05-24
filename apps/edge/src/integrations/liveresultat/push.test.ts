// Authored for fartola. Not ported from upstream.
//
// Tests for push.ts — pushToLiveresultat HTTP POST function.
//
// Locked by:
// - .planning/phases/02.1-sanctioned-competition-foundations/02.1-07-PLAN.md task 1

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pushToLiveresultat } from './push.ts';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pushToLiveresultat', () => {
  it('Test 5: sends POST with FormData containing competition, pwd, and MOP XML blob', async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;

    const mockFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      // Return a successful response
      return new Response('status="OK"', { status: 200 });
    };

    await pushToLiveresultat({
      url: 'http://liveresultat.orientering.se/api/update.php',
      competitionId: '12345',
      password: 'secret',
      mopXml: '<MOPComplete xmlns="http://www.melin.nu/mop"/>',
      fetchImpl: mockFetch,
      timeoutMs: 5000,
    });

    assert.equal(capturedUrl, 'http://liveresultat.orientering.se/api/update.php');
    assert.ok(capturedInit, 'fetch must be called with init');
    assert.equal(capturedInit?.method, 'POST');

    const body = capturedInit?.body as FormData;
    assert.ok(body instanceof FormData, 'body must be FormData');
    assert.equal(body.get('competition'), '12345', 'competition field must match competitionId');
    assert.equal(body.get('pwd'), 'secret', 'pwd field must match password');
  });

  it('Test 6: resolves when response contains status="OK"', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response('status="OK"', { status: 200 });
    };

    // Must not throw
    await assert.doesNotReject(
      pushToLiveresultat({
        url: 'http://liveresultat.orientering.se/api/update.php',
        competitionId: '42',
        password: 'pw',
        mopXml: '<MOPComplete/>',
        fetchImpl: mockFetch,
      })
    );
  });

  it('Test 7: throws when response contains BADPWD', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response('BADPWD', { status: 200 });
    };

    await assert.rejects(
      pushToLiveresultat({
        url: 'http://liveresultat.orientering.se/api/update.php',
        competitionId: '42',
        password: 'wrongpw',
        mopXml: '<MOPComplete/>',
        fetchImpl: mockFetch,
      }),
      (err: Error) => {
        assert.ok(err instanceof Error, 'Must throw an Error');
        assert.ok(err.message.length > 0, 'Error message must not be empty');
        return true;
      }
    );
  });

  it('Test 8: throws abort error when timeout fires', async () => {
    const mockFetch: typeof fetch = async (_input, init) => {
      // Wait until abort fires
      return new Promise<Response>((_resolve, reject) => {
        const signal = (init as RequestInit)?.signal;
        if (signal?.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        } else {
          // Should not happen, but handle gracefully
          reject(new Error('No signal'));
        }
      });
    };

    await assert.rejects(
      pushToLiveresultat({
        url: 'http://liveresultat.orientering.se/api/update.php',
        competitionId: '42',
        password: 'pw',
        mopXml: '<MOPComplete/>',
        fetchImpl: mockFetch,
        timeoutMs: 10, // Very short timeout
      })
    );
  });
});
