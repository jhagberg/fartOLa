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
(best leg, lost time "bomtid"). Receipt
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
  (edition 2026-07-01, per ADR-0011) for punch and status vocabulary. OLA has no public
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

| Token                                | Now → new                                       | Contrast                                                            |
| ------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------- |
| `--fg-muted`                         | `oklch(0.5 0.01 240)` → `oklch(0.42 0.01 240)`  | 5.65 → 7.97 on `--bg`, 7.52 on `--bg-sunken`, 7.09 on `--pend-soft` |
| `--fg-faint`                         | `oklch(0.68 0.01 240)` → `oklch(0.52 0.01 240)` | 2.72 → 5.19 on `--bg`                                               |
| `--border-strong`                    | `oklch(0.82 0.005 90)` → `oklch(0.62 0.005 90)` | 1.75 → 3.64 on white, 3.24 on `--bg-sunken` (non-text, ≥3:1)        |
| `--ok`                               | L 0.55 → 0.46                                   | pill text on `--ok-soft` 3.91 → 5.74                                |
| `--dnf`                              | L 0.55 → 0.48                                   | pill text on `--dnf-soft` 4.26 → 5.76                               |
| `--dns`, `--cancel`, `--max`, `--dq` | L 0.50–0.55 → 0.46                              | each ≥4.5 on its soft fill                                          |
| `--shadow-sm`, `--shadow-md`         | soft shadow → `0 0 0 1px var(--border)`         | –                                                                   |
| `--radius`, `--radius-lg`            | 8/12 → 6/8 px                                   | –                                                                   |
| new `--punch-*`                      | punch tile colours (below)                      | text ≥4.5 on each fill                                              |
| new `--icon-sm/md/lg`                | 16/20/24 px                                     | –                                                                   |
| new `--focus-ring`                   | `2px solid var(--fg)`, offset 2px               | ≥3:1 against adjacent colours                                       |

The exact values are verified by a contrast test (see Verification);
the table is regenerated from it for the README.

`.contrast-high` today overrides only `--ok`, `--mp`, `--dnf` and the
neutrals; `--dns`, `--dq`, `--cancel`, `--max` and every `*-soft` fill
are inherited, so darkening them at `:root` also changes bright-sun
mode (DNS/CANCEL pills 4.05 → 5.95 there; OK stays 6.75). That is
wanted. The commit lists the full effective palette of both modes, and
`StatusPill`'s hard-coded MP foreground (`oklch(0.45 0.12 70)`, 6.49)
becomes a token so bright-sun's `--mp` applies to it.

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

Exact colours and every text part of a tile (code, index, icon, split
or label), default → bright-sun:

| Token                        | Default                | Bright-sun | Pairs (default / bright-sun)                                        |
| ---------------------------- | ---------------------- | ---------- | ------------------------------------------------------------------- |
| `--punch-ok-fill`            | `oklch(0.93 0.06 150)` | `#d8eedd`  | code `--fg` 14.37 / 17.19, index `--fg-muted` 6.44 / 13.50          |
| `--punch-ok-line` (icon)     | `oklch(0.42 0.11 150)` | `#005f1a`  | 6.68 / 6.48 on the fill                                             |
| `--punch-miss-fill`          | `oklch(0.44 0.17 27)`  | `#8a0010`  | white code, index, icon, label 8.48 / 10.06                         |
| `--punch-order-fill`         | `oklch(0.93 0.08 85)`  | `#ffe9b3`  | code `--fg` 13.99 / 17.56, index 6.27 / 13.78                       |
| `--punch-order-line` (label) | `oklch(0.45 0.11 65)`  | `#5c3200`  | 6.19 / 9.19 on the fill                                             |
| extra, struck: `--bg-sunken` | –                      | `#f1f1f1`  | label/icon `--fg-muted` 7.52 / 14.59; border `--border-strong` 3.24 |

The amber `--mp` token is not reused for tile text (2.33 on its soft
fill). Every part is set explicitly per state, since `PunchGrid` colours
index and split separately from the tile.

- Tile index top-left, icon top-right, control code centre (mono).
- **What the tiles show** (`classifyPunches`, unchanged): one tile per
  course control in course order, then appended punches, then finish. A
  control punched out of order shows twice: "saknas" in its course slot
  and "fel ordn." appended (e.g. course 31-32-33, punches 31-33-32 →
  33 saknas, 33 fel ordn.). "Saknas" means not found at its place in the
  sequence; "correct" means found at its place. Without a course the
  tiles stay plain punches with no verdict (no check icon).
