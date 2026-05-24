// Authored for fartola. Not ported from upstream.
//
// TDD tests for pushToEventor (plan 02.1-08 task 1).
// RED phase — written before push.ts exists.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pushToEventor } from './push.ts';

// Minimal XML payloads used across tests.
const RESULT_XML =
  '<?xml version="1.0"?><ResultList xmlns="http://www.orienteering.org/datastandard/3.0"/>';
const START_XML =
  '<?xml version="1.0"?><StartList xmlns="http://www.orienteering.org/datastandard/3.0"/>';

const RESULT_OK_RESPONSE = `<?xml version="1.0" encoding="utf-8"?>
<ImportResultListResult>
  <ResultListUrl>https://eventor.orientering.se/Events/ResultList/12345</ResultListUrl>
</ImportResultListResult>`;

const START_OK_RESPONSE = `<?xml version="1.0" encoding="utf-8"?>
<ImportStartListResult>
  <StartListUrl>https://eventor.orientering.se/Events/StartList/12345</StartListUrl>
</ImportStartListResult>`;

// Build a mock fetch that returns the given status + body.
function makeFetch(status: number, body: string): typeof fetch {
  return async () => {
    return new Response(body, {
      status,
      headers: { 'content-type': 'application/xml' },
    });
  };
}

// Capture request details from the mock fetch.
interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

function makeCapturingFetch(
  status: number,
  body: string
): { fetch: typeof fetch; captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const [k, v] of Object.entries(h)) {
        headers[k.toLowerCase()] = v;
      }
    }
    const rawBody = init?.body;
    let bodyBytes = new Uint8Array();
    if (rawBody instanceof Uint8Array) {
      bodyBytes = rawBody;
    } else if (rawBody instanceof ArrayBuffer) {
      bodyBytes = new Uint8Array(rawBody);
    } else if (typeof rawBody === 'string') {
      bodyBytes = new TextEncoder().encode(rawBody);
    }
    captured.push({
      url: url as string,
      method: init?.method ?? 'GET',
      headers,
      body: bodyBytes,
    });
    return new Response(body, {
      status,
      headers: { 'content-type': 'application/xml' },
    });
  };
  return { fetch: fetchFn, captured };
}

describe('eventor push', () => {
  it('Test 1: sends POST to correct URL with ApiKey header and PKZIP-archived body', async () => {
    const { fetch: mockFetch, captured } = makeCapturingFetch(200, RESULT_OK_RESPONSE);

    await pushToEventor({
      apiKey: 'TEST-KEY-123',
      xmlBody: RESULT_XML,
      endpoint: 'import/resultlist',
      fetchImpl: mockFetch,
      baseUrl: 'https://eventor.orientering.se/api/',
    });

    assert.equal(captured.length, 1);
    const req = captured[0]!;

    // Correct URL.
    assert.equal(req.url, 'https://eventor.orientering.se/api/import/resultlist');
    assert.equal(req.method, 'POST');

    // ApiKey header present.
    assert.equal(req.headers['apikey'], 'TEST-KEY-123');

    // Content-Type is application/zip.
    assert.equal(req.headers['content-type'], 'application/zip');

    // Body starts with PKZIP magic bytes 50 4b 03 04.
    assert.equal(req.body[0], 0x50);
    assert.equal(req.body[1], 0x4b);
    assert.equal(req.body[2], 0x03);
    assert.equal(req.body[3], 0x04);
  });

  it('Test 2: parses ResultListUrl from success response XML', async () => {
    const mockFetch = makeFetch(200, RESULT_OK_RESPONSE);
    const result = await pushToEventor({
      apiKey: 'KEY',
      xmlBody: RESULT_XML,
      endpoint: 'import/resultlist',
      fetchImpl: mockFetch,
      baseUrl: 'https://eventor.orientering.se/api/',
    });
    assert.equal(result.url, 'https://eventor.orientering.se/Events/ResultList/12345');
  });

  it('Test 3: parses StartListUrl from success response XML', async () => {
    const mockFetch = makeFetch(200, START_OK_RESPONSE);
    const result = await pushToEventor({
      apiKey: 'KEY',
      xmlBody: START_XML,
      endpoint: 'import/startlist',
      fetchImpl: mockFetch,
      baseUrl: 'https://eventor.orientering.se/api/',
    });
    assert.equal(result.url, 'https://eventor.orientering.se/Events/StartList/12345');
  });

  it('Test 4: throws on HTTP 403 (invalid API key)', async () => {
    const mockFetch = makeFetch(403, '<Error>Unauthorized</Error>');
    await assert.rejects(
      () =>
        pushToEventor({
          apiKey: 'BAD-KEY',
          xmlBody: RESULT_XML,
          endpoint: 'import/resultlist',
          fetchImpl: mockFetch,
          baseUrl: 'https://eventor.orientering.se/api/',
        }),
      /403/
    );
  });

  it('Test 5: throws on timeout', async () => {
    // A fetch that never resolves — the timeout fires first.
    const neverFetch: typeof fetch = () => new Promise(() => undefined);
    await assert.rejects(
      () =>
        pushToEventor({
          apiKey: 'KEY',
          xmlBody: RESULT_XML,
          endpoint: 'import/resultlist',
          fetchImpl: neverFetch,
          baseUrl: 'https://eventor.orientering.se/api/',
          timeoutMs: 50, // Very short timeout for the test.
        }),
      /timeout|aborted/i
    );
  });

  it('Test 9: retries on 502 twice then succeeds on 200', async () => {
    let callCount = 0;
    const retryFetch: typeof fetch = async () => {
      callCount += 1;
      if (callCount <= 2) {
        return new Response('<Error>Bad Gateway</Error>', {
          status: 502,
          headers: { 'content-type': 'application/xml' },
        });
      }
      return new Response(RESULT_OK_RESPONSE, {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      });
    };

    const result = await pushToEventor({
      apiKey: 'KEY',
      xmlBody: RESULT_XML,
      endpoint: 'import/resultlist',
      fetchImpl: retryFetch,
      baseUrl: 'https://eventor.orientering.se/api/',
      // Minimal delays so the test doesn't take seconds.
      retryDelaysMs: [10, 10, 10],
    });

    assert.equal(callCount, 3);
    assert.equal(result.url, 'https://eventor.orientering.se/Events/ResultList/12345');
  });

  it('Test 10: throws immediately on 403 without retry', async () => {
    let callCount = 0;
    const noRetryFetch: typeof fetch = async () => {
      callCount += 1;
      return new Response('<Error>Unauthorized</Error>', {
        status: 403,
        headers: { 'content-type': 'application/xml' },
      });
    };

    await assert.rejects(
      () =>
        pushToEventor({
          apiKey: 'BAD-KEY',
          xmlBody: RESULT_XML,
          endpoint: 'import/resultlist',
          fetchImpl: noRetryFetch,
          baseUrl: 'https://eventor.orientering.se/api/',
          retryDelaysMs: [10, 10, 10],
        }),
      /403/
    );

    // Should have been called exactly once — no retries.
    assert.equal(callCount, 1);
  });
});
