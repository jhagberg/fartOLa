# Design lab, plan 3: the remaining screens

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the audit findings on the seven screens that plan 2 left
to the feature tracks: Avläsning, Direktanmälan, Resultat, Lottning,
Tävlingsinfo, Anmälda and Hyrbrickor. Also close these todos:

- Tävlingsinfo's mixed save model;
- "Starttid räknas från" sits far from the class choice in Lottning;
- the Ändra dialog shows no start or punches;
- the settings competition-switch guard;
- the readout lines of the plan 1 leftovers.

**Architecture:**

- Task 1 adds one shared piece, `ui/SavedNote.svelte`, for the "save on
  change, say Sparat at the field" pattern of ADR-0016 rule 3, and
  tidies `ui/Field`.
- Then one task per screen, except two for the readout (the card and
  the frame), plus one for the Ändra dialog's start and punches.
- Every screen task adds prepared floor and axe entries. Plan 2's
  `tests/e2e/screen-floors.spec.ts` and `tests/e2e/a11y.spec.ts`
  already have per-entry `prepare` hooks.
- The last task updates the README and the screenshots.

**Tech Stack:** Svelte 5 + SvelteKit, TypeScript, vitest + jsdom,
Playwright, `@axe-core/playwright`, Lucide via `ui/Icon.svelte`.

**Spec:** `docs/design-lab/spec.md`. Findings: `docs/design-lab/audit.md`,
sections Avläsning (RO), Direktanmälan (WA), Resultat (RE), Lottning (LO),
Tävlingsinfo (TI), Anmälda (AN), Hyrbrickor (HY). Each row's state below
is as of `origin/main` 586e675, surveyed on 2026-10-11. Line numbers are
approximate, so find selectors by name.

## Global Constraints

- **Branch and commits:**
  - Work in `~/src/fartOLa-workdirs/design-lab`, branch
    `design-lab/plan-3` (from `origin/main`). Never push without Jonas's
    OK given in this session. One task, one commit (fix rounds add
    commits); stage only that task's files.
  - Conventional Commits, lowercase subject, about 70 characters, **no
    trailer**. lefthook runs prettier, eslint and commitlint. If
    pre-commit aborts with exit 129, there are unstaged tracked changes;
    never use a bare `git stash`.
  - New files start with `// Authored for fartola. Not ported from upstream.`
    (`<!-- … -->` in Svelte, same text).
- **Environment and gate:**
  - Node: `export PATH=$HOME/.nvm/versions/node/v26.10.0/bin:$PATH`.
  - Lint with `rtk proxy pnpm lint`. Plain `pnpm lint` is rewritten by
    an rtk hook into a filtered run.
  - Gate per task: `rtk proxy pnpm lint && pnpm typecheck && rtk proxy pnpm test`.
    Then the task's e2e specs plus `screen-floors.spec.ts` and
    `a11y.spec.ts`, always behind the shared lock:
    `flock /tmp/fartola-e2e.lock pnpm exec playwright test … --workers=2`.
  - Under load, rerun a failing test alone before calling it real.
    First-visit route waits use 20 s.
  - If the e2e server fails to migrate, delete `tests/e2e/.tmp.db*`.
- **ADR-0016 rule 7 floors:**
  - contrast: text at least 4.5:1, `--fg-muted` at least 7:1;
  - size: body text 16 px, nothing that carries meaning below 14 px;
  - targets at least 44 × 44 px;
  - never colour alone;
  - bright-sun mode passes the same floors.
- **Colours from tokens only.** `pnpm lint:tokens` gates undefined
  tokens. Use `--dnf`/`--dnf-soft` for errors, and
  `--mp`/`--mp-soft`/`--mp-fg` for warnings. Do not use literal
  fallbacks such as `var(--ok, #107a57)`, `#fff` or `rgba(…)`. Use
  `--accent-fg` for text on accent fills.
- **Buttons are `ui/Button.svelte`.** Hand-rolled `.btn` classes on
  these screens go away. EditCompetitorModal's `btn ghost/primary` have
  no styles at all today.
- **Plain Swedish:** one word per concept, sentence case, no
  exclamation marks, and no developer words. Device paths, "ESC/POS",
  "80mm thermal", "v0.1.0-phase1" and English strings in `sv.json` are
  all out. Before changing a shared key, grep every consumer; split it
  if the meanings differ. Every new key goes in sv and en.
- **Not touched:**
  - results logic, statuses, timing, the event log;
  - receipt templates (`components/receipt-templates/`), `docs/demo`,
    `packages/sportident`;
  - `apps/edge`, unless a task says so (none does).

  A screen may use an existing API in a new way, for example the
  Kontroll button in Task 8 sets a class's start method through the
  existing endpoint.

- **Before starting a task,** ask the coordinator session
  (`meos-capture-windows-build`) whether a live track is editing that
  task's files. If one is, do another task first.

## Lessons from plan 2 (binding for every task)

1. **A test that cannot fail proves nothing.**
   - Every floor and axe entry gets a `prepare` step that puts each
     changed element on screen: results, errors, toasts, popovers,
     queues. It asserts each one is visible before measuring.
   - Every behaviour test is shown failing (RED) on the old code first.
     The report says why it fails there.
   - Prove a floor entry by reverting one changed size and watching it
     fail.
