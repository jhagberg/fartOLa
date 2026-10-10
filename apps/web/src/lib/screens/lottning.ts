// Authored for fartola. Not ported from upstream.
//
// Logic for LottningView's draw form: which fields a mode uses, the POST
// body (mirrors the edge LottningInput schema in routes/lottning.ts, so the
// form never sends a field the server refuses with 400), the seeding groups
// typed per runner, and a refused draw as plain Swedish (ADR-0016 rule 6).
// The server is the judge of the SOFT rules; the view shows its answer.

import type { ClassKind } from '@fartola/shared-types';
import {
  ApiError,
  type DrawMode,
  type DrawType,
  type LottningBody,
  type LottningResult,
  type VacantPosition,
} from '#lib/api/client.ts';

export const DRAW_MODES: DrawMode[] = [
  'SOFT',
  'Simultaneous',
  'Seeded',
  'Pursuit',
  'ReversePursuit',
];
export const DRAW_TYPES: DrawType[] = [
  'All',
  'RemainingBefore',
  'RemainingAfter',
  'RemainingVacant',
];
export const VACANT_POSITIONS: VacantPosition[] = ['Mixed', 'First', 'Last'];

export const isPursuit = (m: DrawMode): boolean => m === 'Pursuit' || m === 'ReversePursuit';

/** Late entrants are placed with SOFT (server rule). */
export const lateEntrantsAllowed = (m: DrawMode): boolean => m === 'SOFT';

export interface DrawForm {
  mode: DrawMode;
  drawType: DrawType;
  /** Epoch ms of the first start. */
  firstStartMs: number;
  intervalSec: number;
  vacantSlots: number;
  vacantPosition: VacantPosition;
  bestFirst: boolean;
  /** Pursuit: epoch ms of the restart block. */
  restartMs: number;
  /** Pursuit: minutes behind the leader that send a runner to the restart. */
  maxBehindMin: number;
  scale: number;
}

/** Which fields the form shows for a mode and draw type. */
export function visibleFields(mode: DrawMode, drawType: DrawType) {
  const whole = drawType === 'All' || !lateEntrantsAllowed(mode);
  return {
    firstStart: whole,
    interval: mode !== 'Simultaneous',
    vacancies: whole && (mode === 'SOFT' || mode === 'Seeded'),
    seeding: mode === 'Seeded',
    pursuit: isPursuit(mode),
  };
}

/** The POST body for the form. Late entrants keep the class's own interval;
 * the form's interval is only the fallback when the class has none. */
export function buildLottningBody(f: DrawForm): LottningBody {
  if (f.drawType !== 'All' && lateEntrantsAllowed(f.mode))
    return {
      mode: f.mode,
      drawType: f.drawType,
      ...(f.intervalSec > 0 ? { intervalSec: f.intervalSec } : {}),
    };
  const base = {
    mode: f.mode,
    firstStartMs: f.firstStartMs,
    intervalSec: f.mode === 'Simultaneous' ? 0 : f.intervalSec,
  };
  if (isPursuit(f.mode))
    return {
      ...base,
      restartMs: f.restartMs,
      maxBehindSec: Math.round(f.maxBehindMin * 60),
      ...(f.scale !== 1 ? { scale: f.scale } : {}),
    };
  const v = visibleFields(f.mode, 'All');
  return {
    ...base,
    ...(v.vacancies && f.vacantSlots > 0
      ? { vacantSlots: f.vacantSlots, vacantPosition: f.vacantPosition }
      : {}),
    ...(f.mode === 'Seeded' ? { bestFirst: f.bestFirst } : {}),
  };
}

/** The seeding fields (runner id → typed group) as groups of ids,
 * strongest (lowest number) first; an empty field is unseeded. Null when a
 * field is not a whole number from 1 to 99. */
export function seedGroupsFromInput(
  runnerIds: string[],
  typed: Record<string, string>
): string[][] | null {
  const byGroup = new Map<number, string[]>();
  for (const id of runnerIds) {
    const raw = (typed[id] ?? '').trim();
    if (raw === '') continue;
    if (!/^\d{1,2}$/.test(raw) || Number(raw) === 0) return null;
    const g = Number(raw);
    byGroup.set(g, [...(byGroup.get(g) ?? []), id]);
  }
  return [...byGroup.entries()].sort((a, b) => a[0] - b[0]).map(([, ids]) => ids);
}

