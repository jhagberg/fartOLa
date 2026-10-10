---
created: 2026-10-10T17:30:00+02:00
title: SOFT draw - further exact speedups (table cache on redraw, walk-back, singletons)
area: edge
files:
  - apps/edge/src/draw/soft.ts
---

## Problem

After the batched pattern count (PR #99) a fresh draw of 1000 runners takes
about 0.5 s (50 clubs × 20) and about 0.5-1 s (Zipf over 300 clubs). A
redraw of the same class rebuilds the same exact table. An adversarial
Codex review (gpt-6.1-sol, xhigh, 2026-10-10) found no correctness
problem and ranked further exact speedups; all keep the draw exactly
uniform.

## Options, by gain against risk

1. Cache the whole counting table (layers, gaps, insertion order) per
   class shape: canonical club sizes, boundary clubs and their equality,
   and the pair cap. Measured 1713 → 31 ms (50 × 20) and 967 → 89 ms
   (Zipf) on a redraw. Only helps redraws and late-entrant redraws of the
   same shape; bound the cache (2.8 MiB / 23.6 MiB of integers for those
   two shapes before object overhead).
2. Skip transition terms whose destination is past the cap before the
   coefficient arithmetic: start j at max(0, d + c − s + pa − next.length
   + 1). About 4 % on 50 × 20.
3. Walk-back: compute the small coefficient first and skip zeros before
   multiplying by N[t][dp]; or pick dp first with aggregated weights, then
   (s, j, a) with coefficient-only weights. Small on a fresh draw, larger
   with the cache.
4. Batch the tail of singleton clubs (no boundary match): a word with d
   pairs and g eligible gaps has C(d, k) · r! · C(g + r − d − 1, r − d + k)
   extensions with k pairs. 5-10 % fresh on Zipf, 20-35 % with the cache.
   Needs its own exhaustive uniformity test.

Not worth it: smallest-first insertion (46 % slower on Zipf), FFT/NTT
convolution (coefficients depend on d; exact NTT needs CRT machinery).

Do 1 only if redraw speed matters in practice (a class is normally drawn
once); 2 and 3 are cheap.
