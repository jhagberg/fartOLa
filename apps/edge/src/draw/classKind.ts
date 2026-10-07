// Authored for fartola. Not ported from upstream.
//
// SOFT class categories (classes.class_kind / age_class, migration 0020).
// Precedence for a class's kind: Eventor's ClassTypeId when the competition
// is linked to an Eventor event (17 = åldersklass, 19 = öppen klass), else
// the SOFT name patterns; the operator confirms or changes the suggestion.
// SOFT fixes the names: age classes D/H10–16 (ungdom), D/H18–20 (junior),
// D/H21 (senior), D/H35 and up in steps of 5 (veteran); elite classes are
// named exactly "D/H18 Elit", "D/H20 Elit", "D/H21 Elit" (TR 3.4.6); open
// classes "Inskolning 2,0", "Vit 2,0", "Vit 4,0", "Gul 2,5", "Gul 5,0",
// "Orange 3,0", "Orange 5,0", "Blå 3,0", "Svart 5,0", "Svart 7,0" (TR 3.4.9).
// An unknown name gets no suggestion. Rules read the stored kind, never the
// name. A rule that refuses something needs a confirmed kind: one from
// Eventor or the operator, not a bare name suggestion (kindConfirmed).

import type { ClassKind, ClassKindSource } from '@fartola/shared-types';

export interface ClassKindSuggestion {
  kind: ClassKind;
  ageClass: number | null;
  source: 'eventor' | 'name';
}

/** Eventor ClassTypeId values (verified on a real event, October 2026). */
export const EVENTOR_AGE_CLASS = 17;
export const EVENTOR_OPEN_CLASS = 19;

const SOFT_AGES = new Set([10, 12, 14, 16, 18, 20, 21]);
const isSoftAge = (a: number) => SOFT_AGES.has(a) || (a >= 35 && a % 5 === 0 && a <= 95);
const OPEN = /^(inskolning|vit|gul|orange|blå|bla|svart)\s+\d+([,.]\d)?$/;

function kindOfAge(age: number): ClassKind {
  if (age <= 16) return 'ungdom';
  if (age <= 20) return 'junior';
  if (age === 21) return 'senior';
  return 'veteran';
}

/** The SOFT age class in a name: D10, H 12, D/H12, H12K, D21 Kort, and a
 * merged H12-14 (the youngest age, TR 3.4.7). Null when there is none. */
function ageOf(n: string): { age: number; elite: boolean } | null {
  const m = /^(?:d\/h|h\/d|dh|hd|d|h)\s?(\d{1,2})(?:\s?[-–/]\s?(\d{1,2}))?(?!\d)(.*)$/.exec(n);
  if (m === null) return null;
  const ages = [m[1], m[2]].filter((a): a is string => a !== undefined).map(Number);
  if (!ages.every(isSoftAge)) return null;
  return { age: Math.min(...ages), elite: m[3]!.trim() === 'elit' };
}

/** The suggested kind for a class name, using Eventor's ClassTypeId when
 * known. Null when nothing fits: the operator chooses. */
export function suggestClassKind(
  name: string,
  eventorClassTypeId: number | null = null
): ClassKindSuggestion | null {
  const n = name.trim().toLowerCase().replace(/\s+/g, ' ');
  const inskolning = n.startsWith('inskolning');
  if (eventorClassTypeId === EVENTOR_OPEN_CLASS)
    return { kind: inskolning ? 'inskolning' : 'oppen', ageClass: null, source: 'eventor' };
  const age = ageOf(n);
  const elite = age !== null && age.elite && [18, 20, 21].includes(age.age);
  if (eventorClassTypeId === EVENTOR_AGE_CLASS)
    return age === null
      ? null
      : { kind: elite ? 'elit' : kindOfAge(age.age), ageClass: age.age, source: 'eventor' };
  if (inskolning) return { kind: 'inskolning', ageClass: null, source: 'name' };
  if (OPEN.test(n) || n.startsWith('öppen'))
    return { kind: 'oppen', ageClass: null, source: 'name' };
  if (age === null) return null;
  return { kind: elite ? 'elit' : kindOfAge(age.age), ageClass: age.age, source: 'name' };
}

/** A stored kind counts as confirmed when it came from Eventor's ClassTypeId
 * or from the operator. A kind guessed from the class name is only a
 * suggestion until the operator confirms it; rules that refuse something
 * (pursuit, vacancies, seeding) do not act on a suggestion. */
export function kindConfirmed(c: {
  classKind: ClassKind | null;
  classKindSource: ClassKindSource | null;
}): boolean {
  return (
    c.classKind !== null && (c.classKindSource === 'eventor' || c.classKindSource === 'operator')
  );
}

/** What stops a rule from reading the class kind, or null when it may.
 * No kind → 409 class_kind_unknown. A kind only guessed from the name →
 * 409 class_kind_unconfirmed ("Bekräfta klasstyp för <klass>"): a rule that
 * would refuse something does not act on a guess. */
export function kindProblem(c: {
  name: string;
  classKind: ClassKind | null;
  classKindSource: ClassKindSource | null;
}): { error: 'class_kind_unknown' | 'class_kind_unconfirmed'; message: string } | null {
  if (c.classKind === null)
    return { error: 'class_kind_unknown', message: `Ange klasstyp för ${c.name}` };
  if (!kindConfirmed(c))
    return { error: 'class_kind_unconfirmed', message: `Bekräfta klasstyp för ${c.name}` };
  return null;
}
