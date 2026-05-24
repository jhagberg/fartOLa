// Authored for fartola. Not ported from upstream.
//
// Simple Fisher-Yates random permutation for start list draw.
// D-03: drawRandom produces a uniform random permutation.
//
// Phase 2.1 D-03.

import crypto from 'node:crypto';
import type { DrawRunner, DrawResult } from './types.ts';

export interface DrawRandomOptions {
  /**
   * Optional RNG injection for reproducible tests.
   * Signature: (min: number, max: number) => number (returns integer in [min, max)).
   * Defaults to crypto.randomInt (CSPRNG).
   */
  rngFn?: (min: number, max: number) => number;
}

/**
 * Fisher-Yates random permutation draw.
 * Returns all runners in a uniformly random order; adjacencyCount reflects
 * however many adjacent same-club pairs land in the shuffled result.
 */
export function drawRandom(runners: DrawRunner[], opts: DrawRandomOptions = {}): DrawResult {
  const rng = opts.rngFn ?? ((min, max) => crypto.randomInt(min, max));

  if (runners.length === 0) {
    return { order: [], adjacencyCount: 0 };
  }

  const order = [...runners];
  // Fisher-Yates in-place shuffle
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng(0, i + 1);
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }

  // Count adjacencies in the shuffled order
  let adjacencyCount = 0;
  for (let i = 0; i < order.length - 1; i++) {
    if (order[i].club !== null && order[i].club === order[i + 1].club) adjacencyCount++;
  }

  return { order, adjacencyCount };
}
