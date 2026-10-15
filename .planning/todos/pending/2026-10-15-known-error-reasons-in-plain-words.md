---
created: 2026-10-15T21:00:00+02:00
title: Known error reasons in plain words, and a consent toast stuck on a network error
area: web, errors
files:
  - apps/web/src/lib/api/userMessage.ts
  - apps/web/src/lib/components/ConsentConfirmationToast.svelte
---

1. `userMessage(e)` says "Något gick fel" for every server error. Some
   reasons are things the secretariat can act on and should see in plain
   words: a full disk (`disk_full`, SQLITE_FULL), a locked database that
   clears on retry (SQLITE_BUSY), a printer that is offline. Map the
   known ones to their own sentence ("Datorns disk är full – frigör plats
   och försök igen"), keep "Något gick fel" for the rest, and keep the
   raw error in the console. Done when each mapped reason has a test.
2. `ConsentConfirmationToast` has no catch for a thrown network error,
   so `pending` stays true and the toast hangs in "skickar". Reset it and
   show the network message. Found in passing on 2026-10-15.