2. **Safety and "is it done" messages must never claim more than the
   data shows.** This covers Kvar i skogen, save confirmations and result
   lines. While loading, after a failure or on partial data, say so; do
   not keep an old success on screen.
3. **Async state:**
   - Every load that can be retried resets its error and `loaded` flags
     at the start.
   - Every request that can be superseded is guarded by a generation
     counter or a latest-only check.
   - Every save that cannot apply must not leave a pending edit looking
     applied.
4. **e2e on a shared machine:**
   - Mocks go in before `goto` or reload.
   - A test waits for a concrete condition, never a fixed sleep.
   - Each test is short and independent. One test per screen in the
     a11y spec; serial mode only where needed.
5. Run a Codex adversarial review on the whole branch before the PRs:
   `node ~/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/codex-companion.mjs adversarial-review --background --base origin/main --scope branch "<focus>"`.

## Review Focus

1. **Readout under time pressure:**
   - The DNF/Utgått action gives a visible result.
   - "Skriv ut kvitto" says "Skriver ut…" and then the outcome, and
     never "Kvitto utskrivet" when nothing printed.
   - Keyboard shortcuts never fire inside a select, a dialog or with a
     modifier.

   → e2e in Task 2.

2. **Tävlingsinfo saves:**
   - Every field that saves on change shows "Sparat" or the error at
     that field.
   - A failed class-kind or fee save never looks saved.
   - Maxtid says before the first start that it locks then.

   → e2e in Task 9.

3. **Lottning:**
   - The stored per-class max time is shown when a class is chosen
     (LO-1 is a real bug).
   - Redraw is immediate, with undo in the history instead of a
     confirm.
   - The start method sits next to the class choice and explains
     itself.

   → e2e in Task 7.

4. **The Ändra dialog:** start, punches, splits and missing controls of
   the runner's latest read, with manual punches marked → e2e in Task 11.
5. **Bright sun on every changed screen:** prepared axe entries per
   screen and mode.

---

## File map

| File(s)                                                                                                                                                                                                                                                       | Task |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `screens/SettingsView.svelte`, `tests/e2e/settings-nav.spec.ts`                                                                                                                                                                                               | 0    |
| `ui/SavedNote.svelte` (new, + test), `ui/Field.svelte`                                                                                                                                                                                                        | 1    |
| `screens/ReadoutView.svelte`, `components/LatestReadCard.svelte`, `components/ReceiptMirror.svelte` (web part)                                                                                                                                                | 2    |
| `components/HistoryList.svelte`, `HistoryRow.svelte`, `MissingStartsPanel.svelte`, `ConsentConfirmationToast.svelte`, `HyrbrickaToast.svelte`, `layout/TopBar.svelte`, `StationCard.svelte`, `Sidebar.svelte`, `Clock.svelte`, `ActiveCompetitionPill.svelte` | 3    |
| `screens/WalkupModal.svelte` (+ `EnteredRunnerStep.svelte` if needed)                                                                                                                                                                                         | 4    |
| `screens/ResultsView.svelte`, `components/ResultsTable.svelte`, `ClassTabs.svelte`                                                                                                                                                                            | 5    |
| `screens/LottningView.svelte`, `components/PreviousResultsUpload.svelte`                                                                                                                                                                                      | 6, 7 |
| `screens/PreRaceCheckView.svelte`                                                                                                                                                                                                                             | 8    |
| `screens/CompetitionInfoView.svelte`, `components/ClassKindsPanel.svelte`, `FeesPanel.svelte`                                                                                                                                                                 | 9    |
| `screens/RunnersListView.svelte`, `components/AddRunnerSheet.svelte`, `EditCompetitorModal.svelte`                                                                                                                                                            | 10   |
| `components/EditCompetitorModal.svelte` (start and punches block)                                                                                                                                                                                             | 11   |
| `screens/ActiveHyrbrickorView.svelte`                                                                                                                                                                                                                         | 12   |
| `docs/design-lab/README.md`, `audit.md`, todos, screenshot harness                                                                                                                                                                                            | 13   |
| `i18n/sv.json`, `en.json`, `tests/e2e/screen-floors.spec.ts`, `a11y.spec.ts`, per-screen specs                                                                                                                                                                | 0–12 |

---

### Task 0: Settings, guard loads against a competition switch

Todo `2026-10-10-settings-competition-switch-guard.md`. A plan 2 screen,
done first because it can save into the wrong competition.

**Files:** `apps/web/src/lib/screens/SettingsView.svelte`,
`tests/e2e/settings-nav.spec.ts`.

- [ ] **Step 1 (RED):** add an e2e test.
  1. Pin competition A as active.
  2. Delay A's Liveresultat GET by 1.5 s.
  3. Switch the active competition to B (route the active-competition
     GET to B) before A's response arrives.
  4. Assert that the Liveresultat id field and the helper-code list show
     B's data, not A's.
  5. Type an id for A, switch to B, click "Spara och starta". Assert
     that the PUT goes to B's URL with B's draft, and that A's typed id
     is not sent.

  Run it and see it fail.

- [ ] **Step 2:** guard Liveresultat and helper-code loads the way the
      radio card's `latestOnly()` does: drop a response whose competition is
      no longer current. Blank `liveId`, `livePwd` and `codeErr` when the
      competition changes.
