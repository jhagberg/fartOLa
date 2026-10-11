This describes the three plans of the design lab: plan 1 (the shared building blocks), plan 2 (the screen passes) and plan 3 (the remaining screens).

# Design lab, plan 1: building blocks

Spec: [spec.md](spec.md). Plan: [plan-1-building-blocks.md](plan-1-building-blocks.md). Rules: [ADR-0016](../decisions/0016-simple-clear-ui-not-meos-parity.md).

## What changed

- **Tokens.** Darker muted text, faint text, strong borders and status colours; amber text has its own token (`--mp-fg`); punch tiles have `--punch-*` tokens; flat shadows, radii 6/8. Green now means only something good: card number, active menu item and selected history row are ink or grey. Need: readable in sun and for colour-blind users. ADR-0016 rule 7.
- **Icons.** One icon set (Lucide) behind `ui/Icon.svelte` replaces about 25 emoji and symbol sites. `pnpm lint` fails on new ones. Need: icons that render the same on every device and carry meaning with text.
- **Status pills.** Words instead of codes (Felstämplad, Utgått, Diskad, ...) in 14 px sans. Results keep the SOFT labels. Need: a volunteer reads the status without knowing codes. Never colour alone.
- **Targets and focus.** Controls are 44 px high, labels 14 px, one ink focus ring everywhere. An e2e test checks target size. Need: gloves, tablet, outdoors. ADR-0016 rule 7.
- **Punch tiles.** State is shown by lightness, border, icon and word (saknas, fel ordn., extra, struken). Size follows course length (over 20 controls gives medium tiles). No verdict is shown without a course. Need: see at a glance what is wrong, also in grey scale.
- **Frame.** Menu is a drawer at 1024 px and below; a closed drawer is inert; the sidebar scrolls; the readout side rail stacks by available width. Need: tablet at the desk.
- **Readout actions.** The punch area scrolls inside the card and the action bar stays in view; the status picker opens up or down so it is never clipped. ADR-0016 rule 4: the main action is always reachable.
- **Wording.** Plain Swedish in `sv.json`, one word per concept; the save button text on the readout is split in two. Need: ADR-0016 plain language.
- **Axe checks.** Contrast and target-size checks run on five screens in both modes; amber warning text moved to `--mp-fg`.

## Contrast

Ratios from `PRINT_CONTRAST=1 pnpm --filter @fartola/web exec vitest run src/lib/tokens.contrast.test.ts`. "Floor" is the minimum the test demands. Bright sun is `.contrast-high` on `<html>`. The test also checks button text on the blue, magenta and charcoal accents (at least 4.5).