- **Size follows course length:** count the course's controls,
  including struck ones (appended punches and finish do not count).
  Large (code 24 px, ~84 px min width, 7 per row on laptop) up to 20;
  medium (code 20 px, ~62 px, 9–10 per row) above 20. Rationale: at 35
  controls large tiles push the action buttons below the fold at
  768 px.
- **Density setting:** `density = 'high'` keeps replacing tiles with
  `SplitsTable` (unchanged). Its `--fs-body: 15px` override goes (ADR-0016
  rule 7: body ≥16 px); low/med keep their other sizes. The size rule
  above applies to low and med.
- Minimum label size 14 px in large tiles, 13 px in medium; labels never
  wrap ("fel ordn." fits at 13 px in a 62 px tile; checked in the
  screenshot pass).
- Vocabulary matches MeOS where it exists ("saknas", "extra"); "fel
  ordn." is our addition (MeOS shows it as missing + extra). "struken"
  follows how event notices word a voided control (MeOS calls the
  control "Trasig"/"Försvunnen" and uses "struken" for a withdrawn
  entry).
- The Okabe–Ito palette was compared and rejected for tiles: its light
  fills make correct tiles nearly white for colour-blind users, and
  vermilion is too light to stand out in greyscale.

### Shared components

- **StatusPill:** a translated label is required (X3: no raw
  "PEND"/"DNF"). Readout and history pass `t('status.<code>')`;
  `ResultsTable` keeps passing the published SOFT label
  (`soft.status.*`: "Ej godkänd", "Deltagit"), as today. UI font 14 px,
  dot + text (the word is the non-colour cue; a per-status icon set adds
  little next to the word), text ≥4.5:1.
- **Button:** `size-sm` gets `min-height: var(--hit)` (44 px) and its
  label goes from 13 to 14 px; the small custom controls listed in X6
  too; ≥8 px between targets.
- **Focus:** one visible focus style on every interactive element: a
  2px `--fg` outline with a 2px offset, so the ring sits on the page
  background (≥7:1), not on the button fill (`--fg` on `--accent` is
  only 2.99).
- **Card / Modal look:** flat, 1px border, radius from tokens. The
  modal keeps `--shadow-lg` because it floats over a scrim. (Modal focus
  behaviour is out of scope.)
- **Readout action bar:** the punch area scrolls inside the card (max
  height = viewport minus top bar, header and action bar, floor 120 px)
  and the action bar sits below it, always in view (ADR-0016 rule 4).
  The card's `overflow: hidden` goes so the status picker, which now
  opens upwards, is never clipped. Checked with 35 controls at 1366×768
  and 820×1180 (no page scroll) and at 200 % zoom, 683×384 (page may
  scroll, every action reachable and unclipped).
- **Icons:** `@lucide/svelte` replaces `ui/Icon.svelte` and the about
  90 emoji/Unicode symbols. Decorative icons `aria-hidden`; icon-only
  buttons get `aria-label`. Symbols leave the i18n strings; components
  place the icon. Arrows in running prose may stay.

### Layout

- **Drawer below 1024 px** (today 720 px; X2): at 820 px the sidebar
  eats the readout column (≈170 px left for punch tiles). The hamburger
  and drawer already exist; `AppShell` and `TopBar` have separate
  720 px rules and both move to one shared breakpoint. The closed drawer
  gets `inert` so keyboard focus cannot land in it.
- **Readout stacks by available width, not only by viewport:** at
  1025 px the sidebar plus the 340 px rail leave ≈341 px for tiles (3
  large per row). The history rail moves below the readout card whenever
  the readout column would be narrower than about 600 px (container
  query on the readout area), which covers 820–1280 px.
- **Sidebar scrolls** (`overflow-y: auto`, X1) so "Inställningar" and
  the reader card are reachable at 1366×768.
- **Widths checked:** 1366×768, 1280×800, 1180×820 (tablet landscape),
  1025, 1024, 820×1180, and 1366×768 at 200 % zoom.

### Wording (`apps/web/src/lib/i18n/sv.json`)

- X10 list from the audit: "Direktanmälan" instead of "Walk-up
  registrering", "Klass / Välj klass" instead of "Bana / Välj bana",
  "Spara anmälan" instead of "Spara och bind", one name format, one
  word per concept (löpare, bricka, Återbud), no developer words in the
  UI ("projektionen", "XSD-fel", "PEND", device paths, "Tweaks").
