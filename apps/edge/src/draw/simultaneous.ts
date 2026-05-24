// Authored for fartola. Not ported from upstream.
//
// Mass start (simultaneous) draw — all runners get the same start time.
// The order returned is the input order (no reordering needed; the route
// assigns the same start_time_ms = firstStartMs to all positions).
//
// D-03: drawSimultaneous assigns all runners the same start time.
//
// Phase 2.1 D-03.

import type { DrawRunner, DrawResult } from './types.ts';

/**
 * Mass-start draw: preserves input order, all runners share the same start
 * time (assigned by the lottning route, not here).
 */
export function drawSimultaneous(runners: DrawRunner[]): DrawResult {
  if (runners.length === 0) {
    return { order: [], adjacencyCount: 0 };
  }

  // Count adjacencies in the unchanged input order.
  let adjacencyCount = 0;
  for (let i = 0; i < runners.length - 1; i++) {
    if (runners[i].club !== null && runners[i].club === runners[i + 1].club) adjacencyCount++;
  }

  return { order: [...runners], adjacencyCount };
}
