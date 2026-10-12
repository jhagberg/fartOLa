---
created: 2026-10-12T00:00:00+02:00
title: Edit a hire card's contact, validate phone and e-mail, tel link only on phones
area: hyrbrickor
files:
  - apps/edge/src/routes/hiredCards.ts
  - apps/web/src/lib/screens/ActiveHyrbrickorView.svelte
  - apps/web/src/lib/screens/WalkupModal.svelte
  - apps/web/src/lib/components/HyrbrickaToast.svelte
---

## Problem

Found by Jonas in a local test, 2026-10-12.

- **No edit.** The contact for a hire card (name, phone, e-mail, note) is
  typed in Direktanmälan and cannot be changed afterwards. The hired-cards
  route has only the list and "return".
- **No format check.** The walk-up only requires phone or e-mail to be
  non-empty. "abc" is accepted as a phone number. No postal address is stored.
- **`tel:` on a desktop.** The phone number is a `tel:` link so a volunteer
  with the screen on a phone can call with one tap. On a laptop the link
  hands the number to whatever handles `tel:` (Zoom, Teams).

## Idea

- `PATCH …/hired-cards/:cardNumber` for the contact fields, and an "Ändra"
  on the Hyrbrickor row.
- A light check at the field: a phone number has at least 5 digits and only
  digits, spaces, `+`, `-`; an e-mail has one `@` with text on both sides.
- Render the number as a link only on touch screens
  (`matchMedia('(pointer: coarse)')`), plain text otherwise.
