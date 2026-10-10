---
created: 2026-10-10T00:00:00+02:00
title: Settings, guard Liveresultat and helper codes against a competition switch
area: web
files:
  - apps/web/src/lib/screens/SettingsView.svelte
  - tests/e2e/settings-nav.spec.ts
---
Pre-existing, found in the plan 2 final review; not fixed there.

The Liveresultat and helper-code loads in `SettingsView` have no
latest-only guard. After a competition switch, a late response from the
previous competition, or a leftover `liveId` / `livePwd` draft, can be
saved into the new competition. With the heading "Den här tävlingen: X",
a late `liveId` from the old competition looks like X's and can be saved
to X with one password entry. The radio card already uses `latestOnly()`.

Fix: guard both loads like the radio card, and blank the drafts on a
switch. Test with a delayed GET for the old competition and a switch
before it answers.
