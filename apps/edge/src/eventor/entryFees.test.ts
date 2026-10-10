// Authored for fartola. Not ported from upstream.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { classFees, fetchEventorClassFees, parseClassFeeIds, parseEntryFees } from './entryFees.ts';

// Synthetic, shaped like Eventor's responses (attributes, nesting and the
// percent late fee as seen on a real event in October 2026).
const FEES = `<?xml version="1.0" encoding="utf-8"?><EntryFeeList>
<EntryFee entryFeeType="adult" type="adult"><EntryFeeId>11</EntryFeeId><Name>Vuxen</Name><Amount currency="SEK">180</Amount><ValidToDate><Date>2026-09-30</Date><Clock>23:59:59</Clock></ValidToDate></EntryFee>
<EntryFee taxIncluded="N" valueOperator="percent" type="notSpecified"><EntryFeeId>12</EntryFeeId><Name>Efteranmälningsavgift</Name><Amount currency="SEK">50</Amount><ValidFromDate><Date>2026-09-28</Date><Clock>00:00:00</Clock></ValidFromDate></EntryFee>
<EntryFee entryFeeType="youth" type="youth"><EntryFeeId>13</EntryFeeId><Name>Ungdom</Name><Amount currency="SEK">90</Amount></EntryFee>
<EntryFee entryFeeType="adult" type="adult"><EntryFeeId>14</EntryFeeId><Name>Vuxen, öppen</Name><Amount currency="SEK">180</Amount><ToDateOfBirth><Date>2009-12-31</Date></ToDateOfBirth></EntryFee>
<EntryFee type="notSpecified"><EntryFeeId>15</EntryFeeId><Name>Ungdom, öppen</Name><Amount currency="SEK">90</Amount><FromDateOfBirth><Date>2010-01-01</Date></FromDateOfBirth></EntryFee>
</EntryFeeList>`;

const CLASSES = `<?xml version="1.0" encoding="utf-8"?><EventClassList>
<EventClass sequence="1"><EventClassId>1</EventClassId><Name>H21</Name><ClassType><ClassTypeId>17</ClassTypeId><Name>Åldersklasser</Name></ClassType><ClassEntryFee><EntryFeeId>11</EntryFeeId><Sequence>20</Sequence></ClassEntryFee><ClassEntryFee><EntryFeeId>12</EntryFeeId><Sequence>60</Sequence></ClassEntryFee></EventClass>
<EventClass sequence="2"><EventClassId>2</EventClassId><Name>D12</Name><ClassType><ClassTypeId>17</ClassTypeId><Name>Åldersklasser</Name></ClassType><ClassEntryFee><EntryFeeId>13</EntryFeeId><Sequence>30</Sequence></ClassEntryFee><ClassEntryFee><EntryFeeId>12</EntryFeeId><Sequence>60</Sequence></ClassEntryFee></EventClass>
<EventClass sequence="3"><EventClassId>3</EventClassId><Name>Gul 2,5</Name><ClassType><ClassTypeId>19</ClassTypeId><Name>Öppna klasser</Name></ClassType><ClassEntryFee><EntryFeeId>14</EntryFeeId><Sequence>40</Sequence></ClassEntryFee><ClassEntryFee><EntryFeeId>15</EntryFeeId><Sequence>50</Sequence></ClassEntryFee></EventClass>
<EventClass sequence="4"><EventClassId>4</EventClassId><Name>Utan avgift</Name></EventClass>
</EventClassList>`;

describe('Eventor class fees (SOFT TR 4.12.6)', () => {
  test('parseEntryFees: amount, percent, youth (type or FromDateOfBirth), valid from', () => {
    const f = parseEntryFees(FEES);
    assert.equal(f.size, 5);
    assert.deepEqual(f.get(11), { amount: 180, percent: false, youth: false, validFrom: null });
    assert.deepEqual(f.get(12), {
      amount: 50,
      percent: true,
      youth: false,
      validFrom: '2026-09-28',
    });
    assert.equal(f.get(13)?.youth, true);
    assert.equal(f.get(14)?.youth, false);
    assert.equal(f.get(15)?.youth, true);
  });

  test('parseClassFeeIds: class name → its EntryFeeIds', () => {
    assert.deepEqual(
      [...parseClassFeeIds(CLASSES)],
      [
        ['H21', [11, 12]],
        ['D12', [13, 12]],
        ['Gul 2,5', [14, 15]],
        ['Utan avgift', []],
      ]
    );
  });

  test('classFees: a later fixed fee is a late price, not part of the class fee', () => {
    const fee = (amount: number, validFrom: string | null) => ({
      amount,
      percent: false,
      youth: false,
      validFrom,
    });
    assert.deepEqual(classFees([fee(120, null), fee(180, '2026-10-01')]), {
      entryFee: 120,
      youthEntryFee: null,
      lateFeePct: null,
    });
  });

  test('fetchEventorClassFees: adult, youth and open classes with the percent late fee', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      urls.push(String(url));
      return new Response(String(url).includes('entryfees') ? FEES : CLASSES, { status: 200 });
    }) as typeof fetch;
    const fees = await fetchEventorClassFees({ apiKey: 'KEY', eventId: 4711, fetchImpl });
    assert.deepEqual(urls.sort(), [
      'https://eventor.orientering.se/api/entryfees/events/4711',
      'https://eventor.orientering.se/api/eventclasses?eventId=4711&includeEntryFees=true',
    ]);
    assert.deepEqual(fees.get('H21'), { entryFee: 180, youthEntryFee: null, lateFeePct: 50 });
    assert.deepEqual(fees.get('D12'), { entryFee: 90, youthEntryFee: null, lateFeePct: 50 });
    assert.deepEqual(fees.get('Gul 2,5'), { entryFee: 180, youthEntryFee: 90, lateFeePct: null });
    assert.deepEqual(fees.get('Utan avgift'), {
      entryFee: null,
      youthEntryFee: null,
      lateFeePct: null,
    });
  });
});