- [ ] **Step 3 (GREEN):** run the spec and the gate.
- [ ] **Step 4:** commit `fix(settings): ignore late loads and drafts from the previous competition`.

---

### Task 1: Shared, `SavedNote` and `Field` colours

**Files:** create `apps/web/src/lib/ui/SavedNote.svelte` and
`apps/web/src/lib/ui/SavedNote.test.ts`; modify `ui/Field.svelte`,
`i18n/sv.json`, `en.json`.

**Interfaces:**

- Produces `<SavedNote state={'idle'|'saving'|'saved'|'error'} error?={string} />`.
  It renders inline next to a field:
  - `saving`: "Sparar…";
  - `saved`: a check icon plus "Sparat", fading after 3 s;
  - `error`: an alert icon plus the error text, which stays until the
    next change.

  The wrapper is `role="status"` for saving and saved, and
  `role="alert"` for error. Keys: `common.saving` "Sparar…" / "Saving…",
  `common.saved` "Sparat" / "Saved".

- Produces a helper `createSaveState()` in `ui/saveState.svelte.ts`.
  It holds the state and `run(promise)`: saving → saved, or error. A
  newer `run` supersedes an older one (generation counter), so a slow
  failure can never overwrite a newer success.

- [ ] **Step 1 (RED):** unit tests for `SavedNote` (all four states,
      roles, texts) and `createSaveState`. The superseding case: run A
      (slow, rejects), then run B (fast, resolves). The final state is
      `saved`.
- [ ] **Step 2:** implement both.
  - Saved text uses `--ok` with the icon. The error uses `--dnf` with
    the icon and the word.
  - Font is `--fs-label`.
- [ ] **Step 3:** `ui/Field.svelte` (audit LO-9): the label colour
      becomes `--fg`, and the hint becomes `--fg-muted` (not `--fg-faint`).
- [ ] **Step 4 (GREEN)** and commit `feat(web): an inline saved note for fields that save on change`.

---

## Screen tasks: common steps

Every screen task (2–12) follows the same steps:

1. **RED:**
   - Add the screen's prepared entry or entries to `SCREENS` in
     `tests/e2e/screen-floors.spec.ts` and to `tests/e2e/a11y.spec.ts`.
     The `prepare` puts every changed element on screen and asserts it
     is visible.
   - Write the task's behaviour tests.
   - Run them and see them fail, with the reason each fails.
2. **Fix** the rows in the task's table.
3. **GREEN:**
   - Run the task's specs, the floors and the a11y spec, then the gate.
   - Grep `tests/e2e` for every text and class you changed, and update
     the matches in the same commit.
4. **Commit** once, with the task's message.

"14 px" means `var(--fs-label)` and "16 px" means `var(--fs-body)`.
Seeded data comes from `tests/e2e/helpers/seed.ts` (`seedCompetition`,
`simulateRead`, `voidControl`). Use synthetic cards 7501853 (Anna
Andersson H21) and 1428824 (Cia Carlsson D21).

---

### Task 2: Avläsning, the card and its actions

**Files:** `screens/ReadoutView.svelte`, `components/LatestReadCard.svelte`,
`components/ReceiptMirror.svelte`, i18n, the readout specs
(`readout.spec.ts`, `readout-long-course.spec.ts`), floors, a11y.

**Behaviour tests:**

- **Print feedback.** With the print endpoint mocked slow and then OK:
  "Skriver ut…" shows, then "Kvittot skrivs ut". With it mocked failing:
  "Utskriften misslyckades" plus a retry button, and no "Kvitto
  utskrivet". With no read: "Skriv ut kvitto" is disabled with a hint.
- **Shortcuts.** P inside a focused `<select>`, inside an open dialog,
  and with Ctrl or Meta does not print.
- **DNF.** Choosing Utgått closes the popover, and a toast says "{namn}:
  Utgått". The button reads "Utgått…".
- **A new read while pinned.** When an older read is pinned and a new
  read arrives, the cue bar "Du tittar på en äldre avläsning. Visa
  senaste" shows. The simulate button does not render unless the edge
  reports dev mode.

**Edits:**

