---
created: 2026-10-09T20:00:00+02:00
title: The settings page with API keys is hard to find
area: web
files:
  - apps/web/src/lib/layout/Sidebar.svelte
  - apps/web/src/routes/+layout.svelte
  - apps/web/src/lib/components/TweaksPanel.svelte
  - apps/web/src/routes/installningar/
---

## Problem

"Inställningar" in the sidebar opens the Tweaks panel (accent, density,
fonts). The page where keys are entered (`/installningar`: Eventor API key
and the other integrations) is only reached through a link near the bottom
of that panel. Jonas could not find either the panel's link or the page
(2026-10-09, entering the club's Eventor key on the local test server).

## Fix

Make the sidebar "Inställningar" go to `/installningar`, and put the
appearance tweaks there as a section (or a separate "Utseende" entry).
Whatever the layout, the Eventor key must be reachable in one step from
the menu, and the wizard's "Eventor saknar nyckel" state should link
straight to it.