| Mode       | Text                 | On                   | Ratio | Floor |
| ---------- | -------------------- | -------------------- | ----- | ----- |
| default    | `--fg`               | `--bg`               | 16.33 | 7     |
| default    | `--fg-muted`         | `--bg`               | 7.97  | 7     |
| default    | `--fg-muted`         | `--bg-sunken`        | 7.52  | 7     |
| default    | `--fg-muted`         | `--pend-soft`        | 7.09  | 7     |
| default    | `--fg-faint`         | `--bg`               | 5.19  | 4.5   |
| default    | `--accent-fg`        | `--accent`           | 5.46  | 4.5   |
| default    | `--ok`               | `--ok-soft`          | 5.74  | 4.5   |
| default    | `--mp-fg`            | `--mp-soft`          | 6.49  | 4.5   |
| default    | `--dnf`              | `--dnf-soft`         | 5.76  | 4.5   |
| default    | `--dns`              | `--dns-soft`         | 5.95  | 4.5   |
| default    | `--dq`               | `--dq-soft`          | 6.41  | 4.5   |
| default    | `--cancel`           | `--cancel-soft`      | 5.95  | 4.5   |
| default    | `--max`              | `--max-soft`         | 6.02  | 4.5   |
| default    | `--fg`               | `--punch-ok-fill`    | 14.37 | 4.5   |
| default    | `--fg-muted`         | `--punch-ok-fill`    | 7.01  | 4.5   |
| default    | `--punch-ok-line`    | `--punch-ok-fill`    | 6.68  | 4.5   |
| default    | `--punch-miss-fg`    | `--punch-miss-fill`  | 8.48  | 4.5   |
| default    | `--fg`               | `--punch-order-fill` | 13.99 | 4.5   |
| default    | `--fg-muted`         | `--punch-order-fill` | 6.83  | 4.5   |
| default    | `--punch-order-line` | `--punch-order-fill` | 6.19  | 4.5   |
| default    | `--border-strong`    | `--bg-elev`          | 3.64  | 3     |
| default    | `--border-strong`    | `--bg-sunken`        | 3.24  | 3     |
| default    | `--fg`               | `--bg-elev`          | 17.29 | 3     |
| bright-sun | `--fg`               | `--bg`               | 21.00 | 7     |
| bright-sun | `--fg-muted`         | `--bg`               | 16.48 | 7     |
| bright-sun | `--fg-muted`         | `--bg-sunken`        | 14.59 | 7     |
| bright-sun | `--fg-muted`         | `--pend-soft`        | 13.83 | 7     |
| bright-sun | `--fg-faint`         | `--bg`               | 11.37 | 4.5   |
| bright-sun | `--accent-fg`        | `--accent`           | 9.18  | 4.5   |
| bright-sun | `--ok`               | `--ok-soft`          | 6.75  | 4.5   |
| bright-sun | `--mp-fg`            | `--mp-soft`          | 5.85  | 4.5   |
| bright-sun | `--dnf`              | `--dnf-soft`         | 8.06  | 4.5   |
| bright-sun | `--dns`              | `--dns-soft`         | 5.95  | 4.5   |
| bright-sun | `--dq`               | `--dq-soft`          | 6.41  | 4.5   |
| bright-sun | `--cancel`           | `--cancel-soft`      | 5.95  | 4.5   |
| bright-sun | `--max`              | `--max-soft`         | 6.02  | 4.5   |
| bright-sun | `--fg`               | `--punch-ok-fill`    | 17.19 | 4.5   |
| bright-sun | `--fg-muted`         | `--punch-ok-fill`    | 13.50 | 4.5   |
| bright-sun | `--punch-ok-line`    | `--punch-ok-fill`    | 6.48  | 4.5   |
| bright-sun | `--punch-miss-fg`    | `--punch-miss-fill`  | 10.06 | 4.5   |
| bright-sun | `--fg`               | `--punch-order-fill` | 17.56 | 4.5   |
| bright-sun | `--fg-muted`         | `--punch-order-fill` | 13.78 | 4.5   |
| bright-sun | `--punch-order-line` | `--punch-order-fill` | 9.19  | 4.5   |
| bright-sun | `--border-strong`    | `--bg-elev`          | 21.00 | 3     |
| bright-sun | `--border-strong`    | `--bg-sunken`        | 18.59 | 3     |
| bright-sun | `--fg`               | `--bg-elev`          | 21.00 | 3     |

## Screenshots

In the `fartOLa-docs` repo, folder `design-lab-2026-10/`: `before/` (start) and `after-plan-1/` (68 PNGs, 16 screens, laptop 1366x768 and tablet 820x1180, default and bright sun). Taken with `DESIGN_LAB_SHOTS=<folder> pnpm e2e design-lab-screens --workers=1`. The readout also has four colour-blind simulations in `after-plan-1/`:

- `readout-laptop-deut.png` (deuteranopia)
- `readout-laptop-prot.png` (protanopia)
- `readout-laptop-trit.png` (tritanopia)
- `readout-laptop-grey.png` (greyscale)

# Plan 2: screen passes

Plan: [plan-2-screen-passes.md](plan-2-screen-passes.md). Findings: [audit.md](audit.md) (each section has a "Plan 2" status line). Rules: [ADR-0016](../decisions/0016-simple-clear-ui-not-meos-parity.md).

## What changed, per screen