- **Shared keys:** before changing a text, list every consumer of the
  key. Where the meaning differs, split the key instead of changing the
  shared text. Known case: `walk.save` is also the save button of the
  manual-status picker in `LatestReadCard`; "Spara anmälan" there would
  be wrong, so it gets its own key. `walk.*` is also used by
  `EditCompetitorModal` and `AddRunnerSheet`.
- **Status words (decided 2026-10-09):** results keep the published
  SOFT labels (`soft.status.*`, ADR-0011, rulebook 2026-07-01). The
  readout/history words (`status.*`) change from "Felstämpling",
  "Bröt", "Disk." to "Felstämplad", "Utgått", "Diskad".

## Verification

- `pnpm lint && pnpm typecheck && pnpm test`; `pnpm e2e` before the
  proposal. Known e2e dependencies, updated in the commit that breaks
  them: `.status.dnf` class selector (`readout.spec.ts:220`, keep the
  class), the literal "Bana" label (`walkup-eventor.spec.ts:132`,
  changes with X10). Each commit greps `tests/e2e` for the texts and
  classes it changes.
- **Contrast test** (vitest, `apps/web`): parses `tokens.css` and
  asserts every pair in the token and punch tables (text ≥4.5:1,
  `--fg-muted` ≥7:1 on `--bg`, `--bg-sunken`, `--pend-soft`; non-text
  ≥3:1), for both the default and `.contrast-high` values. Component
  literals that stay (if any) are listed in the test with a reason.
- **Axe in e2e** (`@axe-core/playwright`, required by ADR-0016; new dev
  dependency accepted 2026-10-09): run on the five main
  screens in both modes. Acceptance: no colour-contrast or target-size
  violation on surfaces this work changed; existing violations
  (unnamed dialogs, modal focus) are recorded in a todo, not fixed here.
- **Icon check:** a small separate script (not the SOFT matrix
  checker), run by `pnpm lint`: no pictographic codepoints
  (U+1F300–U+1FAFF, U+2600–U+27BF) and none of the icon-like symbols we
  use today (`↳`, `▢`, `☐`, `✎`, `★`, `▶`, `▾`) in
  `apps/web/src/**/*.svelte` or the i18n files. Arrows in prose (`→`)
  stay allowed. Receipt templates excluded.
- **Screenshots:** a Playwright script seeds a throwaway competition from
  the synthetic e2e fixtures and shoots every screen at 1366×768 and
  820×1180, before and after. Screenshots go to
  `fartOLa-docs/design-lab-2026-10/`, not the main repo.
- **Colour-blind check:** the punch tiles and status pills rendered
  under the four simulations, attached to the README.

## Plan of commits (building blocks)

1. Tokens + contrast test (both modes).
2. Lucide + icon swap + icon check (closes the icon todo).
3. StatusPill labels and type (X3, X4) + e2e text updates.
4. Button sizes and focus ring (X6).
5. Flat Card/Modal look.
6. PunchGrid states and size rule; readout sticky action bar.
7. Layout: drawer ≤1024 px, readout stacking, sidebar scroll (X1, X2).
8. Wording pass in `sv.json` (X10, status words).
9. Axe in e2e.

Then one commit per screen pass. Delivered as small PRs (tokens and
components; layout; wording; screens in groups), not one large one.

## Risks

- Visual changes can break e2e selectors that match text or classes
  (see Verification for the known ones).
- Tweaks combinations: accent (forest, blue, magenta, charcoal), font
  pair (4) and density (3) all stay supported. Acceptance checks cover
  the default (forest, Plex, med) and bright-sun; other accents get one
  contrast-test pass (button text on `--accent`), not screenshots.
- A size rule tied to course length means tiles change size between
  classes; acceptable because a course stays the same all day.

## Review log

- 2026-10-09, Codex (gpt-6.1-sol, xhigh), read-only review: 12 findings.
  Taken: published status labels kept in results, action bar
  structure, rendered-pair contrast and exact punch colours, full
  bright-sun palette, density behaviour, punch-state semantics, layout
  by available width plus boundary widths and `inert`, axe, shared i18n
  keys, rulebook edition, real e2e dependencies, separate icon check.
  Not taken: dropping the full audit (Jonas asked for a complete
  re-check with ui-ux-pro-max).
- 2026-10-09, Codex, read-only review of plan 1: 13 findings, all
  taken. Spec changes from it: status pills keep dot + text; the modal
  keeps its shadow; the readout card drops `overflow: hidden` and is
  checked at 200 % zoom (683×384).
