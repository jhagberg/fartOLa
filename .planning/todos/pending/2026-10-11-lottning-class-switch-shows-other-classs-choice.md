---
created: 2026-10-11T00:00:00+02:00
title: Lottning: a class switch during a save can show the other class's choice
area: web
files:
  - apps/web/src/lib/screens/LottningView.svelte
---

## Problem

When the class changes while a setting save is in flight, the select or
checkbox can show the other class's pending choice (the controls are not
re-created). Also `onKindSaved` reloads `classes` from `listClasses`, which
can overwrite an in-flight setting save. Found in the design-lab plan 3
reviews, 2026-10-11.

## Idea

Key the controls on the class id, and merge the reload with pending saves
instead of replacing them. Test a class switch with a delayed PATCH.
