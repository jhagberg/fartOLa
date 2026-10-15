// Authored for fartola. Not ported from upstream.
//
// ADR-0019: the card holder data a runner programmed into the card (name,
// and on a SIAC also address, phone, email, birth date) never goes into the
// event log. Only the name is kept, in memory, so read-out can suggest it
// for a walk-up entry. A restart forgets it; the operator then types it.

/** The name part of a card's holder data, or null when there is none. Takes
 * the decoded record as the library gives it (firstName/lastName) or as old
 * events stored it (first_name/last_name). */
export function holderName(cardHolder: unknown): string | null {
  if (!cardHolder || typeof cardHolder !== 'object') return null;
  const h = cardHolder as Record<string, unknown>;
  const part = (a: string, b: string): string => {
    const v = h[a] ?? h[b];
    return typeof v === 'string' ? v.trim() : '';
  };
  const joined = `${part('firstName', 'first_name')} ${part('lastName', 'last_name')}`.trim();
  return joined.length > 0 ? joined : null;
}

// shortcut: kept for the last 1000 reads of this process; a walk-up is
// entered within minutes of its read.
const MAX = 1000;
const hints = new Map<string, string>();

export function rememberHolderName(nodeId: string, localSeq: number, name: string | null): void {
  if (name === null) return;
  hints.set(`${nodeId}:${localSeq}`, name);
  if (hints.size > MAX) hints.delete(hints.keys().next().value as string);
}

export function rememberedHolderName(nodeId: string, localSeq: number): string | null {
  return hints.get(`${nodeId}:${localSeq}`) ?? null;
}