- **Frame.** Menu text is 14 px or more, the competition name wraps instead of being cut, the developer badges are gone, the drawer closes after you pick a competition, and the Eventor status updates when you save the key. Rule 7 (readable, big targets), rule 2 (nothing false on screen).
- **Registrering.** A disabled add button says why; a failed class load shows an error with a retry; the queue badge and toast are 14 px. Rules 1 and 3 (say what is missing, show failures).
- **Importera löpare.** A finished import ends with one main button, "Klar – visa anmälda". A failed link to Eventor is told apart from a failed import. Plain words, no file-format names. Rules 3 and 4 (clear next step).
- **Export.** Shows counts, one fetch, a clear message when files are not ready, and a next step after download. A stale preview can no longer enable the download. Rules 1 and 4.
- **Eventor.** Remembers the last publish, shows a failure with an icon and the word "Fel:", and drops IOF jargon. Rules 1 and 3.
- **Kvar i skogen.** Tells an empty read from "all are back", never says "all back" after a wrapped memory or a failed read, and shows when it was fetched. Rule 1 (never a false all-clear).
- **Tävlingar.** Each card is a link with a real status (Pågår, I dag, Kommande, Avslutad); a failed load shows a retry; "no competitions" appears only after the list loaded. Rules 1 and 3.
- **Ny tävling.** The wizard has two steps (the reader step is gone) and creates the competition from step 2. A bad date gets a hint, the draft survives a trip to the key field, and Eventor errors are plain. Rules 4 and 5 (fewer steps, plain words).
- **Inställningar.** Settings are grouped by competition and by installation, deep links work before data has loaded, and saves show a result. Rule 6 (one place per thing).
- **Hjälparinloggning.** A failed load is told apart from a wrong code, an empty list is explained, and the fields are 16 px. Rules 1 and 3.
- **Shared.** Buttons that are disabled give a hint, load errors have one component with a retry (`ui/LoadError`), `ui/Field` labels are 14 px, component focus outlines are gone so the one global ring applies, and every token a screen uses now exists.

## Gates added

- **`check-tokens`** (`scripts/check-tokens.mjs`, part of `pnpm lint`): fails on any `var(--x)` that is not defined in `tokens.css`. It removed `--err`, `--warn`, `--bg-hover` and `--bg-soft`.
- **Floor checks** (`tests/e2e/helpers/floors.ts`, `screen-floors.spec.ts`): every changed screen is measured at laptop and tablet size, in its busy states too (queue, errors, results). Visible text under 14 px or a target under 44 px fails the test. A check that measured nothing also fails.
- Axe runs on the same prepared states in both modes.

## Contrast, plan 2

Same command as above. Plan 2 added the pairs `--dnf` on `--bg`, `--fg-faint` on `--bg-sunken` and `--pend-soft`, `--fg-muted` on `--bg-elev`, and `--ok` and `--mp-fg` on `--bg`. Bright-sun `--mp-fg` is now darker than the default (6.93 on `--mp-soft`).

The bright-sun rows for `--dns`, `--dq`, `--cancel` and `--max` equal the default: they are not overridden in `.contrast-high`.

