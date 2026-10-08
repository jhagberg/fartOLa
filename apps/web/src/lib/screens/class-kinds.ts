// Authored for fartola. Not ported from upstream.
//
// Logic for the class-kind list (components/ClassKindsPanel.svelte, SOFT TR
// 3.4.2): what each class's kind is or is proposed to be, whether it is
// confirmed, and the PUT items that confirm it. A kind from Eventor or the
// operator is confirmed; one guessed from the class name is only a
// suggestion, and rules that refuse something (pursuit, seeding, vacant
// places) do not act on it (edge draw/classKind.ts kindConfirmed).

import type { ClassKind } from '@fartola/shared-types';
import { ApiError, type ClassKindItem } from '#lib/api/client.ts';

export type { ClassKindItem };

export const CLASS_KINDS: ClassKind[] = [
  'ungdom',
  'junior',
  'senior',
  'veteran',
  'elit',
  'oppen',
  'inskolning',
];

/** 'eventor' / 'operator': confirmed. 'eventor_suggestion' / 'name':
 * proposed, needs the operator. 'missing': no kind and no suggestion. */
export type KindStatus = 'eventor' | 'operator' | 'eventor_suggestion' | 'name' | 'missing';

export function kindStatus(item: ClassKindItem): KindStatus {
  if (item.class_kind !== null && item.class_kind_source === 'eventor') return 'eventor';
  if (item.class_kind !== null && item.class_kind_source === 'operator') return 'operator';
  if (item.suggestion?.source === 'eventor') return 'eventor_suggestion';
  if (item.class_kind !== null || item.suggestion !== null) return 'name';
  return 'missing';
}

export function isConfirmed(item: ClassKindItem): boolean {
  const s = kindStatus(item);
  return s === 'eventor' || s === 'operator';
}

/** Mirrors edge kindNeedsAge: every kind but the open classes has a D/H age. */
export function kindNeedsAge(kind: ClassKind): boolean {
  return kind !== 'oppen' && kind !== 'inskolning';
}

/** The kind and age shown for a class: the stored one when confirmed, else
 * the suggestion (Eventor's or the name's), else the stored guess. */
export function proposed(item: ClassKindItem): { kind: ClassKind | null; age: number | null } {
  if (!isConfirmed(item) && item.suggestion !== null)
    return { kind: item.suggestion.class_kind, age: item.suggestion.age_class };
  return { kind: item.class_kind, age: item.age_class };
}

/** The PUT item that confirms a class as proposed, or null when there is
 * nothing to confirm (already confirmed, no kind, or an age class whose
 * age is unknown). */
export function confirmItem(
  item: ClassKindItem
): { class_id: string; class_kind: ClassKind; age_class: number | null } | null {
  if (isConfirmed(item)) return null;
  const { kind, age } = proposed(item);
  if (kind === null || (kindNeedsAge(kind) && age === null)) return null;
  return { class_id: item.class_id, class_kind: kind, age_class: kindNeedsAge(kind) ? age : null };
}

/** The age field's text → a D/H age, null when empty, undefined when not a
 * whole number from 1 to 99. */
export function parseAge(raw: string): number | null | undefined {
  const s = raw.trim();
  if (s === '') return null;
  if (!/^\d{1,2}$/.test(s) || Number(s) === 0) return undefined;
  return Number(s);
}

/** The i18n key for a refused PUT, with the class it concerns when known. */
export function kindsErrorKey(e: unknown): { key: string; classId: string | null } {
  if (e instanceof ApiError && e.body !== null && typeof e.body === 'object') {
    const b = e.body as { error?: string; class_id?: string };
    if (b.error === 'age_class_required')
      return { key: 'classKinds.err.ageRequired', classId: b.class_id ?? null };
    if (b.error === 'class_not_in_competition')
      return { key: 'classKinds.err.notInCompetition', classId: b.class_id ?? null };
  }
  return { key: 'classKinds.err.saveFailed', classId: null };
}
