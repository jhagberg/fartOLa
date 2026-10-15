---
created: 2026-10-15T17:00:00+02:00
title: Raw server text still reaches the screen in a few places
area: web, errors
files:
  - apps/web/src/lib/api/userMessage.ts
---

The first round (`2026-10-11-raw-server-text-in-error-messages`, done)
added `userMessage(e)`: it logs the error and returns plain words. These
places still put the server's own text on screen:

- `WalkupModal.svelte`: `fieldError = (e as Error).message` (3 places)
- `PreviousResultsUpload.svelte`: `pursuitResults.err.failed {{error}}`
- `ConsentConfirmationToast.svelte`: `r.data.message ?? r.data.error`
- `ExportView.svelte`: `lastError`, `unreadMessage`
- `EventorPublishView.svelte`: `s.detail`
- `LatestReadCard.svelte`: the DNF error
- `RegistrationView.svelte`: `cancelErr`
- `KvarISkovenView.svelte`
- `ActiveCompetitionPill.svelte`, `StationCard.svelte`

Done when each shows plain Swedish (and English), the raw error goes to
the console, and a test per screen mocks a 500 with server text and finds
none of it on screen. Keep a known refusal's own message where the screen
already maps it (e.g. a 409 with a reason the operator can act on).