| Mode       | Text                 | On                   | Ratio | Floor |
| ---------- | -------------------- | -------------------- | ----- | ----- |
| default    | `--fg`               | `--bg`               | 16.33 | 7     |
| default    | `--fg-muted`         | `--bg`               | 7.97  | 7     |
| default    | `--fg-muted`         | `--bg-sunken`        | 7.52  | 7     |
| default    | `--fg-muted`         | `--pend-soft`        | 7.09  | 7     |
| default    | `--fg-faint`         | `--bg`               | 5.19  | 4.5   |
| default    | `--fg-faint`         | `--bg-sunken`        | 4.89  | 4.5   |
| default    | `--fg-faint`         | `--pend-soft`        | 4.61  | 4.5   |
| default    | `--fg-muted`         | `--bg-elev`          | 8.44  | 7     |
| default    | `--ok`               | `--bg`               | 6.36  | 4.5   |
| default    | `--mp-fg`            | `--bg`               | 7.18  | 4.5   |
| default    | `--dnf`              | `--bg`               | 6.79  | 4.5   |
| default    | `--accent-fg`        | `--accent`           | 5.46  | 4.5   |
| default    | `--ok`               | `--ok-soft`          | 5.74  | 4.5   |
| default    | `--mp-fg`            | `--mp-soft`          | 6.49  | 4.5   |
| default    | `--dnf`              | `--dnf-soft`         | 5.76  | 4.5   |
| default    | `--dns`              | `--dns-soft`         | 5.95  | 4.5   |
| default    | `--dq`               | `--dq-soft`          | 6.41  | 4.5   |
| default    | `--cancel`           | `--cancel-soft`      | 5.95  | 4.5   |
| default    | `--max`              | `--max-soft`         | 6.02  | 4.5   |
| default    | `--fg`               | `--punch-ok-fill`    | 14.37 | 4.5   |
| default    | `--fg-muted`         | `--punch-ok-fill`    | 7.01  | 4.5   |
| default    | `--punch-ok-line`    | `--punch-ok-fill`    | 6.68  | 4.5   |
| default    | `--punch-miss-fg`    | `--punch-miss-fill`  | 8.48  | 4.5   |
| default    | `--fg`               | `--punch-order-fill` | 13.99 | 4.5   |
| default    | `--fg-muted`         | `--punch-order-fill` | 6.83  | 4.5   |
| default    | `--punch-order-line` | `--punch-order-fill` | 6.19  | 4.5   |
| default    | `--border-strong`    | `--bg-elev`          | 3.64  | 3     |
| default    | `--border-strong`    | `--bg-sunken`        | 3.24  | 3     |
| default    | `--fg`               | `--bg-elev`          | 17.29 | 3     |
| bright-sun | `--fg`               | `--bg`               | 21.00 | 7     |
| bright-sun | `--fg-muted`         | `--bg`               | 16.48 | 7     |
| bright-sun | `--fg-muted`         | `--bg-sunken`        | 14.59 | 7     |
| bright-sun | `--fg-muted`         | `--pend-soft`        | 13.83 | 7     |
| bright-sun | `--fg-faint`         | `--bg`               | 11.37 | 4.5   |
| bright-sun | `--fg-faint`         | `--bg-sunken`        | 10.07 | 4.5   |
| bright-sun | `--fg-faint`         | `--pend-soft`        | 9.55  | 4.5   |
| bright-sun | `--fg-muted`         | `--bg-elev`          | 16.48 | 7     |
| bright-sun | `--ok`               | `--bg`               | 7.92  | 4.5   |
| bright-sun | `--mp-fg`            | `--bg`               | 8.13  | 4.5   |
| bright-sun | `--dnf`              | `--bg`               | 10.06 | 4.5   |
| bright-sun | `--accent-fg`        | `--accent`           | 9.18  | 4.5   |
| bright-sun | `--ok`               | `--ok-soft`          | 6.75  | 4.5   |
| bright-sun | `--mp-fg`            | `--mp-soft`          | 6.93  | 4.5   |
| bright-sun | `--dnf`              | `--dnf-soft`         | 8.06  | 4.5   |
| bright-sun | `--dns`              | `--dns-soft`         | 5.95  | 4.5   |
| bright-sun | `--dq`               | `--dq-soft`          | 6.41  | 4.5   |
| bright-sun | `--cancel`           | `--cancel-soft`      | 5.95  | 4.5   |
| bright-sun | `--max`              | `--max-soft`         | 6.02  | 4.5   |
| bright-sun | `--fg`               | `--punch-ok-fill`    | 17.19 | 4.5   |
| bright-sun | `--fg-muted`         | `--punch-ok-fill`    | 13.50 | 4.5   |
| bright-sun | `--punch-ok-line`    | `--punch-ok-fill`    | 6.48  | 4.5   |
| bright-sun | `--punch-miss-fg`    | `--punch-miss-fill`  | 10.06 | 4.5   |
| bright-sun | `--fg`               | `--punch-order-fill` | 17.56 | 4.5   |
| bright-sun | `--fg-muted`         | `--punch-order-fill` | 13.78 | 4.5   |
| bright-sun | `--punch-order-line` | `--punch-order-fill` | 9.19  | 4.5   |
| bright-sun | `--border-strong`    | `--bg-elev`          | 21.00 | 3     |
| bright-sun | `--border-strong`    | `--bg-sunken`        | 18.59 | 3     |
| bright-sun | `--fg`               | `--bg-elev`          | 21.00 | 3     |

