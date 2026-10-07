// Authored for fartola. Not ported from upstream.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import { fetchEventorClassTypes, parseEventClassTypes } from './eventClasses.ts';

const XML = `<?xml version="1.0" encoding="utf-8"?>
<EventClassList>
  <EventClass><EventClassId>1</EventClassId><Name>D21</Name><ClassTypeId>17</ClassTypeId></EventClass>
  <EventClass><EventClassId>2</EventClassId><Name>D21 Kort</Name><ClassTypeId>17</ClassTypeId></EventClass>
  <EventClass><EventClassId>3</EventClassId><Name>Gul 2,5 &amp; mer</Name><ClassTypeId>19</ClassTypeId></EventClass>
</EventClassList>`;

describe('Eventor event class types (SOFT TR 3.4.2)', () => {
  test('parseEventClassTypes: a real Eventor response (ClassTypeId nested in ClassType)', () => {
    const real = fs.readFileSync(
      new URL('./__fixtures__/eventclasses.xml', import.meta.url),
      'utf8'
    );
    const types = parseEventClassTypes(real);
    assert.equal(types.size, 44);
    assert.equal(types.get('D21 Kort'), 17);
    assert.equal(types.get('H65'), 17);
    assert.equal(types.get('Inskolning 2,0'), 19);
    assert.equal(types.get('Blå 3,0'), 19);
  });

  test('parseEventClassTypes: class name → ClassTypeId', () => {
    assert.deepEqual(
      [...parseEventClassTypes(XML)],
      [
        ['D21', 17],
        ['D21 Kort', 17],
        ['Gul 2,5 & mer', 19],
      ]
    );
  });

  test('fetchEventorClassTypes: GET eventclasses?eventId=N with the ApiKey header', async () => {
    let seen: { url: string; key: string | null } | null = null;
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      seen = { url: String(url), key: new Headers(init?.headers).get('ApiKey') };
      return new Response(XML, { status: 200 });
    }) as typeof fetch;
    const types = await fetchEventorClassTypes({ apiKey: 'KEY', eventId: 4711, fetchImpl });
    assert.deepEqual(seen, {
      url: 'https://eventor.orientering.se/api/eventclasses?eventId=4711',
      key: 'KEY',
    });
    assert.equal(types.get('D21 Kort'), 17);
  });
});
