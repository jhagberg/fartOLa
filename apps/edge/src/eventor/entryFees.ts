// Authored for fartola. Not ported from upstream.
//
// Class fees from Eventor (SOFT TR 4.12.6, TR 4.12.9). Eventor keeps the
// fees apart from the classes: GET entryfees/events/{eventId} lists every
// <EntryFee> (Amount, valueOperator "fixed" or "percent", entryFeeType
// adult / youth / elite, ValidFromDate, birth-date limits), and GET
// eventclasses?eventId=N&includeEntryFees=true gives each <EventClass> its
// <ClassEntryFee><EntryFeeId> references (Eventor's API schema at
// eventor.orientering.se/api/schema; seen on a real event in October 2026:
// adult and youth fixed fees, an open class split on FromDateOfBirth /
// ToDateOfBirth, and the late fee as "percent" 50).
//
// A class gets: entry_fee = its ordinary fixed fees summed (the adult ones
// when it has both adult and youth); youth_entry_fee = the youth ones when
// it has both, else null; late_fee_pct = its percent fees summed. Ordinary
// fees are the fixed fees of the earliest validity period (a later fixed
// fee is a late price, not a second fee).

import { eventorGet, first, unescapeXml, type FetchEventorClassTypesOpts } from './eventClasses.ts';

export interface EventorFee {
  id: number;
  amount: number;
  percent: boolean;
  youth: boolean;
  /** ValidFromDate/Date ('YYYY-MM-DD'); null = from the start. */
  validFrom: string | null;
}

export interface EventorClassFees {
  entryFee: number | null;
  youthEntryFee: number | null;
  lateFeePct: number | null;
  /** The EntryFeeId behind each amount, for Fee/Id in the ResultList;
   * null when the amount sums several Eventor fees. */
  entryFeeId: number | null;
  youthFeeId: number | null;
  lateFeeId: number | null;
}

const attr = (open: string, name: string) =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(open)?.[1] ?? null;

/** EntryFeeId → fee, from an EntryFeeList document. */
export function parseEntryFees(xml: string): Map<number, EventorFee> {
  const out = new Map<number, EventorFee>();
  for (const m of xml.matchAll(/<EntryFee\b([^>]*)>([\s\S]*?)<\/EntryFee>/g)) {
    const [, open, body] = m as unknown as [string, string, string];
    const id = Number(first(body, 'EntryFeeId'));
    const amount = Number(first(body, 'Amount'));
    if (!Number.isInteger(id) || !Number.isFinite(amount)) continue;
    const type = attr(open, 'entryFeeType') ?? attr(open, 'type');
    const from = first(body, 'ValidFromDate');
    out.set(id, {
      id,
      amount,
      percent: attr(open, 'valueOperator') === 'percent',
      youth: type === 'youth' || (type !== 'adult' && /<FromDateOfBirth\b/.test(body)),
      validFrom: from === null ? null : first(from, 'Date'),
    });
  }
  return out;
}

/** Class name → its EntryFeeIds, from eventclasses&includeEntryFees=true. */
export function parseClassFeeIds(xml: string): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const m of xml.matchAll(/<EventClass\b[^>]*>([\s\S]*?)<\/EventClass>/g)) {
    const name = first(m[1]!, 'Name');
    if (name === null) continue;
    const ids = [...m[1]!.matchAll(/<ClassEntryFee\b[^>]*>([\s\S]*?)<\/ClassEntryFee>/g)]
      .map((f) => Number(first(f[1]!, 'EntryFeeId')))
      .filter((id) => Number.isInteger(id));
    out.set(unescapeXml(name), ids);
  }
  return out;
}

const sum = (fees: EventorFee[]) => fees.reduce((a, f) => a + f.amount, 0);
const onlyId = (fees: EventorFee[]) => (fees.length === 1 ? fees[0]!.id : null);

/** A class's fees from the Eventor fees it references. */
export function classFees(fees: EventorFee[]): EventorClassFees {
  const fixed = fees.filter((f) => !f.percent);
  const firstFrom = fixed.map((f) => f.validFrom ?? '').sort()[0];
  const ordinary = fixed.filter((f) => (f.validFrom ?? '') === firstFrom);
  const adult = ordinary.filter((f) => !f.youth);
  const youth = ordinary.filter((f) => f.youth);
  const pct = fees.filter((f) => f.percent);
  const both = adult.length > 0 && youth.length > 0;
  return {
    entryFee: ordinary.length === 0 ? null : sum(adult.length > 0 ? adult : youth),
    youthEntryFee: both ? sum(youth) : null,
    lateFeePct: pct.length === 0 ? null : Math.round(sum(pct)),
    entryFeeId: onlyId(adult.length > 0 ? adult : youth),
    youthFeeId: both ? onlyId(youth) : null,
    lateFeeId: onlyId(pct),
  };
}

/** Class name → fees for the linked Eventor event. */
export async function fetchEventorClassFees(
  opts: FetchEventorClassTypesOpts
): Promise<Map<string, EventorClassFees>> {
  const [feeXml, classXml] = await Promise.all([
    eventorGet(opts, `entryfees/events/${opts.eventId}`),
    eventorGet(opts, `eventclasses?eventId=${opts.eventId}&includeEntryFees=true`),
  ]);
  const fees = parseEntryFees(feeXml);
  const out = new Map<string, EventorClassFees>();
  for (const [name, ids] of parseClassFeeIds(classXml))
    out.set(name, classFees(ids.flatMap((id) => fees.get(id) ?? [])));
  return out;
}