## Follow-ups

- The Eventor search shows the organisation (for example "StorTuna OK") as the club. This is fixed in the edge (`apps/edge`), not in the web app.
- Walk-up search components still have their own `:focus` outlines, now redundant with the global ring. Delete them when that code is next touched (see the leftovers todo).
- The screens left after plan 2 (Avläsning, Direktanmälan, Resultat, Lottning, Tävlingsinfo, Anmälda, Hyrbrickor) were done in plan 3, below.
- Known axe violations: [the axe todo](../../.planning/todos/pending/2026-10-09-axe-known-violations.md).
- Not done on purpose: undo, modal focus, `userMessage()`, previews (see audit.md "Out of scope").

## Screenshots, plan 2

In `fartOLa-docs`, folder `design-lab-2026-10/after-plan-2/` (the same screens as plan 1, plus the wizard, helper login, speaker and kontroll screens). Taken with `DESIGN_LAB_SHOTS=<folder> pnpm exec playwright test tests/e2e/design-lab-screens.spec.ts --workers=1`.

# Plan 3: remaining screens

Plan: [plan-3-remaining-screens.md](plan-3-remaining-screens.md). Findings: [audit.md](audit.md) (each section has a "Plan 3" status line). Rules: [ADR-0016](../decisions/0016-simple-clear-ui-not-meos-parity.md).

## What changed, per screen

- **Avläsning.** Toasts stack, and identical re-reads are grouped into one. A new read takes over the card, and an older answer never replaces a newer one. Print and status feedback is per read, and no device paths show. Rules 1 and 2 (nothing false on screen, the newest read is what you see).
- **Direktanmälan.** Card conflicts are named in plain words, a saved toast confirms the entry, and targets are 44 px. Rules 3 and 7.
- **Resultat.** A failed load shows an error with a retry, the class is in the url, and the fullscreen view is readable at a distance. Rules 3 and 7.
- **Lottning.** The start method sits next to the class and says what it means; the stored max time is shown; undo replaces confirm. Class settings save one at a time, each showing "Sparat" or the error at the field. Kontroll links each class without start times here. Rules 1, 3 and 6.
- **Tävlingsinfo.** Everything saves on change and shows "Sparat" or the error at the field. Max time keeps its button, since it locks at the first start. Rule 3 (no unsaved edit mode).
- **Anmälda.** Filters stay in the url, errors are shown per field, and the edit dialog shows start, punches and splits. A half-typed edit is kept after a failure. Rules 1, 3 and 6.
- **Hyrbrickor.** "Markera återlämnad" gives a result line, each list has its own load error, the empty state explains itself, and text is 14 px. Rules 6 and 7.
- **Inställningar.** Late answers from the previous competition no longer land in the new one. Rule 2.
- **Shared.** `SavedNote` is the one inline "Sparat" or error note for fields that save on change; load and save errors give plain messages, not raw server text (the remaining places are in a todo).
- **Local run.** `scripts/run-local.sh` starts without developer tools; set `FARTOLA_DEV=1` to opt in.

## Not done on purpose

The "Fri start" button on Kontroll and the open-class start-punch default (they change which start a result runs from, so they need a replay), the punch log view, modal focus, undo lists and `userMessage()`. See the todos in `.planning/todos/pending/`.

## Screenshots, plan 3

In `fartOLa-docs`, folder `design-lab-2026-10/after-plan-3/` (the same screens as plan 2, plus Hyrbrickor and the opened Ändra dialog). Taken with `DESIGN_LAB_SHOTS=<folder> pnpm exec playwright test tests/e2e/design-lab-screens.spec.ts --workers=1`.