/** What stops the draw and how to get past it. `fix` names the confirm
 * path the view offers: confirm the class kind inline, or set the
 * competition level on the info page. */
export interface Refusal {
  key: string;
  vars?: Record<string, unknown>;
  fix?: 'class_kind' | 'level';
  /** For a 400 on a field: the i18n key of that field's label. */
  fieldKey?: string;
}

const FIELD_KEYS: Record<string, string> = {
  firstStartMs: 'lottning.firstStart',
  intervalSec: 'lottning.interval',
  vacantSlots: 'lottning.vacants',
  drawType: 'lottning.drawType',
  restartMs: 'lottning.restart',
  maxBehindSec: 'lottning.maxBehind',
  scale: 'lottning.scale',
};

const BY_CODE: Record<string, Refusal> = {
  class_kind_unknown: { key: 'lottning.err.classKindUnknown', fix: 'class_kind' },
  class_kind_unconfirmed: { key: 'lottning.err.classKindUnconfirmed', fix: 'class_kind' },
  competition_level_unknown: { key: 'lottning.err.levelUnknown', fix: 'level' },
  seeding_not_allowed: { key: 'lottning.err.seedingNotAllowed' },
  pursuit_not_allowed: { key: 'lottning.err.pursuitNotAllowed' },
  vacancies_not_offered_in_elite: { key: 'lottning.err.vacantInElite' },
  no_start_list: { key: 'lottning.err.noStartList' },
  interval_unknown: { key: 'lottning.err.intervalUnknown' },
  restart_overlaps_pursuit: { key: 'lottning.err.restartOverlaps' },
  one_seeding_group: { key: 'lottning.err.oneSeedingGroup' },
  class_not_found: { key: 'lottning.err.classNotFound' },
};

/** A refused draw (or seeding save) as an i18n key, with the class name. */
export function refusalOf(e: unknown, className: string): Refusal {
  if (e instanceof ApiError && e.body !== null && typeof e.body === 'object') {
    const b = e.body as { error?: string; errors?: Array<{ path: string }> };
    const known = b.error !== undefined ? BY_CODE[b.error] : undefined;
    if (known !== undefined) return { ...known, vars: { class: className } };
    if (Array.isArray(b.errors) && b.errors.length > 0)
      return {
        key: 'lottning.err.invalidField',
        fieldKey: FIELD_KEYS[b.errors[0]!.path] ?? 'lottning.mode',
      };
  }
  return { key: 'lottning.err.failed', vars: { error: (e as Error).message } };
}

/** SOFT TR 4.16.3: the closing time is in the PM, so a draw that moved it
 * says from what to what. Null when it did not move or is not known. */
export function closingMoved(res: LottningResult): { from: number; to: number } | null {
  const from = res.previous_closing_time_ms ?? null;
  const to = res.closing_time_ms ?? null;
  return from !== null && to !== null && from !== to ? { from, to } : null;
}

/** The start-order note for a class (SOFT TR 7.4.2, TR 7.4.3): runners
 * without a start time where free start time is banned, or the reminder
 * that an open class uses free start time. Start punching itself is
 * allowed (TR 4.18.16). */
export function startOrderNote(cls: {
  class_kind?: ClassKind | null;
  free_start_banned?: boolean | null;
  without_start_time?: number;
}): { key: string; vars?: Record<string, unknown> } | null {
  const without = cls.without_start_time ?? 0;
  if (cls.free_start_banned === true && without > 0)
    return { key: 'lottning.freeStartBanned', vars: { count: without } };
  if (cls.class_kind === 'oppen' || cls.class_kind === 'inskolning')
    return { key: 'lottning.openClassFreeStart' };
  return null;
}

/** The bib a 409 bib_taken names (POST …/bibs, PATCH …/profile), else null. */
export function bibTakenOf(e: unknown): string | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  const b = e.body as { error?: string; bib?: string } | null;
  return b?.error === 'bib_taken' && typeof b.bib === 'string' ? b.bib : null;
}
