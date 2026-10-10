// Authored for fartola. Not ported from upstream.
//
// Brickregister: every card in the competition and who has it. One row per
// card number from the entries and the rental register, so a rental card
// handed out but not yet bound to a runner shows too.

import type { ClassDTO, CompetitorDTO, HiredCardRow } from '@fartola/shared-types';

export interface CardRow {
  card_number: number;
  competitor: CompetitorDTO | null;
  class_name: string | null;
  /** 'open' = rented out now, 'returned' = rented and handed back, null = own card. */
  hire: 'open' | 'returned' | null;
}

export function buildCardRows(
  competitors: readonly CompetitorDTO[],
  hired: { open: readonly HiredCardRow[]; returned: readonly HiredCardRow[] },
  classes: readonly ClassDTO[]
): CardRow[] {
  const className = new Map(classes.map((c) => [c.id, c.short_name ?? c.name]));
  const hire = new Map<number, 'open' | 'returned'>();
  for (const h of hired.returned) hire.set(h.card_number, 'returned');
  for (const h of hired.open) hire.set(h.card_number, 'open');
  const rows = new Map<number, CardRow>();
  for (const c of competitors) {
    if (c.card_number === null) continue;
    rows.set(c.card_number, {
      card_number: c.card_number,
      competitor: c,
      class_name: className.get(c.class_id) ?? null,
      hire: hire.get(c.card_number) ?? null,
    });
  }
  for (const [card, state] of hire) {
    if (!rows.has(card)) {
      rows.set(card, { card_number: card, competitor: null, class_name: null, hire: state });
    }
  }
  return [...rows.values()].sort((a, b) => a.card_number - b.card_number);
}

/** Digits search the card number (anywhere in it); anything else searches
 * the runner's name and club. */
export function filterCardRows(rows: readonly CardRow[], query: string): CardRow[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...rows];
  if (/^\d+$/.test(q)) return rows.filter((r) => String(r.card_number).includes(q));
  return rows.filter(
    (r) =>
      r.competitor !== null &&
      (r.competitor.name.toLowerCase().includes(q) ||
        (r.competitor.club ?? '').toLowerCase().includes(q))
  );
}