| Row          | Change                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RO-1         | Print states. Keys: `ro.print.busy` "Skriver ut…", `ro.print.ok` "Kvittot skrivs ut", `ro.print.failed` "Utskriften misslyckades" with the raw reason in `<details>`, and a retry button. The ReceiptMirror head shows "Kvitto" (not "Kvitto utskrivet") until a print succeeded. Remove the hard-coded failure string.                                                                     |
| RO-2         | `onKeydown` ignores `select`, `[contenteditable]`, anything inside `[aria-modal="true"]` and any event with Ctrl, Meta or Alt.                                                                                                                                                                                                                                                              |
| RO-3         | Drop "Star TSP143 · /dev/usb/lp0" and "80mm thermal · ESC/POS". Show the printer's name from settings if one exists, otherwise nothing. `.faint` and `.meta` become 14 px.                                                                                                                                                                                                                  |
| RO-4         | Render the simulate button only when the edge says dev mode. Use the existing `fartola_dev` flag the Eventor status already carries; read how SettingsView gets it.                                                                                                                                                                                                                         |
| RO-6         | `ro.dnf` "Utgått…" (en "Did not finish…"). After `confirmDnf`, show a toast "{{name}}: Utgått" (`ro.dnf.done`). The "Bröt loppet" tooltip becomes "Utgått" (one word per concept).                                                                                                                                                                                                          |
| RO-9         | Cue bar when pinned: `ro.pinned` "Du tittar på en äldre avläsning." with a button `ro.pinned.latest` "Visa senaste".                                                                                                                                                                                                                                                                        |
| RO-12        | `.empty-sub` and `.place` 14 px.                                                                                                                                                                                                                                                                                                                                                            |
| RO-13        | `.mono` 14 px, `.auto-toggle .lbl` 14 px, `.faint` 14 px, `.pending-card .badge` 14 px. The pending count uses `--fg` with the words, not `--dnf` red (a count of waiting items is not an error).                                                                                                                                                                                           |
| RO-14, RO-15 | Auto-print switch: a 44 px row with the words "På"/"Av" next to it, a thumb on `--accent-fg` (no `#fff`), and the whole label clickable.                                                                                                                                                                                                                                                    |
| RO-26        | ReceiptMirror `.head .meta` 14 px. "AUTO" becomes `t('ro.receipt.auto')` "Auto" at 14 px.                                                                                                                                                                                                                                                                                                   |
| RO-27        | The flash on new reads uses a neutral highlight (`--bg-sunken` plus a 3 px `--fg` left edge), not the green `--accent-soft`. The same applies in `HistoryRow` (Task 3 covers that file; leave a note).                                                                                                                                                                                      |
| Leftovers    | Remove the `LatestReadCard .dnf-pop` double edge (border plus a `--shadow-md` ring; keep one), `.blink mono` and the `.btn.lg` 13–17 px rules. Move LatestReadCard's hand-rolled `.btn` to `<Button>`, keeping the existing `data-testid`s. `ro.missingStart.hint` in sv: "Check {{check}} + {{offset}} → {{suggested}}" becomes "Checkstämpling {{check}} + {{offset}} ger {{suggested}}". |

**Commit:** `fix(readout): clear print and dnf feedback, safe shortcuts, no device paths`

---

### Task 3: Avläsning, the frame, history, side panels and toasts

**Files:**

- `components/HistoryList.svelte`, `HistoryRow.svelte`,
  `MissingStartsPanel.svelte`, `ConsentConfirmationToast.svelte`,
  `HyrbrickaToast.svelte`
- `layout/TopBar.svelte`, `StationCard.svelte`, `Sidebar.svelte`,
  `Clock.svelte`, `ActiveCompetitionPill.svelte`
- `screens/ReadoutView.svelte` (only the toast container), i18n, specs

**Behaviour tests:**

- **Toasts.** With the consent toast and the hire-card toast showing
  together, they stack without overlapping: both are fully visible and
  their bounding boxes do not intersect.
- **Re-reads.** Two reads of the same card show one history row with
  "2 avläsningar". Expanding it shows both.
- **Missing starts.**
  - A failed first load shows the error with "Försök igen". Today it is
    hidden.
  - "Sätt alla (N)" carries the count, and says "Sätter…" while busy.
  - A result line follows: "N starttider satta."

**Edits:**

| Row     | Change                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RO-5    | TopBar and StationCard say "Läsare: Ansluten / Frånkopplad / Söker…" (subject first, `ro.reader`). StationCard drops the defaults 'BSM7-USB', '/dev/ttyUSB0', 38400 and shows the port only when the bridge reports one.                                                                                                                                                                                                                       |
| RO-7    | MissingStartsPanel: `.start` and `.btn` become 44 px with `<Button>`; `th` 14 px sentence case. `ms.setAll` "Sätt alla ({{n}})", a busy label, and a result line `ms.done` "{{n}} starttider satta.". `ms.stats` "median {{median}}, medel {{mean}} ({{n}} löpare)". Render the error outside the data branch, with `LoadError`.                                                                                                               |
| RO-8    | ReadoutView renders both toasts inside one `.toast-stack` (fixed bottom-right, column, gap 8 px, newest on top), so they never overlap. Consent `.body` and `.err` 14 px; hire-card `.card-line` and `.contact .row` 14 px. Keys: `consent.dismiss` "Avfärda" becomes "Senare" (it does not refuse consent); `readout.hyrbricka.returned` "Returnerad" becomes "Markera återlämnad" (one word per concept with Hyrbrickor). All buttons 44 px. |
| RO-10   | HistoryList groups consecutive reads of the same card into one row: newest data plus "{{n}} avläsningar" (`ro.history.reads`), with a toggle to expand the earlier ones.                                                                                                                                                                                                                                                                       |
| RO-11   | `.hist-row`, `.h-card`, `.h-class` and HistoryList `.badge` 14 px.                                                                                                                                                                                                                                                                                                                                                                             |
| RO-19   | ActiveCompetitionPill: drop the `--shadow-lg` literal fallback. The selected row gets a 3 px `--fg` left edge besides the check icon.                                                                                                                                                                                                                                                                                                          |
| RO-23   | StationCard title in sentence case, no tracking.                                                                                                                                                                                                                                                                                                                                                                                               |
| RO-24   | The version string leaves the sidebar footer. Show it on the settings page under Utseende as "Version {{v}}" (`settings.version`).                                                                                                                                                                                                                                                                                                             |
| RO-25   | Clock: drop the "TID" caption. The time itself is the label; add `aria-label` "Tävlingstid".                                                                                                                                                                                                                                                                                                                                                   |
| RO-27   | HistoryRow flash: the neutral highlight from Task 2.                                                                                                                                                                                                                                                                                                                                                                                           |
| Wording | `tw.contrast` sv "Hög kontrast (bright sun)" becomes "Stark kontrast för solljus".                                                                                                                                                                                                                                                                                                                                                             |

