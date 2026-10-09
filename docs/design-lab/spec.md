# Design lab: calmer, clearer UI (spec)

Status: draft for review, 2026-10-09. Branch `design/lab`. Nothing merges
until Jonas has reviewed the result.

## Goal

Make fartOLa's web UI calmer and clearer for its users, and fix the
visual and wording findings of the 2026-10-09 UI audit along the way.

**Users (decide every trade-off):** club volunteers aged 40–70 at the
readout table or secretariat, under time pressure, on a laptop
(1366×768) or tablet (820×1180), sometimes in bright sun or a dim tent.
They glance, they don't study. ADR-0016 wins every conflict with any
style guide or skill.

**Success:**

- Every text/background pair we touch meets ADR-0016 rule 7 (≥4.5:1,
  ≥7:1 for secondary text at readout), checked by a test.
- No status, punch state or warning is told by colour alone; each one
  also differs in lightness, shape/icon and words, and survives a
  deuteranopia, protanopia and greyscale simulation.
- No emoji or pictographic symbol used as an icon in the web UI.
- Every screen works at 1366×768 and 820×1180 without clipped controls.
- Before/after screenshots of every screen, and a short note tying each
  change to a user need or an ADR-0016 rule.

## Scope

**In:** design tokens, shared components, the app frame (sidebar,
drawer, top bar), every screen's visual design, the Swedish wording in
`sv.json` (audit X3, X10), replacing emoji/Unicode icons with Lucide
(todo `2026-10-06-svg-icons-instead-of-emoji`).

**Out (each becomes a todo file when work starts):** modal focus
management (X5), the `userMessage()` error helper (X8), undo toasts and
a shared "Senaste ändringar" list (X7, X11), previews and dry runs (I2,
P1, U1), connection-state banner (R1/S1), split analysis in readout
(best leg, lost time "bomtid"), `@axe-core/playwright` in e2e. Receipt
templates (ESC/POS) and `docs/demo` are not restyled.

**Not touched:** results logic, statuses, timing, the event log,
`packages/sportident`. No replay is needed; if a change turns out to
touch any of these, it is out of scope.

## Inputs

- UI audit 2026-10-09 (`fartOLa-docs/ui-audit-2026-10-09/REPORT.md`):
  findings X1–X11 and per screen.
- ui-ux-pro-max: its rule checklist (`references/quick-reference.md`)
  and pre-delivery checklist. Its generated palettes and fonts do not
  fit (they assume marketing sites) and are not used.
- taste-skill repo (Leonxlnx/taste-skill): only the parts that fit a
  dense admin tool. From redesign-skill the scan → diagnose → targeted
  fix workflow and its audit list; from minimalist-skill flat 1px
  borders, no shadows, dividers instead of boxed list rows, "colour only
  for meaning"; from taste-skill one accent, one radius scale, one theme,
  form/button contrast checks, plain microcopy (no "Oops", no
  exclamation marks, sentence case). Rejected: their grey secondary text
  without a contrast rule, airy spacing, scroll/entry animations, font
  and Lucide bans.
- MeOS (`/home/jonas/src/meos/code`) and SOFT's competition rules
  (2022-07-01) for punch and status vocabulary. OLA has no public
  documentation of its readout screen.

## Process

1. **Audit.** Check every screen (about 17) against the ui-ux-pro-max
   checklist, the taste rules above and ADR-0016; merge with the
   2026-10-09 findings into one list per screen in
   `docs/design-lab/audit.md`.
