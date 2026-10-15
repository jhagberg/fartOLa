---
created: 2026-10-11T00:00:00+02:00
title: Raw server text still shown in several error messages (userMessage)
area: web
files:
  - apps/web/src/lib/screens/LottningView.svelte
  - apps/web/src/lib/components/StartTimeHistory.svelte
  - apps/web/src/lib/components/CorrectionsPanel.svelte
  - apps/web/src/lib/screens/ReadoutView.svelte
---

## Problem

Raw server text still reaches the screen in: `refusalOf`
(`lottning.err.failed {{error}}`), StartTimeHistory (`history.err.load
{{error}}`), CorrectionsPanel, RacePhaseControl, HomeView, and ReadoutView's
`err.network (${message})` toasts. This is the X8 `userMessage()` work. Found
in the design-lab plan 3 reviews, 2026-10-11.

## Idea

One `userMessage()` that maps errors to plain Swedish; use it in all of these.
Test each message with a failing mock.
