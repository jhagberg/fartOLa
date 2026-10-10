// Authored for fartola. Not ported from upstream.
//
// Shared type definitions for the draw algorithms (SOFT, Simultaneous, Seeded).
// Phase 2.1 D-03/D-04: draw modes for start list generation.

/** A competitor entry that can be assigned a start slot. */
export interface DrawRunner {
  id: string;
  /** Club affiliation — used by SOFT to minimise adjacent same-club runners. */
  club: string | null;
}

/** A draw result slot: either a runner or null (vacant/gap slot). */
export type DrawSlot = DrawRunner | null;

/** The ordered result of a draw.
 *
 * - `order`: the slot sequence; null entries are vacant positions in the start
 *   list (D-06: Vakanta startplatser are distributed as null-competitor gaps).
 * - `adjacencyCount`: number of adjacent pairs where both runners share the
 *   same club. Zero when perfect separation was achievable; > 0 when one club
 *   has more than half the field (impossibility-aware, never crashes). */
export interface DrawResult {
  order: DrawSlot[];
  adjacencyCount: number;
}

/** Random integer in [min, max). Every draw defaults to crypto.randomInt
 * (SOFT TR 7.5.2); tests inject a seeded generator. */
export type RngFn = (min: number, max: number) => number;

/** Where vacant places go in a drawn class: MeOS's three positions
 * (oEvent::VacantPosition, MeOS code/oEvent.h:540-544). */
export type VacantPosition = 'Mixed' | 'First' | 'Last';

/** A draw that cannot be done as asked. The route answers 409 with `code`. */
export class DrawError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DrawError';
    this.code = code;
  }
}
