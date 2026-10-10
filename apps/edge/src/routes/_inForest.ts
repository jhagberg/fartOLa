// Authored for fartola. Not ported from upstream.
//
// SOFT TR 4.22.1: who is still in the forest. One list from every source:
//   - checkunit: the latest BSF8 backup-memory read (competitions.checkunit_*)
//   - radio:     a ROC punch at any control but a finish unit
//   - read:      a card read with a start punch
// "Out" (not in the forest): a card read with a finish punch, a manual finish
// time (TR 4.20.6) or a status set by hand (Ej start, Utgått, Återbud, ...).
// "No check": seen by radio or read but not at the check (the check unit's
// memory, a radio check code, or the check punch of a read).
//
// Shared by GET /api/competitions/:id/in-forest and the checkunit snapshot.

import { and, desc, eq } from 'drizzle-orm';

import { competitions, events } from '../db/schema.ts';
import type { DbHandle } from '../db/index.ts';
import type { CompetitorView } from '../projection/types.ts';
import { parseRocControls } from '../integrations/roc/status.ts';

export type InForestSource =
  { kind: 'checkunit' } | { kind: 'radio'; code: number } | { kind: 'read' };

export type OutReason = 'finish_read' | 'manual_finish' | 'status';

export interface InForestCard {
  card_number: number;
  sources: InForestSource[];
  /** Seen by radio or read but not at the check (only set when a check
   * source exists at all: a snapshot, check codes or a read's check punch). */
  no_check: boolean;
}

export interface InForestData {
  /** Not out: cards seen by any source. */
  cards: InForestCard[];
  /** Out, with why. Includes check-unit cards that are out. */
  out: Array<{ card_number: number; reason: OutReason }>;
  checkunit: { cards: number[]; overflow: boolean; read_at_ms: number } | null;
  /** Epoch ms of the latest radio row received; null = none. */
  radio_last_punch_at_ms: number | null;
  radio_enabled: boolean;
}

export function loadInForest(
  handle: DbHandle,
  competitionId: string,
  competitors: Iterable<CompetitorView>,
  /** Check-unit cards just read; undefined = use the stored read. */
  fresh?: { cards: number[]; overflow: boolean; readAtMs: number }
): InForestData | null {
  const db = handle.db;
  const comp = db
    .select({
      enabled: competitions.rocEnabled,
      checkText: competitions.rocCheckCodes,
      finishText: competitions.rocFinishCodes,
      cards: competitions.checkunitCards,
      overflow: competitions.checkunitOverflow,
      readAt: competitions.checkunitReadAtMs,
    })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .get();
  if (!comp) return null;

  let checkunit: InForestData['checkunit'] = null;
  if (fresh) {
    checkunit = { cards: fresh.cards, overflow: fresh.overflow, read_at_ms: fresh.readAtMs };
  } else if (comp.cards !== null && comp.readAt !== null) {
    checkunit = {
      cards: JSON.parse(comp.cards) as number[],
      overflow: comp.overflow === true,
      read_at_ms: comp.readAt,
    };
  }

  const checkCodes = new Set(parseRocControls(comp.checkText));
  const finishCodes = new Set(parseRocControls(comp.finishText));
  const sources = new Map<number, InForestSource[]>();
  const atCheck = new Set<number>();
  const add = (card: number, s: InForestSource): void => {
    const list = sources.get(card);
    if (list) list.push(s);
    else sources.set(card, [s]);
  };

  for (const cn of checkunit?.cards ?? []) {
    add(cn, { kind: 'checkunit' });
    atCheck.add(cn);
  }

  let radioLast: number | null = null;
  const seenRadio = new Set<string>();
  for (const e of db
    .select({ payload: events.payload })
    .from(events)
    .where(and(eq(events.competitionId, competitionId), eq(events.eventType, 'radio_punch')))
    .all()) {
    const p = e.payload;
    if (p.event_type !== 'radio_punch') continue;
    if (radioLast === null || p.received_at_ms > radioLast) radioLast = p.received_at_ms;
    if (finishCodes.has(p.control_code)) continue;
    if (checkCodes.has(p.control_code)) atCheck.add(p.card_number);
    const key = `${p.card_number}:${p.control_code}`;
    if (seenRadio.has(key)) continue;
    seenRadio.add(key);
    add(p.card_number, { kind: 'radio', code: p.control_code });
  }

  // Latest read per card: a finish means back, a start punch means left.
  const seenRead = new Set<number>();
  const finishRead = new Set<number>();
  let checkInRead = false;
  for (const e of db
    .select({ payload: events.payload })
    .from(events)
    .where(and(eq(events.competitionId, competitionId), eq(events.eventType, 'card_read')))
    .orderBy(desc(events.eventTimeMs))
    .all()) {
    const p = e.payload;
    if (p.event_type !== 'card_read' || seenRead.has(p.card_number)) continue;
    seenRead.add(p.card_number);
    if (p.finish != null) finishRead.add(p.card_number);
    if (p.check != null) {
      atCheck.add(p.card_number);
      checkInRead = true;
    }
    if (p.start != null) add(p.card_number, { kind: 'read' });
  }

  const out = new Map<number, OutReason>();
  for (const c of competitors) {
    if (c.card_number === null) continue;
    if (c.manual_finish_ms !== null) out.set(c.card_number, 'manual_finish');
    else if (c.manual_status !== null) out.set(c.card_number, 'status');
  }
  // A physical finish read is the strongest reason.
  for (const cn of finishRead) out.set(cn, 'finish_read');

  const haveCheckSource = checkunit !== null || checkCodes.size > 0 || checkInRead;
  const cards: InForestCard[] = [];
  for (const [cn, list] of sources) {
    if (out.has(cn)) continue;
    cards.push({
      card_number: cn,
      sources: list,
      no_check: haveCheckSource && !atCheck.has(cn),
    });
  }
  cards.sort((a, b) => a.card_number - b.card_number);

  return {
    cards,
    out: [...out].map(([card_number, reason]) => ({ card_number, reason })),
    checkunit,
    radio_last_punch_at_ms: radioLast,
    radio_enabled: comp.enabled,
  };
}
