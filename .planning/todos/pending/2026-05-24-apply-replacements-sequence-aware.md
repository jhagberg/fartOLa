---
created: 2026-05-24T21:30:00+02:00
title: applyReplacements uses fragile index-based matching
area: correctness
files:
  - apps/edge/src/projection/reduce.ts
source: PR #35 Gemini + GPT-5.5 + DeepSeek cross-model review consensus (medium)
---

## Problem

`applyReplacements` maps `expected[i]` → `punches[i]` by absolute index. If a
competitor has extra or missing punches earlier in the course, all subsequent
indices shift and valid replacement codes won't be recognized — producing false
MP for an otherwise OK run.

Phase 2.1 replacement controls are rare (1-2 per course in Swedish orienteering)
and the courses are linear, so index alignment holds in practice. But for
general correctness the replacement matching should be sequence-aware.

## Proposed fix

Integrate replacement matching into `detectStatus`'s sequence walk instead of
pre-processing the expected list. When the sequence walker encounters an
expected code that has alternatives, accept any matching alternative from the
current punch-cursor position forward — same backtracking logic detectStatus
already uses for out-of-order detection.

## When

Phase 3+ when butterfly/loop courses or complex replacement scenarios arise.
Not blocking for sanctioned competitions in Phase 2.1.
