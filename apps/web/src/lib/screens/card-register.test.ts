// Authored for fartola. Not ported from upstream.
//
// Vitest coverage for the Brickregister rows (card-register.ts): one row
// per card from entries and rentals, and search on number or name.

import { describe, it, expect } from 'vitest';
import type { ClassDTO, CompetitorDTO, HiredCardRow } from '@fartola/shared-types';
import { buildCardRows, filterCardRows } from './card-register.ts';

const runner = (id: string, name: string, card: number | null, club: string | null = null) =>
  ({ id, name, club, class_id: 'h21', card_number: card }) as CompetitorDTO;
const hired = (card: number) => ({ card_number: card }) as HiredCardRow;
const classes = [{ id: 'h21', name: 'H21', short_name: null }] as unknown as ClassDTO[];

describe('card register', () => {
  const rows = buildCardRows(
    [
      runner('a', 'Anna Ek', 8_000_100, 'OK Ek'),
      runner('b', 'Bo Al', 12_345),
      runner('c', 'Cia', null),
    ],
    { open: [hired(12_345), hired(500_001)], returned: [hired(8_000_100)] },
    classes
  );

  it('has one row per card, rentals without a runner included, by number', () => {
    expect(
      rows.map((r) => [r.card_number, r.competitor?.id ?? null, r.class_name, r.hire])
    ).toEqual([
      [12_345, 'b', 'H21', 'open'],
      [500_001, null, null, 'open'],
      [8_000_100, 'a', 'H21', 'returned'],
    ]);
  });

  it('searches digits in the card number and text in name or club', () => {
    expect(filterCardRows(rows, '5000').map((r) => r.card_number)).toEqual([500_001]);
    expect(filterCardRows(rows, ' ek ').map((r) => r.card_number)).toEqual([8_000_100]);
    expect(filterCardRows(rows, 'bo').map((r) => r.card_number)).toEqual([12_345]);
    expect(filterCardRows(rows, '')).toHaveLength(3);
  });
});
