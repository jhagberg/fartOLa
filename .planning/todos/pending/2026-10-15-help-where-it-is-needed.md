---
created: 2026-10-15T09:00:00+02:00
title: Help where it is needed - visible format hints, a tap-to-open "?" for rules, no hover-only tooltips
area: web
files:
  - apps/web/src/lib/ui/Field.svelte
  - apps/web/src/lib/ui/Input.svelte
  - docs/decisions/0016-simple-clear-ui-not-meos-parity.md
---

Raised by the max-time field (2026-10-15): it now takes "150" or
"150:00", and the operator should not have to guess that.

Hover tooltips are the wrong tool for this. They do not show on a
touch screen (readout tablets, phones at the start), a keyboard or
screen-reader user often never reaches them, and they hide what the
operator needs to see. ADR-0016 says you always see what will happen.

- **Format and units: a visible hint under the field.** `Field.svelte`
  already has a `hint` prop. Link it to the input with
  `aria-describedby` (it is not linked today), and use it wherever a
  field takes a format: times, max time, intervals, card numbers, fees.
- **Why a rule applies: a "?" the operator taps** that opens a short
  explanation in place (a disclosure or a small popover with focus
  handling), with the TR number where a rule is behind it. Click or
  tap, not hover.
- **Hover `title` only for the extra**, never for the only copy of
  information (today: StatusPill, a few icon buttons).
- Audit: list the fields that take a format or apply a rule and have no
  hint, then add hints screen by screen.

Done when every format field shows its format, every rule refusal links
to its explanation, and the a11y e2e suite checks that hints are
announced (aria-describedby).

## Audit 2026-10-15 (fields with a format or a rule and no visible hint)

`Field.svelte` now links its hint to the input (aria-describedby).

Done (hint added, tested):

- Card number: walk-up, add runner, edit runner (`hint.cardNumber`).
- Birth year: walk-up (`hint.birthYear`).
- Competition date: Tävlingsinfo and Eventor import (`wiz.date.helper`).
- Missing start time: readout card (`hint.clock`), Saknade starter column header, label now says TT:MM:SS.
- Manual punch control: label says "kodnummer".

Already fine: max time (Tävlingsinfo, Lottning), fee fields (unit in label), manual finish time (format in label), Lottning interval/scale/start name/bibs (hint present), access code, wizard date (helper).

Still open (no hint, format or rule not visible):

- Settings: liveresultat competition id, ROC competition id and "börja från ROC-id" (number only, said only in the error).
- Wizard: Eventor competition id (the label is only the placeholder, which vanishes).
- Lottning: first start / restart (type=time, no 24 h hint), vacant slots, seed group per runner.
- Class kinds: age per class (number; what it means for the fee/class kind).
- Corrections: reason fields (max 500 chars, no counter).
- Walk-up / add runner: phone and email for hired cards (placeholder only).

## Progress 2026-10-15

`ui/HelpTip.svelte` (a "?" disclosure: aria-expanded, aria-controls, click or
tap, Escape closes, SOFT TR number first) is in use at: the max-time lock on
Tävlingsinfo and Lottning (TR 4.21.2) and the start-method rule on Lottning
(TR 7.4.2 / 7.4.3).

Rule refusals still to link to a HelpTip:

- Kontroll: the start-method rule (`prerace.startChoice.rule`, TR 7.4.2/7.4.3).
- Lottning: draw blocked until results are uploaded (`lottning.drawHint.*`, TR 7.4.1).
- Walk-up / edit runner: card already taken, card change that takes a result away.
- Readout: manual finish, time addition and manual punch refusals (TR 4.20.6).
- Eventor / liveresultat level rules in Inställningar (TR 7.7.1).

Hover `title` as the only copy: fixed for the control chips (visible hint) and
the accent swatches (visible name). `StatusPill` keeps its `title` as an extra;
its explanation is already in an `sr-only` description, so no change. The
active-competition name `title` only repeats the visible name.

Left for later: an a11y e2e that checks hints are announced; the format hints
listed under "Still open" above.