2. **Shared building blocks**, one commit each (order in "Plan of
   commits").
3. **Per-screen pass**, by how much the screen is used: Avläsning,
   Direktanmälan, Resultat, Lottning, Tävlingsinfo, then the rest. Fix
   what the building blocks did not.
4. **Deliver:** `docs/design-lab/README.md` (what changed and why, each
   tied to a rule), contrast table, before/after screenshots.

## Design direction: "quiet paper" (A)

Keep the warm paper background and forest-green identity; go flat and
use colour only where it means something. Chosen over "ink on white"
(loses the green identity) and "bright sun as default" (too harsh
indoors, makes the bright-sun mode pointless) after comparing the three
on the readout screen.

### Tokens (`apps/web/src/lib/tokens.css`)

Contrast is WCAG 2.x, computed from the oklch values.

| Token                                | Now → new                                       | Contrast                              |
| ------------------------------------ | ----------------------------------------------- | ------------------------------------- |
| `--fg-muted`                         | `oklch(0.5 0.01 240)` → `oklch(0.44 0.01 240)`  | 5.65 → 7.32 on `--bg`                 |
| `--fg-faint`                         | `oklch(0.68 0.01 240)` → `oklch(0.52 0.01 240)` | 2.72 → 5.19 on `--bg`                 |
| `--border-strong`                    | `oklch(0.82 0.005 90)` → `oklch(0.65 0.005 90)` | 1.75 → 3.23 on white (non-text, ≥3:1) |
| `--ok`                               | L 0.55 → 0.46                                   | pill text on `--ok-soft` 3.91 → 5.74  |
| `--dnf`                              | L 0.55 → 0.48                                   | pill text on `--dnf-soft` 4.26 → 5.76 |
| `--dns`, `--cancel`, `--max`, `--dq` | L 0.50–0.55 → 0.46                              | each ≥4.5 on its soft fill            |
| `--shadow-sm`, `--shadow-md`         | soft shadow → `0 0 0 1px var(--border)`         | –                                     |
| `--radius`, `--radius-lg`            | 8/12 → 6/8 px                                   | –                                     |
| new `--punch-*`                      | punch tile colours (below)                      | text ≥4.5 on each fill                |
| new `--icon-sm/md/lg`                | 16/20/24 px                                     | –                                     |
| new `--focus-ring`                   | `2px solid var(--fg)`, offset 2px               | ≥3:1 against adjacent colours         |

The exact values are verified by a contrast test (see Verification);
the table is regenerated from it for the README.

Rules that come with the tokens:

- **Green only for meaning:** OK status, correct punch tiles and the
  screen's main button. The card number, active nav row and selected history
  row become ink/grey instead of green.
- **Type:** numbers (times, card numbers, control codes) in mono with
  tabular figures; labels and status words in the UI font. Nothing that
  carries meaning below 14 px; body text 16 px.
- **Flat:** 1px borders instead of shadows; no card with both border
  and shadow. Lists use dividers, not boxed rows.
- **Bright-sun mode** (`.contrast-high`) stays; new tokens get matching
  values there, and its existing values are only re-checked.
- About 97 hard-coded colours in components move to tokens when their
  screen is passed. Receipt templates keep theirs (printed).

### Punch tiles (`components/PunchGrid.svelte`)

Each state differs by lightness, border/icon and a word; hue is a bonus.
Checked under deuteranopia, protanopia, tritanopia and greyscale
(Machado 2009 matrices). Today's red-vs-green tiles fail deuteranopia:
the missing control is nearly invisible.

| State                   | Look                                         | Icon             | Bottom line |
| ----------------------- | -------------------------------------------- | ---------------- | ----------- |
| Correct                 | light green fill, solid green border         | check            | split time  |
| Missing                 | **dark** red fill, white text                | x                | "saknas"    |
| Wrong order             | light amber fill, 3px amber border           | arrow-left-right | "fel ordn." |
| Extra                   | grey, 2px dashed border                      | plus             | "extra"     |
| Struck (voided control) | grey, 2px dotted border, code struck through | minus            | "struken"   |
| Finish                  | white, 3px ink border                        | –                | time        |

- Tile index top-left, icon top-right, control code centre (mono).
- **Size follows course length:** large (code 24 px, ~84 px min width,
  7 per row on laptop) up to 20 controls; medium (code 20 px, ~62 px,
  9–10 per row) above 20. No setting. Rationale: at 35 controls large
  tiles push the action buttons below the fold at 768 px.
- "fel ordn." must not wrap in medium tiles (shorter label size).
- Vocabulary matches MeOS where it exists ("saknas", "extra"); "fel
  ordn." is our addition (MeOS shows it as missing + extra). "struken"
  follows how event notices word a voided control (MeOS calls the
  control "Trasig"/"Försvunnen" and uses "struken" for a withdrawn
  entry).
- The Okabe–Ito palette was compared and rejected for tiles: its light
  fills make correct tiles nearly white for colour-blind users, and
  vermilion is too light to stand out in greyscale.

### Shared components

- **StatusPill:** label required and always `t('status.<code>')`
  (X3: no raw "PEND"/"DNF"), UI font 14 px, icon + text, text ≥4.5:1.
- **Button:** `size-sm` gets `min-height: var(--hit)` (44 px); the small
  custom controls listed in X6 too; ≥8 px between targets.
- **Focus:** one visible focus style from `--focus-ring` on every
  interactive element.
- **Card / Modal look:** flat, 1px border, radius from tokens. (Modal
  focus behaviour is out of scope.)
- **Readout action bar:** "Skriv ut kvitto", "Redigera", "Bryt" stay
  visible at the bottom of the readout card (sticky), so the main button
  never scrolls away (ADR-0016 rule 4).
- **Icons:** `@lucide/svelte` replaces `ui/Icon.svelte` and the about
  90 emoji/Unicode symbols. Decorative icons `aria-hidden`; icon-only
  buttons get `aria-label`. Symbols leave the i18n strings; components
  place the icon. Arrows in running prose may stay.

### Layout

- **Drawer below 1024 px** (today 720 px; X2): at 820 px the sidebar
  eats the readout column (≈170 px left for punch tiles). The hamburger
  and drawer already exist; only the breakpoint and the readout grid
  change.
- **Readout ≤1024 px:** history and "Okänd bricka" stack below the
  readout card.
- **Sidebar scrolls** (`overflow-y: auto`, X1) so "Inställningar" and
  the reader card are reachable at 1366×768.

### Wording (`apps/web/src/lib/i18n/sv.json`)

- X10 list from the audit: "Direktanmälan" instead of "Walk-up
  registrering", "Klass / Välj klass" instead of "Bana / Välj bana",
  "Spara anmälan" instead of "Spara och bind", one name format, one
  word per concept (löpare, bricka, Återbud), no developer words in the
  UI ("projektionen", "XSD-fel", "PEND", device paths, "Tweaks").
  Change texts, not keys (`walk.*` keys are reused elsewhere).
- **Status words (open question for Jonas):** SOFT's rules use "Ej
  godkänd" (wrong punch or retired), "Diskad", "Ej start" in result
  lists; MeOS uses "Felst.", "Utg.". Today we show "Felstämpling",
  "Bröt", "Disk.". Proposal: readout keeps the specific reason
  ("Felstämplad", "Utgått"), result lists show SOFT's "Ej godkänd" with
  the reason as secondary text; "Disk." → "Diskad".

## Verification

- `pnpm lint && pnpm typecheck && pnpm test`; `pnpm e2e` before the
  proposal. E2e tests that match status text ("DNF") change with X3;
  update them in the same commit.
- **Contrast test** (vitest, `apps/web`): parses `tokens.css` and
  asserts the listed text/background pairs (≥4.5:1, ≥7:1 for
  `--fg-muted` on `--bg`) and non-text pairs (≥3:1), for both the
  default and `.contrast-high` values.
- **Emoji check** in `scripts/check-compliance.mjs`: no codepoints in
  U+1F300–U+1FAFF or U+2600–U+27BF in `apps/web/src/**/*.svelte` or the
  i18n files (receipt templates excluded).
- **Screenshots:** a Playwright script seeds a throwaway competition from
  the synthetic e2e fixtures and shoots every screen at 1366×768 and
  820×1180, before and after. Screenshots go to
  `fartOLa-docs/design-lab-2026-10/`, not the main repo.
- **Colour-blind check:** the punch tiles and status pills rendered
  under the four simulations, attached to the README.

## Plan of commits (building blocks)

1. Tokens + contrast test.
2. Lucide + icon swap + emoji check (closes the icon todo).
3. StatusPill labels and type (X3, X4) + e2e text updates.
4. Button sizes and focus ring (X6).
5. Flat Card/Modal look.
6. PunchGrid states and size rule; readout sticky action bar.
7. Layout: drawer ≤1024 px, readout stacking, sidebar scroll (X1, X2).
8. Wording pass in `sv.json` (X10, status words after Jonas decides).

Then one commit per screen pass. Delivered as small PRs (tokens and
components; layout; wording; screens in groups), not one large one.

## Risks

- Visual changes can break e2e selectors that match text or classes.
- Darker status colours also change the bright-sun mode only if a token
  is shared; re-check `.contrast-high` after commit 1.
- A size rule tied to course length means tiles change size between
  classes; acceptable because a course stays the same all day.
