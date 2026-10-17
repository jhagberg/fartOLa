---
created: 2026-10-17T11:00:00+02:00
title: ⅃ooL Dark theme - switch, hard-coded colours, floors in dark
area: web
files:
  - apps/web/src/lib/tokens.css
  - apps/web/src/lib/tokens.contrast.test.ts
  - apps/web/src/lib/components/AppearanceSettings.svelte
---

## Why

The ⅃ooL design system has a proposed Dark theme for evening events and
the speaker screen. The ⅃ooL tokens PR took in Light and Sun only. Dark's
values already pass the contrast pairs (94 of 94 with `dark` in `MODES`),
and the v2 review's colour-blind simulation gave the punch tiles a
smallest ΔL of 31 (missing tile inverted: light red fill, dark text).

## What is left

1. Take the `[data-theme='dark']` block from the design system's
   `assets/Code/tokens.css` into `tokens.css`, and add `dark` to
   `MODES` in `tokens.contrast.test.ts`.
2. A choice under Utseende that sets `data-theme='dark'` on `<html>` and
   is remembered. Sun mode (`.contrast-high`) wins when both are set.
3. Find colours written straight into components (`#fff`, `white`,
   `rgba(...)`) that assume a light page, and move them to tokens.
4. Run the screen-floor and a11y e2e specs with Dark on.

Source: the ⅃ooL design system v2 from Claude Design, reviewed
2026-10-17.