**Commit:** `fix(readout): stacked toasts, grouped re-reads and a plainer frame`

---

### Task 4: Direktanmälan

**Files:** `screens/WalkupModal.svelte` (and `EnteredRunnerStep.svelte`
if a row lands there), i18n, `walkup.spec.ts`, `registration-queue.spec.ts`,
floors and a11y (the walk-up modal entry on the readout, and on
Registrering, where Task 4 of plan 2 made it inert for the registration
floor; give it its own entry here).

**Behaviour tests:**

- **Save gives a result.** After "Spara anmälan" the modal closes and a
  toast says "{{name}} anmäld i {{class}}" (`walk.saved`).
- **A taken card.** It names the holder: "Brickan {{card}} används av
  {{name}} ({{class}})". A non-card 409 shows its own message, not
  "Nätverksfel".
- **Consent row.** It is 44 px high with a 24 px box. Clicking the text
  ticks it.

**Edits:**

| Row         | Change                                                                                                                                                                                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WA-1        | A toast after a successful save, in ReadoutView and RegistrationView (they own the modal's `onClose(saved)`). Pass the saved name and class, or read them back.                                                                                                |
| WA-3        | `walk.err.cardTaken` names the holder (the 409 body carries the competitor; check the edge response). Other 409 codes map to `walk.err.conflict` "Kunde inte spara: {{reason}}".                                                                               |
| WA-4        | Consent: a 24 px checkbox, a 44 px label row, text 16 px.                                                                                                                                                                                                      |
| WA-5        | `.desc`, `.consent-row`, `.err`, `.info`, `.banner`, `.net-err-body`, `.alternatives-chip`, `.alternatives-picker-title`, `.alt-name` and `.alt-club` become 14 px (16 px where the text is body copy: `.desc`, `.consent-row`). `.discard-msg` becomes 16 px. |
| WA-6        | The alternatives chip and candidates are 44 px targets. `walk.alternatives.chip` "+{{n}} andra" becomes "{{n}} andra förslag".                                                                                                                                 |
| WA-7        | The modal shell uses `ui/Modal`, or at least `var(--scrim)`, `var(--radius-lg)` and no backdrop blur. Prefer `ui/Modal` if its props cover the walk-up's header and footer. Otherwise use the tokens only, and say why in the report.                          |
| WA-9, WA-11 | `#fff` becomes `var(--accent-fg)` or `var(--bg-elev)` (no fallbacks).                                                                                                                                                                                          |
| WA-10       | Drop the literal fallbacks in the alternatives chip; use `--mp-soft`, `--mp` and `--mp-fg`.                                                                                                                                                                    |

**Commit:** `fix(walkup): a saved toast, named card conflicts and 44 px targets`

---

### Task 5: Resultat

**Files:** `screens/ResultsView.svelte`, `components/ResultsTable.svelte`,
`components/ClassTabs.svelte`, i18n, `results.spec.ts`, floors, a11y.

**Behaviour tests:**

- **Load error.** A failed results load shows `LoadError`, "Kunde inte
  hämta resultaten." plus a retry. An empty class shows `res.empty`
  "Inga löpare i klassen ännu."
- **Class in the URL.** `?klass=<id>` opens that class tab, and choosing
  a tab updates the URL (`replaceState`), so a reload keeps the class.
- **Status in fullscreen.** The status column in full-screen mode still
  shows the published status word.

**Edits:**

| Row  | Change                                                                                                                                                               |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RE-1 | As in the tests. Drop the hard-coded "Inga deltagare ännu.".                                                                                                         |
| RE-2 | As in the tests.                                                                                                                                                     |
| RE-3 | `th` 14 px sentence case without tracking. Pending rows use `--fg-muted`, not `--fg-faint`, and say "Ej i mål" in the status cell.                                   |
| RE-4 | `.live`, `.mono`, `.updated`, `.finished` and `.comp-meta` 14 px, `--fg-muted`.                                                                                      |
| RE-5 | ClassTabs `.count` 14 px, `--fg-muted`.                                                                                                                              |
| RE-6 | Add a `.res-fs .status` rule so the status shows in fullscreen. A new row's highlight is neutral (as RO-27), not green.                                              |
| RE-7 | ResultsTable on narrow screens (≤ 1024 px): name and club wrap (`overflow-wrap: anywhere`); time and place stay `nowrap`; padding 10 px 12 px.                       |
| RE-8 | The fullscreen button becomes `<Button variant="secondary">` with Lucide `maximize`/`minimize` and the words "Helskärm" / "Avsluta helskärm". The `⤢`/`⤓` glyphs go. |

**Commit:** `fix(results): load errors, class in the url and readable fullscreen`

---

### Task 6: Lottning, the form and the start list

**Files:** `screens/LottningView.svelte`, `components/PreviousResultsUpload.svelte`,
i18n, `lottning.spec.ts`, floors, a11y.

**Behaviour tests:**

- **Max time per class (LO-1, bug).** Set a class's max time, reload,
  choose the class: the field shows the stored value. Saving shows
  `SavedNote`. Clearing it shows "Ingen avvikande maxtid".
- **Redraw without a confirm (LO-2).** "Lotta om" draws at once. The
  history shows the draw with "Ångra" (StartTimeHistory already exists),
  and undo restores the old times. No `.redraw-confirm` exists.
- **Pursuit file chosen but not read (LO-4).** Lotta is disabled with
  the hint "Resultatlistan läses in" until the upload finished.
- **Row edit (LO-6).** Enter saves, Escape cancels, and an error shows
  in the row.

**Edits:**

| Row   | Change                                                                                                                                                                                                                                                           |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LO-1  | Load the class's stored max time into the field when the class changes. The save uses `SavedNote`.                                                                                                                                                               |
| LO-2  | Remove `redrawConfirmOpen` and the `.redraw-confirm` block, and keep `lottning.redrawConfirm` only if something else uses it (grep). After a redraw, show "Lottat. Ångra i historiken nedan." with a link scrolling to the history entry.                        |
| LO-3  | `.lottning` max-width becomes 960 px with two columns at ≥ 1200 px: the form left, the start list right. The rarely used fields (seeding, pursuit, bibs, start name) go in a `<details>` "Fler val". `.draw-btn-row` is sticky at the bottom of the form column. |
| LO-4  | As in the tests. "Läser in filen…" shows while it reads.                                                                                                                                                                                                         |
| LO-5  | Load errors show `LoadError`. The empty hint `lottning.emptyHint` reads "Inga starttider ännu. Välj klass och tryck Lotta." (no "Lotta → 0 löpare lottade").                                                                                                     |
| LO-6  | As in the tests.                                                                                                                                                                                                                                                 |
| LO-7  | Legends and `.err` 14 px; `.start-table th` 14 px.                                                                                                                                                                                                               |
| LO-10 | The kind line becomes two short lines: "Klasstyp: {{kind}}" and, under it, "{{status}} · Ändra på Tävlingsinfo" as a link. No nested parentheses.                                                                                                                |

**Commit:** `fix(lottning): show the stored max time, undo instead of confirm, a calmer form`

---

### Task 7: Lottning, the start method next to the class

Todo `2026-10-10-open-classes-start-punch-by-default.md`, part 3 (the
UI move). Its part 1 (the default for open classes) changes timing and
is not in this plan.

**Files:** `screens/LottningView.svelte`, i18n, `lottning.spec.ts`.

**Behaviour tests:**

- **Placement.** Right after choosing a class, the "Starttid räknas
  från" select is the first control after the class select, before draw
  mode.
- **Explanation per class kind.**
  - For an open class or inskolning (kind `oppen` or `inskolning`) the
    help says "Öppen klass: löparna startar när de vill och stämplar
    start. Välj Startstämpling om klassen inte ska lottas."
  - For an age class at nivå 1–3 it says "Lottad start enligt
    tävlingsregler (starttid)."
- **Feedback.** Changing it shows `SavedNote`; today it saves silently.

**Edits:**

- Move the start-method `<Field>` and `<Select data-testid="lottning-start-method">`
  directly under the class select.
- Add `lottning.startMethod.help.open`, `.help.ranked` and
  `.help.default` (sv and en). Choose one by the class kind and level
  the view already has.
- Wrap `saveClassFlag` for the start method in `createSaveState`.

**Commit:** `feat(lottning): put the start method next to the class and explain it`

---

### Task 8: Kontroll, free start for open classes

Todo `2026-10-10-open-classes-start-punch-by-default.md`, part 2.

**Files:** `screens/PreRaceCheckView.svelte`, i18n, `prerace.spec.ts`,
floors and a11y (Kontroll has no entry yet).

**Behaviour tests:**

- **Free start button.** On Kontroll, a class of kind `oppen` or
  `inskolning` listed under "utan starttid" has a button "Fri start
  (startstämpling)". Clicking it sets the class start method to
  `start_punch` through the existing class-flag endpoint (find the call
  LottningView uses), and the class leaves the list on reload.
- **Lottning link.** Each listed class has a link "Lotta klassen" to
  `/competition/<id>/lottning?klass=<classId>`. LottningView reads
  `?klass=` to preselect; add that if it is missing.

**Edits:** as in the tests. The button is `<Button variant="secondary">`.
The result shows with `SavedNote`.

**Commit:** `feat(prerace): set free start for open classes from the check page`

---

### Task 9: Tävlingsinfo, one save model

Todo `2026-10-10-competition-info-one-save-model.md` and audit TI-1…TI-7.
ADR-0016 rule 3: save on change everywhere, and say "Sparat" or the
error at the field. Maxtid keeps an explicit button, because it locks
at the first start (TR 4.21.2), and says so beforehand.

**Files:** `screens/CompetitionInfoView.svelte`,
`components/ClassKindsPanel.svelte`, `components/FeesPanel.svelte`, i18n,
`CompetitionInfoView.test.ts`, a new `tests/e2e/competition-info.spec.ts`,
floors, a11y.

**Behaviour tests:**

- **Details save on change.** Changing nivå (select) saves at once and
  shows "Sparat" next to it. Text fields (name) save on blur or Enter.
  A failed save (mock 500) shows the error next to that field. No
  "Spara" button remains in the details card.
- **Class kinds and fees.**
  - Changing a class kind or a fee shows "Sparat" at that row.
  - A failed save (mock 500) shows the error at that row, and the
    control shows the server's last saved value again, not the failed
    edit.
- **Maxtid.** Before the first start, the field reads "Låses när
  tävlingen startar (TR 4.21.2)." After the start it is read-only, with
  "Låst sedan första start." It keeps its Spara.
- **Voiding a control (TI-1).**
  - The chip has a strike icon and the word "struken" when voided.
  - The chip's title names the code: "Stryk kontroll 53".
  - The action shows a result line "Kontroll 53 struken. Ångra" (undo
    calls the same toggle).
  - An error shows inline, not as a page error.

**Edits:**

| Row         | Change                                                                                                                                                                                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TI-1        | As in the tests. Errors no longer go to `loadError`.                                                                                                                                                                                                                       |
| TI-2 / todo | Details card: save on change per field with `createSaveState` + `SavedNote`, and drop the card's Spara and the `dirty` logic. ClassKindsPanel and FeesPanel: each row's save goes through a save state with `SavedNote`, and a failure rolls back to the last saved value. |
| TI-3        | The max time rule text becomes a 14 px `--fg-muted` hint. The long rule goes in `<details>` "Visa regeltext".                                                                                                                                                              |
| TI-4        | The date field becomes the text input with the ISO pattern the wizard uses (`wizardDate.ts` `validDate`), so it shows 2026-10-09, not the browser's locale format.                                                                                                         |
| TI-5        | `.info-head .hint`, `.err`, `.badge`, `.ctrl-idx` and `.toast` 14 px; remove the toast, since `SavedNote` replaces it.                                                                                                                                                     |
| TI-6        | `.head-btn` becomes `<Button size="sm">` (44 px). Checkboxes 24 px in 44 px rows.                                                                                                                                                                                          |
| TI-7        | Auto-print: the checkbox before its label, in its own full-width row.                                                                                                                                                                                                      |
| `.btn`      | The page's hand-rolled `.btn` becomes `<Button>`.                                                                                                                                                                                                                          |

**Commit:** `feat(info): save on change with the result at each field`

---

### Task 10: Anmälda

**Files:** `screens/RunnersListView.svelte`, `components/AddRunnerSheet.svelte`,
`components/EditCompetitorModal.svelte` (form part only), i18n, the
runners specs, floors, a11y (Anmälda has no entry yet).

**Behaviour tests:**

- **Edit gives a result.** Saving in Ändra closes the dialog, shows a
  toast "{{name}} sparad", scrolls to the row and highlights it for
  2 s. A withdrawal (Återbud) mutes the row and shows "Återbud" on it.
- **Per-field errors.** A missing name shows "Fyll i namn" under the
  name field (with `aria-describedby`), not a single error line at the
  bottom.
- **Filters in the URL.** Search and class chip are in the URL (status
  is already), and the count reads "{{shown}} av {{total}}" when
  filtered. `runners.noResults.title` with an empty query has no empty
  quotes.

**Edits:**

| Row                | Change                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AN-1               | List rows lose the per-row box: a divider line between rows, 44 px min height.                                                                                                                                     |
| AN-2, AN-4         | As in the tests.                                                                                                                                                                                                   |
| AN-3               | EditCompetitorModal buttons become `<Button>`: ghost Avbryt, primary Spara, danger Återbud. Add a close button (×, `aria-label` "Stäng") in the head. Drop the orphan `.btn.*` rules.                              |
| AN-5               | Per-field errors with `aria-describedby`; `err.required` per field ("Fyll i namn", "Välj klass").                                                                                                                  |
| AN-6               | As in the tests.                                                                                                                                                                                                   |
| AN-7               | `.search-clear` 44 × 44; AddRunnerSheet `.sheet-close` 44 px; the checkbox 24 px in a 44 px row.                                                                                                                   |
| AN-8               | RunnersListView `.club`, `.chip-data` and `.chip-data.start-time` 14 px. AddRunnerSheet `.block-heading` 14 px sentence case; `.toggle-hint`, `.hint`, `.ok-note` and `.err` 14 px.                                |
| AN-9, AN-10, AN-11 | The chip colours become tokens: owned card `--ok-soft`/`--ok`, hire card `--bg-sunken` + `--fg` + the key icon (blue is not a status colour), start-time chip `--mp-soft`/`--mp-fg`. No literals or fallbacks.     |
| AN-12, AN-13       | AddRunnerSheet and EditCompetitorModal colour literals become tokens (`--ok`, `--dnf-soft`, `--accent-fg`).                                                                                                        |
| AN-14              | EditCompetitorModal inputs use `ui/Input` and `ui/Select` with `var(--radius)`.                                                                                                                                    |
| Leftovers          | AddRunnerSheet's redundant `:focus` outline and the walk-up search components' `:focus` outlines (ClubAutocomplete, SmartClubSearch, SmartRunnerSearch, EventorAutocomplete) are deleted; the global ring applies. |

**Commit:** `fix(runners): results after edits, per-field errors and token colours`

---

### Task 11: The Ändra dialog shows start and punches

Todo `2026-10-10-edit-runner-shows-start-and-punches.md`.

**Files:** `components/EditCompetitorModal.svelte`, a small helper
`components/edit-runner-read.ts` (+ test), i18n, a new
`tests/e2e/edit-runner.spec.ts`, floors and a11y (an opened dialog
entry).

**Data:**

- Use the readout payload (`getReadout`, typed in
  `screens/readout-types.ts`). It already holds each card's latest read
  with punches, start, finish and check.
- Pick the runner's latest read by card number. Read the types first;
  if the payload lacks something the todo asks for, show what exists
  and list the gap in the report. Do not change the edge.

**Behaviour tests:**

- **Mispunch.** A runner read with control 35 missing shows the course
  check with 35 as "saknas" (`PunchGrid`, verdict on) and the splits
  table (`SplitsTable`).
- **Start and times.** Start shows the drawn time and, when present,
  the start punch, saying which one the time runs from. Finish and read
  time show. If the start punch is later than the drawn start, it shows
  "Sen start".
- **Manual punch.** After a manual punch (CorrectionsPanel), the punch
  shows as "för hand" and the status follows.
- **Never read.** A runner who has not been read shows "Inte avläst
  ännu". Card number and hire status still show.

**Edits:**

- A block above the form, collapsible with `<details open>` "Start och
  stämplingar".
- The helper `latestReadFor(readout, cardNumber)` is unit-tested.

**Commit:** `feat(runners): show start, punches and splits in the edit dialog`

---

### Task 12: Hyrbrickor

**Files:** `screens/ActiveHyrbrickorView.svelte` (+ its test), i18n,
`hyrbricka.spec.ts`, floors and a11y (no entry yet).

**Behaviour tests:**

- **Return gives a result.** "Markera återlämnad" moves the card to
  Återlämnade and shows "Bricka {{card}} återlämnad".
- **Separate load errors.** A failed load of the open list shows its
  error with "Försök igen" inside that card, while the returned list
  still renders (HY-2).
- **Empty state.** The empty state reads "Inga hyrbrickor ute just nu.
  Hyrbrickor som lånas ut vid direktanmälan visas här tills de lämnas
  tillbaka."

**Edits:**

| Row  | Change                                                                                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HY-1 | `hyrbrickor.returnedBtn` "Markera återlämnad"; the result toast.                                                                                                  |
| HY-2 | Each list keeps its own state and `LoadError`.                                                                                                                    |
| HY-3 | As in the tests.                                                                                                                                                  |
| HY-4 | `.small`, `.badge` and `.contact-line` 14 px.                                                                                                                     |
| HY-5 | No `opacity` on returned rows (`--fg-muted` text). The open-list count badge becomes neutral (`--bg-sunken`, `--fg`), since a count of cards out is not an error. |

**Commit:** `fix(hyrbrickor): a result on return, separate load errors, neutral counts`

---

### Task 13: README, screenshots, audit, todos

- [ ] **Step 1:** full gate and full e2e behind the lock (2 workers).
      Report the counts and any flakes, each rerun alone once.
- [ ] **Step 2:** after shots.
  - Run `DESIGN_LAB_SHOTS=<folder> flock /tmp/fartola-e2e.lock pnpm exec playwright test tests/e2e/design-lab-screens.spec.ts --workers=1`.
    Copy them to `~/src/fartOLa-workdirs/fartOLa-docs/design-lab-2026-10/after-plan-3/`.
    Open no other file in `fartOLa-docs`.
  - Add any screen the harness lacks: Kontroll, Speaker, Hyrbrickor,
    the opened Ändra dialog.
- [ ] **Step 3:** README "Plan 3" section, one line per screen tied to
      an ADR-0016 rule. Audit: a "Plan 3" status line per section.
- [ ] **Step 4:** remove the closed lines from the plan 1 leftovers todo,
      and delete it if empty. Close the todos this plan finished:
  - competition-info-one-save-model;
  - edit-runner-shows-start-and-punches;
  - settings-competition-switch-guard;
  - in open-classes-start-punch-by-default, mark parts 2 and 3 done and
    keep part 1.
- [ ] **Step 5:** commit `docs(design-lab): describe plan 3 changes and close its todos`.

---

## PR stack

Opened only when Jonas says so; merge bottom-up with rebase-merge:

1. Tasks 0–3: settings guard, `SavedNote`, Avläsning.
2. Tasks 4–5: Direktanmälan, Resultat.
3. Tasks 6–9: Lottning, Kontroll, Tävlingsinfo.
4. Tasks 10–13: Anmälda, the Ändra dialog, Hyrbrickor, README, plus the
   fixes from the final reviews.

Each PR text says whether it needs the two-day replay (ADR-0014). None
should, because no task changes results, statuses or timing. Say so
explicitly.

## Not in this plan

- **The open-class start-punch default** (todo part 1). It changes
  which time a result runs from, so it needs its own change and a
  replay.
- **The punch log view** (`2026-10-11-punch-log-view.md`). It is a new
  screen backed by a new edge route; it is a feature, not a design
  pass.
- **Modal focus management** (X5, `2026-10-09-axe-known-violations.md`),
  undo lists (X7/X11), `userMessage()` (X8): as in the spec.
- **Plan 1 leftover code items:** `readout-long-course.spec.ts` noise,
  PunchGrid `verdict=false` tests, `StatusLabel.test.ts`, and
  `check-icons.mjs`. They stay in the leftovers todo.
