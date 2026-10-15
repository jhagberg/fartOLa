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
