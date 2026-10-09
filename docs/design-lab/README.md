This describes plan 1 of the design lab (the shared building blocks), on branch `design/lab`. Plan 2 (screen passes) is not done.

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

## Left for plan 2

- Per-screen findings: [audit.md](audit.md).
- Known axe violations: [the axe todo](../../.planning/todos/pending/2026-10-09-axe-known-violations.md).
