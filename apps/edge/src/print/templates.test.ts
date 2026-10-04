// Authored for fartola. Not ported from upstream.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatGap,
  formatStartTime,
  renderTemplate,
  type ThermalPrinterLike,
} from './templates.ts';
import type { ReceiptData, ReceiptTemplate } from './sink.ts';
import type { CompetitorView } from '../projection/types.ts';
import { softStatus } from '@fartola/shared-types';

test('formatGap uses printer-safe text for the leader row', () => {
  assert.equal(formatGap(0), 'Leder');
});

test('formatStartTime renders epoch ms on the competition wall clock (02.1-14 Task 1)', () => {
  assert.equal(formatStartTime(Date.parse('2026-10-03T08:00:00Z')), '10:00:00');
});

const clock = (sec: number): { seconds_in_half_day: number; half_day: 0; weekday: null } => ({
  seconds_in_half_day: sec,
  half_day: 0,
  weekday: null,
});

/** One runner's receipt data; the defaults are an OK run in an untimed class,
 * with the class row as the reducer produces it. */
function receiptData(over: Partial<CompetitorView> = {}): ReceiptData {
  const competitor: CompetitorView = {
    id: 'c1',
    name: 'Anna Ek',
    club: 'OK Ek',
    class_id: 'cls-ins',
    card_number: 123,
    status: 'OK',
    card_read_history: [],
    latest_punches: [{ code: 31, ...clock(36_300) }],
    latest_start: clock(36_000),
    latest_finish: clock(36_900),
    missing_codes: [],
    extra_codes: [],
    out_of_order_codes: [],
    elapsed_time_ms: 900_000,
    manual_dnf_reason: null,
    manual_status: null,
    voided_legs: [],
    start_time_ms: null,
    no_timing: true,
    missing_start: false,
    suggested_start_ms: null,
    suggested_start_offset_ms: null,
    late_start_ms: null,
    early_start_ms: null,
    ...over,
  };
  return {
    competitor,
    competition: {
      id: 'comp',
      name: 'Inskolning',
      date: '2026-10-04',
      receipt_template: 'classic',
      auto_print: false,
    },
    classObj: { id: 'cls-ins', name: 'Inskolning' },
    course: { id: 'k', name: 'Vit', length_m: null, climb_m: null, control_codes: [31] },
    placeContext: {
      place: null,
      behind_leader_ms: null,
      leader_name: null,
      class_rows: [
        {
          competitor_id: 'c1',
          name: 'Anna Ek',
          club: 'OK Ek',
          status: competitor.status,
          elapsed_time_ms: competitor.no_timing ? null : competitor.elapsed_time_ms,
          place: null,
          behind_leader_ms: null,
          soft_status: softStatus(competitor.status, { noTiming: competitor.no_timing }),
        },
      ],
    },
  };
}

const TEMPLATES: ReceiptTemplate[] = ['classic', 'standing', 'detailed', 'top4', 'minimal', 'kids'];

/** The text lines a template prints. */
async function printed(name: ReceiptTemplate, data: ReceiptData): Promise<string> {
  const lines: string[] = [];
  const printer = new Proxy({} as ThermalPrinterLike, {
    get: (_t, prop) => {
      if (prop === 'println' || prop === 'print') return (s: string) => void lines.push(s);
      if (prop === 'leftRight') return (l: string, r: string) => void lines.push(`${l} ${r}`);
      if (prop === 'printImageBuffer' || prop === 'isPrinterConnected' || prop === 'execute')
        return async () => undefined;
      return () => undefined;
    },
  });
  await renderTemplate(printer, name, data);
  return lines.join('\n');
}

// 02.1-14 Task 9: an untimed class prints no running time, split time,
// place or gap on any receipt template.
test('receipts for an untimed class carry no time or place (02.1-14 Task 9)', async () => {
  for (const name of TEMPLATES) {
    const text = await printed(name, receiptData());
    assert.doesNotMatch(text, /\d:\d\d/, `${name}: no time on an untimed receipt:\n${text}`);
    assert.doesNotMatch(text, /Plats|PLATS|Leder/, `${name}: no place on an untimed receipt`);
    assert.doesNotMatch(text, /Väntar/, `${name}: an OK untimed run is not pending`);
  }
});

test('SOFT TR 4.21.3: an OK run in an untimed class prints "Deltagit" on every receipt', async () => {
  for (const name of TEMPLATES) {
    assert.match(await printed(name, receiptData()), /Deltagit/, name);
  }
});

test('SOFT TA till TR 7.8.2: receipts print "Ej godkänd", "Diskad" and "Ej start" instead of a time', async () => {
  const cases: Array<[CompetitorView['status'], string]> = [
    ['MP', 'Ej godkänd'],
    ['DNF', 'Ej godkänd'],
    ['MAX', 'Ej godkänd'],
    ['DQ', 'Diskad'],
    ['DNS', 'Ej start'],
  ];
  for (const [status, label] of cases) {
    for (const name of TEMPLATES) {
      const text = await printed(name, receiptData({ status, no_timing: false }));
      assert.match(text, new RegExp(label), `${name} ${status}:\n${text}`);
      assert.doesNotMatch(text, /Felstämpling|missing punch|\bDNF\b|\bMP\b/, `${name} ${status}`);
    }
  }
  // An approved timed run still prints its time.
  assert.match(await printed('classic', receiptData({ no_timing: false })), /TOTAL 15:00/);
});
