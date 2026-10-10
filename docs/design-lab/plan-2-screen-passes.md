# Design lab, plan 2: screen passes

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the audit findings on the nine screens no other track
owns: Registrering, Importera löpare, Export, Eventor, Kvar i skogen,
Tävlingar, Ny tävling, Inställningar and Hjälparinloggning. Also do the
audit's shared fixes and the plan 1 leftovers that are not on the
readout.

**Architecture:** First come three shared tasks:

- tokens and a lint gate for undefined tokens;
- shared UI pieces (a hint on disabled buttons, a load-error line with
  retry, the frame's last small text);
- e2e helpers that measure text size and target size.

Then one task per screen, each with its audit rows (IDs as in
`docs/design-lab/audit.md`). Every screen task adds its screen to the
e2e floor check and to the axe scan, so the check grows with the work.
The last task updates the README and the screenshots.

**Tech Stack:** Svelte 5 + SvelteKit (adapter-static), TypeScript,
vitest + jsdom (`mount` from `svelte`), Playwright,
`@axe-core/playwright`, `@lucide/svelte` behind `ui/Icon.svelte`.

**Spec:** `docs/design-lab/spec.md` (read it first). The findings are
in `docs/design-lab/audit.md`, sections Registrering to
Hjälparinloggning. Its line numbers are from before plan 1, so look
selectors and keys up by name. This plan states each row's current
state as of `origin/main` ce7e6c7.

## Global Constraints

- Work in `~/src/fartOLa-workdirs/design-lab`, branch
  `design-lab/plan-2` (from `origin/main`). Never push. One task, one
  commit; stage only that task's files. Leave the untracked
  `DESIGN-LAB.md` alone.
- Commits use Conventional Commits:
  - lowercase subject, about 70 characters, no full stop;
  - **no `Claude-Session:` line**;
  - lefthook runs prettier, eslint and commitlint on every commit.
- New files start with `// Authored for fartola. Not ported from upstream.`
  (`<!-- … -->` in Svelte, same text).
- Node: `export PATH=$HOME/.nvm/versions/node/v26.10.0/bin:$PATH`.
- Gate for every task: `pnpm lint && pnpm typecheck && pnpm test`. Each
  screen task also runs its own e2e specs. Under load the web tests can
  time out; rerun `pnpm --filter @fartola/web test` alone before calling
  a test broken. For e2e, free ports 3001 and 5174 first. On an EMFILE
  error, check `fs.inotify.max_user_instances`, which is 512 on this
  machine.
- ADR-0016 rule 7 sets the floors:
  - text at least 4.5:1, and `--fg-muted` at least 7:1 on `--bg`,
    `--bg-sunken` and `--pend-soft`; non-text at least 3:1;
  - body text at least 16 px, and nothing that carries meaning below
    14 px;
  - targets at least 44 px;
  - never colour alone.

  Bright-sun mode (`.contrast-high`) must pass the same floors.

- Colours come from tokens only. Never use `--err`, `--warn`,
  `--bg-hover` or `--bg-soft`, which do not exist. Errors use `--dnf`
  and `--dnf-soft`. Warnings use `--mp` and `--mp-soft`, with `--mp-fg`
  for text. Hover and soft fills use `--bg-sunken`.
- Plain Swedish, one word per concept, sentence case, no exclamation
  marks. No developer words in the UI: "IOF XML 3.0", "EntryList",
  "CourseData", "XSD", "projektionen", device paths, "API" and
  "handskakning" are all out.
- Shared i18n keys: before changing a text, grep for every consumer of
  the key. Split the key when the meanings differ. Every new key goes
  in both `sv.json` and `en.json`.
- Use the existing `ui/Button.svelte`. The hand-rolled `.btn` classes
  on these screens go away.
- Do not touch:
  - results logic, statuses, timing, the event log;
  - `packages/sportident`, receipt templates and `docs/demo`;
  - edge (`apps/edge`) code, except where a task says so (none does).
- **Files owned by other tracks** must not be edited here, beyond the
  lines named in Task 5 (RunnersListView):
  - **m2-fees:** `WalkupModal`, `EnteredRunnerStep`,
    `ActiveHyrbrickorView`, `CompetitionInfoView`;
  - **m2-bibs / m2-prerace:** `LottningView`, `RunnersListView`,
    `AddRunnerSheet`, `ReceiptMirror`;
  - **m2-closing:** Tävlingsinfo and Lottning;
  - **sekretariat:** `ReadoutView`, `LatestReadCard`, `PunchGrid`,
    `EditCompetitorModal`, `ResultsView`;
  - **walk-up search components:** `ClubAutocomplete`,
    `SmartClubSearch`, `SmartRunnerSearch`, `EventorAutocomplete`.

  Their findings are listed under "Handed to other tracks" at the end.

## Review Focus

1. **The wizard without the reader step.** A course file plus name and
   date must create the competition and open the readout in one click
   on step 2. No timer, no "Söker läsare". An import error must show on
   step 2 and clear on the next try. → e2e in Task 10.
2. **Kvar i skogen with an empty check unit.** It must never say "Alla
   löpare har återkommit" when nothing was read, and a runner marked
   safe stays visible as marked. → e2e with a mocked snapshot in
   Task 8.
3. **Export after setting Ej start.** The download must stay disabled
   while a new preview loads or once the type changed. "Ångra" must not
   look like the main action. → e2e in Task 6.
4. **The settings page with no active competition.** The competition
   group says what to do; the installation group still works. → e2e in
   Task 11.
5. **Bright-sun mode on every changed screen.** No contrast or
   target-size violations. → the axe scan grows in each screen task and
   runs in both modes.

---

## File map

| File                                                                                                                                                                                                                | Change                                                                                                 | Task |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---- |
| `apps/web/src/lib/tokens.css`, `tokens.contrast.test.ts`                                                                                                                                                            | `--fs-caption` 14, `--scrim`, `--focus-ring`, drop `--icon-*`, darker bright-sun `--mp-fg`, more pairs | 1    |
| `scripts/check-tokens.mjs` (new), `package.json`                                                                                                                                                                    | lint gate: no undefined custom properties                                                              | 1    |
| `ui/Modal.svelte`, `layout/AppShell.svelte`, `screens/NewCompetitionWizard.svelte`, `ExportView`, `EventorPublishView`, `KvarISkovenView`                                                                           | token swaps only                                                                                       | 1    |
| `ui/Button.svelte` (+ test), `ui/LoadError.svelte` (new, + test), `ui/Input.svelte`, `ui/Select.svelte`, `layout/ActiveCompetitionPill.svelte`, `layout/StationCard.svelte`, `components/AppearanceSettings.svelte` | disabled look + hint, load error with retry, redundant focus rules, frame text                         | 2    |
| `tests/e2e/helpers/floors.ts` (new), `tests/e2e/screen-floors.spec.ts` (new), `tests/e2e/targets.spec.ts`, `tests/e2e/helpers/seed.ts`, `ui/Icon.svelte`                                                            | floor helpers, seed option, `IconName` from the map                                                    | 3    |
| `screens/RegistrationView.svelte`                                                                                                                                                                                   | RG-1 … RG-7                                                                                            | 4    |
| `screens/ImportRunnersView.svelte`, `components/DropZone.svelte`, `screens/RunnersListView.svelte` (5 lines)                                                                                                        | IM-1 … IM-7, NY-3                                                                                      | 5    |
| `screens/ExportView.svelte`                                                                                                                                                                                         | EX-1 … EX-8                                                                                            | 6    |
| `screens/EventorPublishView.svelte`                                                                                                                                                                                 | EV-1, EV-3 … EV-6                                                                                      | 7    |
| `screens/KvarISkovenView.svelte`                                                                                                                                                                                    | KV-1 … KV-8                                                                                            | 8    |
| `screens/HomeView.svelte`, `components/CompetitionCard.svelte`                                                                                                                                                      | TV-1 … TV-5                                                                                            | 9    |
| `screens/NewCompetitionWizard.svelte`, `WizardStep1.svelte`, `WizardStep2.svelte`, `WizardStep3.svelte` (deleted), `tests/e2e/wizard.spec.ts`                                                                       | NY-1 … NY-8                                                                                            | 10   |
| `screens/SettingsView.svelte`, `components/AppearanceSettings.svelte`, `tests/e2e/settings-nav.spec.ts`                                                                                                             | IN-1 … IN-3, IN-5, IN-6, IN-8 … IN-10, IN-12, two groups (option B)                                    | 11   |
| `screens/AccessView.svelte`                                                                                                                                                                                         | HI-1 … HI-6                                                                                            | 12   |
| `i18n/sv.json`, `i18n/en.json`                                                                                                                                                                                      | wording per task                                                                                       | 2–12 |
| `tests/e2e/a11y.spec.ts`                                                                                                                                                                                            | one screen per screen task                                                                             | 4–12 |
| `docs/design-lab/README.md`, `.planning/todos/pending/2026-10-10-design-lab-plan-1-leftovers.md`                                                                                                                    | what changed, leftovers closed                                                                         | 13   |

---

### Task 1: Tokens and the undefined-token gate

Shared fixes from the top of `audit.md`, plus plan 1 leftovers on
tokens. After this task no screen uses an undefined token, and lint
keeps it so.

**Files:**

- Modify: `apps/web/src/lib/tokens.css`
- Modify: `apps/web/src/lib/tokens.contrast.test.ts`
- Create: `scripts/check-tokens.mjs`
- Modify: `package.json` (`lint:tokens`, added to `lint`)
- Modify (token swaps only): `ui/Modal.svelte`, `layout/AppShell.svelte`,
  `screens/NewCompetitionWizard.svelte`, `screens/ExportView.svelte`,
  `screens/EventorPublishView.svelte`, `screens/KvarISkovenView.svelte`,
  `layout/ActiveCompetitionPill.svelte`, `layout/StationCard.svelte`

**Interfaces:**

- Produces these tokens:
  - `--scrim` (the modal backdrop colour);
  - `--focus-ring` (the value `2px solid var(--fg)`, used as
    `outline: var(--focus-ring)`);
  - `--fs-caption`, now 14 px.

  `--icon-sm`, `--icon-md` and `--icon-lg` are removed; nothing uses
  them.

- Produces `pnpm lint:tokens`, which fails on any
  `var(--name …)` in `apps/web/src/**/*.svelte` whose `--name` is not
  declared in `tokens.css` or in the same file, except names in the
  allowlist (see Step 5).

- [ ] **Step 1: Write the failing lint gate**

```js
// scripts/check-tokens.mjs
// Authored for fartola. Not ported from upstream.
//
// Gate: every CSS custom property a Svelte file reads with var(--x) is
// declared in apps/web/src/lib/tokens.css or in that file (a local
// --x: …). An undefined token silently drops the style: in the audit
// --err/--warn left error boxes unstyled (EX-1, EV-1, KV-5).
// Run: node scripts/check-tokens.mjs   (part of `pnpm lint`).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'apps/web/src');
const TOKENS = readFileSync(path.join(SRC, 'lib/tokens.css'), 'utf8');

// Files other tracks own still read these; remove a line when its
// track fixes it. The list may only shrink.
const KNOWN = new Set([
  'apps/web/src/lib/components/EnteredRunnerStep.svelte --bg-soft',
  'apps/web/src/lib/screens/WalkupModal.svelte --bg-soft',
]);

const declared = (text) => new Set([...text.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
const global = declared(TOKENS);

function* svelteFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* svelteFiles(p);
    else if (name.endsWith('.svelte')) yield p;
  }
}

const errors = [];
for (const file of svelteFiles(SRC)) {
  const text = readFileSync(file, 'utf8');
  const local = declared(text);
  const rel = path.relative(ROOT, file);
  for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) {
    const name = m[1];
    if (global.has(name) || local.has(name) || KNOWN.has(`${rel} ${name}`)) continue;
    const line = text.slice(0, m.index).split('\n').length;
    errors.push(`${rel}:${line}: ${name} is not defined in tokens.css`);
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`\n${errors.length} undefined token(s).`);
  process.exit(1);
}
console.log('check-tokens: ok');
```

Add `"lint:tokens": "node scripts/check-tokens.mjs"` to the root
`package.json` scripts and `&& pnpm run lint:tokens` to the end of
`lint`.

- [ ] **Step 2: Run it and see it fail**

Run: `node scripts/check-tokens.mjs`
Expected: FAIL, listing `--err` (ExportView, EventorPublishView,
KvarISkovenView), `--warn` (KvarISkovenView), `--bg-hover`
(ActiveCompetitionPill twice, StationCard) and anything else
undefined. If it lists a token this plan does not name, stop and
report it. Do not add it to `KNOWN` without saying so in the report.

- [ ] **Step 3: Write the failing contrast pairs**

In `tokens.contrast.test.ts`, add these to `PAIRS` (leftovers todo,
"Contrast test"):

```ts
  ['--fg-faint', '--bg-sunken', 4.5],
  ['--fg-faint', '--pend-soft', 4.5],
  ['--fg-muted', '--bg-elev', 7],
  ['--ok', '--bg', 4.5],
  ['--mp-fg', '--bg', 4.5],
  ['--dnf', '--bg', 4.5],
```

Change `export const ratio` to `const ratio`; nothing imports it.
Add one test that pins the darker bright-sun amber:

```ts
it('bright-sun amber text is at least as strong as the default', () => {
  const sun = MODES['bright-sun']!;
  expect(ratio(resolve(sun, '--mp-fg'), resolve(sun, '--bg'))).toBeGreaterThanOrEqual(
    ratio(resolve(root, '--mp-fg'), resolve(root, '--bg'))
  );
});
```

Run: `pnpm --filter @fartola/web exec vitest run src/lib/tokens.contrast.test.ts`
Expected: the new amber test FAILS (#8a4a00 is weaker than the default).
Any new pair that fails is a real finding: fix the token in Step 4.
Do not lower a floor.

- [ ] **Step 4: Change the tokens**

In `tokens.css` `:root`:

```css
--fs-caption: 14px; /* was 12px; ADR-0016 r7 (audit LO-8) */
--scrim: rgba(20, 20, 30, 0.32);
--focus-ring: 2px solid var(--fg);
```

- Delete the three `--icon-sm/md/lg` lines.
- In `.contrast-high`, set `--mp-fg: #7a4100;` (about 8:1 on white).
- Change the global rule to `:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }`.

Then the token swaps:

| File                                   | Selector / line                             | Change                                                                     |
| -------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------- |
| `ui/Modal.svelte`                      | scrim `rgba(20, 20, 30, 0.32)`              | `var(--scrim)`                                                             |
| `layout/AppShell.svelte`               | `.drawer-scrim` background                  | `var(--scrim)`                                                             |
| `screens/NewCompetitionWizard`         | scrim background                            | `var(--scrim)`                                                             |
| `ExportView`, `EventorPublishView`     | `.box.err` `var(--err)` and its `color-mix` | `border-color: var(--dnf); background: var(--dnf-soft); color: var(--fg)`  |
| `KvarISkovenView`                      | `.box.err` (same)                           | same as above                                                              |
| `KvarISkovenView`                      | `.box.warn` `var(--warn, orange)` + mix     | `border-color: var(--mp); background: var(--mp-soft); color: var(--mp-fg)` |
| `KvarISkovenView`                      | `.count-badge.urgent { color: var(--err) }` | `color: var(--dnf)`                                                        |
| `ActiveCompetitionPill`, `StationCard` | `var(--bg-hover, …)`                        | `var(--bg-sunken)`                                                         |

Leave `WalkupModal`'s scrim alone; m2-fees owns it.

- [ ] **Step 5: Run the gates**

Run: `node scripts/check-tokens.mjs && pnpm --filter @fartola/web exec vitest run src/lib/tokens.contrast.test.ts`
Expected: `check-tokens: ok`; all pairs PASS in both modes.

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS.

`--fs-caption` going from 12 to 14 px also reaches screens other
tracks own (Field labels, ClassKindsPanel, Lottning). Take one
screenshot each of `/competition/<id>/info` and
`/competition/<id>/lottning` at 1366×768 with
`DESIGN_LAB_SHOTS=1 pnpm exec playwright test tests/e2e/design-lab-screens.spec.ts --workers=1`.
Check that no label wraps into a control, and report it if one does.

- [ ] **Step 6: Commit**

```bash
git add scripts/check-tokens.mjs package.json apps/web/src/lib/tokens.css \
  apps/web/src/lib/tokens.contrast.test.ts apps/web/src/lib/ui/Modal.svelte \
  apps/web/src/lib/layout/AppShell.svelte apps/web/src/lib/layout/ActiveCompetitionPill.svelte \
  apps/web/src/lib/layout/StationCard.svelte apps/web/src/lib/screens/NewCompetitionWizard.svelte \
  apps/web/src/lib/screens/ExportView.svelte apps/web/src/lib/screens/EventorPublishView.svelte \
  apps/web/src/lib/screens/KvarISkovenView.svelte
git commit -m "fix(web): define every token the screens use and gate undefined ones"
```

---

### Task 2: Shared UI pieces: disabled hint, load error, frame text

Audit RG-3 / HI-5 / NY-4 (a disabled primary says what is missing),
RG-1 / TV-2 / HI-1 (a failed load says so and offers a retry), IN-7
(the remaining component focus rules) and the frame's last small text
(leftovers: ActiveCompetitionPill 10–13 px, panel height).

**Files:**

- Modify: `apps/web/src/lib/ui/Button.svelte`
- Create: `apps/web/src/lib/ui/Button.test.ts`
- Create: `apps/web/src/lib/ui/LoadError.svelte`
- Create: `apps/web/src/lib/ui/LoadError.test.ts`
- Modify: `apps/web/src/lib/ui/Input.svelte`, `ui/Select.svelte`,
  `layout/StationCard.svelte`, `layout/ActiveCompetitionPill.svelte`,
  `components/AppearanceSettings.svelte`
- Modify: `apps/web/src/lib/i18n/sv.json`, `en.json` (`common.retry`)

**Interfaces:**

- Produces `<Button disabledHint="…">`, a new optional
  `disabledHint?: string` prop:
  - When `disabled` is true and `disabledHint` is set, the button
    renders a sibling `<span class="btn-hint" id={hintId}>` right after
    the `<button>`. The button gets `aria-describedby={hintId}`.
  - Otherwise nothing is added.
  - `hintId` comes from `$props.id()` with the suffix `-hint`.
- Produces `<LoadError message={string} onretry={() => void} />`. It
  renders `<p class="load-error" role="alert">`: an `alert-triangle`
  icon, the message, and a secondary `<Button>` "Försök igen"
  (`t('common.retry')`).
- New i18n key: `common.retry` = "Försök igen" / "Try again".

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/lib/ui/Button.test.ts
// Authored for fartola. Not ported from upstream.
//
// Audit RG-3: a primary that cannot act yet stays disabled and says
// what is missing, next to it, linked for screen readers.
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, createRawSnippet } from 'svelte';
import Button from './Button.svelte';

let instance: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (instance) void unmount(instance);
  instance = null;
  document.body.innerHTML = '';
});

const label = createRawSnippet(() => ({ render: () => '<span>Lägg till</span>' }));

describe('Button disabledHint', () => {
  it('shows the hint and links it when disabled', () => {
    instance = mount(Button, {
      target: document.body,
      props: { disabled: true, disabledHint: 'Skriv ett bricknummer', children: label },
    });
    const btn = document.querySelector('button')!;
    const hint = document.querySelector('.btn-hint')!;
    expect(hint.textContent).toBe('Skriv ett bricknummer');
    expect(btn.getAttribute('aria-describedby')).toBe(hint.id);
  });

  it('shows no hint when enabled', () => {
    instance = mount(Button, {
      target: document.body,
      props: { disabled: false, disabledHint: 'Skriv ett bricknummer', children: label },
    });
    expect(document.querySelector('.btn-hint')).toBeNull();
    expect(document.querySelector('button')!.hasAttribute('aria-describedby')).toBe(false);
  });
});
```

```ts
// apps/web/src/lib/ui/LoadError.test.ts
// Authored for fartola. Not ported from upstream.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import LoadError from './LoadError.svelte';

let instance: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (instance) void unmount(instance);
  instance = null;
  document.body.innerHTML = '';
});

describe('LoadError', () => {
  it('says what failed and retries on click', () => {
    const onretry = vi.fn();
    instance = mount(LoadError, {
      target: document.body,
      props: { message: 'Kunde inte hämta klasser.', onretry },
    });
    const box = document.querySelector('[role="alert"]')!;
    expect(box.textContent).toContain('Kunde inte hämta klasser.');
    const btn = box.querySelector('button')!;
    expect(btn.textContent?.trim()).toBe('Försök igen');
    btn.click();
    flushSync();
    expect(onretry).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @fartola/web exec vitest run src/lib/ui/Button.test.ts src/lib/ui/LoadError.test.ts`
Expected: FAIL (`.btn-hint` missing; `LoadError.svelte` missing).

- [ ] **Step 3: Implement**

**`ui/Button.svelte`:**

- Destructure `disabled` and `disabledHint` from the props (both are in `...rest` today; pass `{disabled}` to the `<button>` explicitly), and add `const hintId = $props.id() + '-hint'` (Svelte 5.57 has `$props.id()`).
- Set `aria-describedby={disabled && disabledHint ? hintId : undefined}`.
- After `</button>`, add
  `{#if disabled && disabledHint}<span class="btn-hint" id={hintId}>{disabledHint}</span>{/if}`.
- Replace `.btn:disabled { opacity: 0.55; … }` with:

```css
.btn:disabled {
  background: var(--bg-sunken);
  color: var(--fg-muted);
  border-color: var(--border);
  cursor: not-allowed;
}
.btn-hint {
  font-size: var(--fs-label);
  color: var(--fg-muted);
  align-self: center;
}
```

The `.btn:disabled` rule must come after the `.variant-*` rules, so a
disabled primary is grey, not green.

**`ui/LoadError.svelte`:**

```svelte
<!--
  Authored for fartola. Not ported from upstream.

  A failed load says what failed and offers a retry (ADR-0016 r6, audit
  RG-1, TV-2, HI-1). Used where a screen fetched nothing.
-->
<script lang="ts">
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  import { t } from '#lib/i18n/index.ts';

  let { message, onretry }: { message: string; onretry: () => void } = $props();
</script>

<p class="load-error" role="alert">
  <Icon name="alert-triangle" />
  <span>{message}</span>
  <Button variant="secondary" size="sm" onclick={onretry}>{t('common.retry')}</Button>
</p>

<style>
  .load-error {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin: 0;
    padding: 8px 12px;
    border: 1px solid var(--dnf);
    background: var(--dnf-soft);
    border-radius: var(--radius);
    color: var(--fg);
  }
</style>
```

**Focus rules:** In `ui/Input.svelte`, `ui/Select.svelte`,
`layout/StationCard.svelte`, `layout/ActiveCompetitionPill.svelte` and
`components/AppearanceSettings.svelte`, delete the component `:focus`
outline lines. Keep a `border-color: var(--accent)` if the rule has one,
so a mouse click still shows which field is active.

**`layout/ActiveCompetitionPill.svelte`:**

- Every `font-size` below 14 px (10, 11, 13 px; `.row-check` included)
  becomes `var(--fs-label)`.
- `.panel` `max-height: 320px` becomes `min(480px, 70vh)`, so at least
  six 44 px rows show.

Add `"common.retry"` to `sv.json` ("Försök igen") and `en.json`
("Try again").

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm --filter @fartola/web exec vitest run src/lib/ui/`
Expected: PASS.
Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/ui/Button.svelte apps/web/src/lib/ui/Button.test.ts \
  apps/web/src/lib/ui/LoadError.svelte apps/web/src/lib/ui/LoadError.test.ts \
  apps/web/src/lib/ui/Input.svelte apps/web/src/lib/ui/Select.svelte \
  apps/web/src/lib/layout/StationCard.svelte apps/web/src/lib/layout/ActiveCompetitionPill.svelte \
  apps/web/src/lib/components/AppearanceSettings.svelte \
  apps/web/src/lib/i18n/sv.json apps/web/src/lib/i18n/en.json
git commit -m "feat(web): say why a button is disabled and offer a retry on load errors"
```

---

### Task 3: Floor helpers for e2e

One check per screen for text size and target size, so each screen task
can show RED then GREEN. Also the test-tooling leftovers.

**Files:**

- Create: `tests/e2e/helpers/floors.ts`
- Create: `tests/e2e/screen-floors.spec.ts`
- Modify: `tests/e2e/targets.spec.ts` (use the helper and the seed option)
- Modify: `tests/e2e/helpers/seed.ts` (`start?: boolean`)
- Modify: `apps/web/src/lib/ui/Icon.svelte` (`IconName` from the map)

**Interfaces:**

- Produces `smallTargets(page: Page): Promise<string[]>`. It is the same
  logic as today's `targets.spec.ts`, moved to the helper.
- Produces `smallText(page: Page, minPx = 14): Promise<string[]>`. It
  returns a description of every visible element whose own text is not
  empty and whose computed `font-size` is below `minPx`.
  `.receipt-mirror` and `.skip-link` are skipped.
- Produces `seedCompetition(request, { controls, start?: boolean })`,
  where `start` defaults to `true`.
- Produces `tests/e2e/screen-floors.spec.ts`, built around a
  `SCREENS` array of `{ name, url(id), ready(page) }`. Each screen task
  appends one entry. This task adds none, because the first screen
  (Task 4) shows RED first.

- [ ] **Step 1: Write the helpers**

```ts
// tests/e2e/helpers/floors.ts
// Authored for fartola. Not ported from upstream.
//
// ADR-0016 rule 7 floors, measured in the browser: targets ≥ 44 px and
// no text that carries meaning below 14 px.
import type { Page } from '@playwright/test';

export async function smallTargets(page: Page): Promise<string[]> {
  return page.$$eval(
    'button, a[href], input:not([type=checkbox]):not([type=radio]), select, [role="button"]',
    (els) =>
      els
        .filter((e) => {
          const r = e.getBoundingClientRect();
          const style = getComputedStyle(e);
          const shown = r.width > 0 && r.height > 0 && style.visibility !== 'hidden';
          const onScreen =
            r.bottom > 0 && r.right > 0 && r.top < innerHeight * 3 && r.left < innerWidth;
          return shown && onScreen && !e.closest('.skip-link') && Math.round(r.height) < 44;
        })
        .map(
          (e) =>
            `${e.tagName.toLowerCase()}.${[...e.classList].join('.')} "${(e.textContent ?? '').trim().slice(0, 30)}" ${Math.round(e.getBoundingClientRect().height)}px`
        )
  );
}

export async function smallText(page: Page, minPx = 14): Promise<string[]> {
  return page.$$eval(
    'body *',
    (els, min) =>
      els
        .filter((e) => {
          if (e.closest('.receipt-mirror, .skip-link, script, style')) return false;
          const own = [...e.childNodes]
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent ?? '')
            .join('')
            .trim();
          if (!own) return false;
          const r = e.getBoundingClientRect();
          const style = getComputedStyle(e);
          if (r.width === 0 || r.height === 0 || style.visibility === 'hidden') return false;
          return parseFloat(style.fontSize) < min;
        })
        .map(
          (e) =>
            `${e.tagName.toLowerCase()}.${[...e.classList].join('.')} "${(e.textContent ?? '').trim().slice(0, 30)}" ${getComputedStyle(e).fontSize}`
        ),
    minPx
  );
}
```

Copy `smallTargets` from `targets.spec.ts` exactly (only the
`.map(...)` text may differ). Then make `targets.spec.ts` import it.
Replace the inline seeding in its start-race test with
`seedCompetition(request, { controls: 8, start: false })`.

- [ ] **Step 2: Write the spec skeleton**

```ts
// tests/e2e/screen-floors.spec.ts
// Authored for fartola. Not ported from upstream.
//
// Design lab plan 2: every screen it passes keeps ADR-0016 rule 7 —
// no text under 14 px, no target under 44 px — at laptop and tablet
// width. Each screen task appends its entry.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { seedCompetition } from './helpers/seed.ts';
import { smallTargets, smallText } from './helpers/floors.ts';

test.describe.configure({ mode: 'serial' });

type Screen = { name: string; url: (id: string) => string; ready: (p: Page) => Locator };
const SCREENS: Screen[] = [
  // Task 4 onwards: { name: 'Registrering', url: (id) => `/competition/${id}/registration`, ready: (p) => p.getByTestId('registration-view') },
];

let id = '';
test.beforeAll(async ({ request }) => {
  id = (await seedCompetition(request, { controls: 8 })).competitionId;
});

for (const s of SCREENS) {
  for (const [w, h] of [
    [1366, 768],
    [820, 1180],
  ] as const) {
    test(`${s.name} ${w}×${h}: text ≥ 14 px and targets ≥ 44 px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(s.url(id));
      await expect(s.ready(page)).toBeVisible();
      expect(await smallText(page)).toEqual([]);
      expect(await smallTargets(page)).toEqual([]);
    });
  }
}
```

The frame (sidebar, top bar) is measured on every screen too, so
Task 2's frame fixes are needed before Task 4's entry passes.

In `seed.ts`, add `start?: boolean` to `opts` and skip the
`start-race` POST when it is `false`.

In `ui/Icon.svelte`:

- drop the `Record<string, …>` annotation on `ICONS` and declare it
  `const ICONS = { … } satisfies Record<string, Component<any>>`;
- write `export type IconName = keyof typeof ICONS;`;
- remove the hand-written union.

- [ ] **Step 3: Run the gates**

Run: `pnpm exec playwright test tests/e2e/targets.spec.ts tests/e2e/screen-floors.spec.ts`
Expected: targets PASS (as before); screen-floors runs 0 tests.
Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/helpers/floors.ts tests/e2e/screen-floors.spec.ts tests/e2e/targets.spec.ts \
  tests/e2e/helpers/seed.ts apps/web/src/lib/ui/Icon.svelte
git commit -m "test(e2e): add text and target floor helpers for the screen passes"
```

---

## Screen tasks: common steps

Every screen task (4–12) follows the same frame. The task lists only
what is specific to it.

1. **RED:**
   - Add the screen's entry to `SCREENS` in
     `tests/e2e/screen-floors.spec.ts`.
   - Add its URL and ready locator to the `screens` array in
     `tests/e2e/a11y.spec.ts`.
   - Write the task's behaviour tests.
   - Run them and see the floor test and the behaviour tests fail.
2. **Fix the rows**, using the edit table in the task.
3. **GREEN:**
   - Run the task's e2e specs and the screen's existing specs (named
     in the task), then `pnpm lint && pnpm typecheck && pnpm test`.
   - Grep `tests/e2e` for every text and class the task changed, and
     update the specs that match in the same commit.
4. **Commit**, one commit per task. Stage the screen's files, the i18n
   files and the specs.

"14 px" below means `font-size: var(--fs-label)`; "16 px" means
`var(--fs-body)`.

---

### Task 4: Registrering

**Files:** `screens/RegistrationView.svelte`, `i18n/sv.json`,
`i18n/en.json`, `tests/e2e/screen-floors.spec.ts`,
`tests/e2e/a11y.spec.ts`, `tests/e2e/registration-queue.spec.ts`.

**Floor entry:** `{ name: 'Registrering', url: (id) => `/competition/${id}/registration`, ready: (p) => p.getByTestId('registration-view') }`

**Behaviour test** (add to `registration-queue.spec.ts`):

```ts
test('a failed class load says so and retries', async ({ page, request }) => {
  const { competitionId: id } = await seedCompetition(request, { controls: 3 });
  let fail = true;
  await page.route(`**/api/competitions/${id}`, (r) =>
    fail ? r.fulfill({ status: 503, json: { error: 'down' } }) : r.continue()
  );
  await page.goto(`/competition/${id}/registration`);
  const alert = page.getByRole('alert').filter({ hasText: 'Kunde inte hämta klasser.' });
  await expect(alert).toBeVisible();
  fail = false;
  await alert.getByRole('button', { name: 'Försök igen' }).click();
  await expect(alert).toBeHidden();
});

test('the add button says what is missing', async ({ page, request }) => {
  const { competitionId: id } = await seedCompetition(request, { controls: 3 });
  await page.goto(`/competition/${id}/registration`);
  await expect(page.getByText('Skriv ett bricknummer')).toBeVisible();
  await page.getByTestId('reg-manual-input').fill('7501853');
  await expect(page.getByText('Skriv ett bricknummer')).toBeHidden();
});
```

Before you write the route mock, read the screen's `onMount` (around
`getCompetition`, lines ~99–111) and match the URL it fetches.

**Edits:**

| Row  | Where (current)                                                                                                                                                             | Change                                                                                                                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RG-1 | `onMount` `catch {}` after `getCompetition` (~104–111)                                                                                                                      | Keep a `loadError` state and render `<LoadError message={t('registration.loadError')} onretry={load} />` above the queue. Move the fetch into `load()`. Key: "Kunde inte hämta klasser." / "Could not load the classes." |
| RG-2 | `registration.cancelRegistration`, `registration.cancelling`                                                                                                                | "Återbud" and "Registrerar återbud…" (en: "Withdraw", "Withdrawing…"). Grep the keys; if another screen uses them, split the key.                                                                                        |
| RG-3 | manual "Lägg till" (`disabled={manualCard.trim()===''}`, ~405)                                                                                                              | Use `<Button variant="primary" disabledHint={t('registration.manualEntry.missing')}>`. Delete `.manual-btn` and its `:disabled` CSS. Key: "Skriv ett bricknummer" / "Type a card number".                                |
| RG-4 | `.reg-head .badge` 12, `.manual-err` 13, `.reg-queue-count` 12 (height 22 px), `.reg-queue-chip .cta` 13, `.known-label` 13, `.known-club` 13, `.known-err` 13, `.toast` 13 | 14 px each; `.reg-queue-count` `height: auto`.                                                                                                                                                                           |
| RG-5 | `.reg-head .badge` `background: var(--accent); color: #fff`                                                                                                                 | `background: var(--bg-sunken); color: var(--fg); border: 1px solid var(--border-strong)`.                                                                                                                                |
| RG-6 | `.reg-queue-count { color: oklch(0.45 0.12 70) }`; `.known-cancel { color: #fff }`                                                                                          | `var(--mp-fg)`; `var(--accent-fg)`.                                                                                                                                                                                      |
| RG-7 | `.manual-input:focus` outline                                                                                                                                               | Delete the outline lines; keep `border-color: var(--accent)`.                                                                                                                                                            |

**Commit:** `fix(web): registration says why add is disabled and when classes fail`

---

### Task 5: Importera löpare (+ DropZone)

**Coordination:** IM-1 adds about five lines to
`screens/RunnersListView.svelte`, which m2-bibs and m2-prerace also
edit. Before you start, the controller pings the
`meos-capture-windows-build` session, so those tracks know a small
conflict is coming.

**Files:**

- `screens/ImportRunnersView.svelte`, `components/DropZone.svelte`
- `screens/RunnersListView.svelte` (the Modal around
  `ImportRunnersView` only)
- `i18n/sv.json`, `en.json`
- `tests/e2e/screen-floors.spec.ts`, `a11y.spec.ts`, plus a new
  `tests/e2e/import-runners.spec.ts`

**Floor entry:** `{ name: 'Importera löpare', url: (id) => `/competition/${id}/import`, ready: (p) => p.getByTestId('import-runners-view') }`

**Behaviour tests** (`tests/e2e/import-runners.spec.ts`; synthetic
fixture `apps/edge/test/fixtures/iof30-entrylist-sample.xml`):

- **Upload, then done.** Uploading the EntryList on
  `/competition/<id>/runners` (opened in the import modal) shows
  "Klart: N löpare importerade och sparade." and a primary button
  "Klar – visa anmälda". Clicking it closes the modal, and the list
  shows the imported names without a reload.
- **Relink only after import.** With `**/eventor/import**` mocked to
  503, clicking "Länka om" and choosing another event leaves the
  competition's `eventor_event_id` unchanged
  (`GET /api/competitions/<id>`). An error is shown, and "Välj annan
  tävling" returns to the event list.

**Edits:**

| Row  | Where (current)                                                                                                                         | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IM-1 | `Props` (`competitionId`, `embedded`); `.result.ok` banner (`import-result`); RunnersListView Modal (~359–374)                          | Add an `onDone?: () => void` prop. When it is set and the import succeeded, show `<Button variant="primary" onclick={onDone}>{t('importRunners.done')}</Button>` under the result. RunnersListView passes `onDone={() => { importOpen = false; void reload(); }}`, using its existing close-and-refetch code; read it first. Keys: `importRunners.done` "Klar – visa anmälda" / "Done – show entries"; `importRunners.success` "Klart: {{count}} löpare importerade och sparade." / "Done: {{count}} runners imported and saved."; `importRunners.autoBound` "{{count}} brickor kopplades till löpare som redan lästs ut." / "{{count}} cards were matched to runners already read out." |
| IM-2 | `<Button variant="ghost" data-testid="import-upload-btn">`                                                                              | `variant="secondary"`, `<Icon name="folder-open" />` before the label.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| IM-3 | `relinkEvent()` PATCHes, then imports (~263–285)                                                                                        | Import first, then `patchCompetition` only if the import succeeded. Add a secondary "Välj annan tävling" (`importRunners.relink.cancel`; en "Choose another event") that resets the relink state. Keep the rendered error and `EventorKeyLink`.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| IM-4 | `.small` 13, `.err` 13                                                                                                                  | 14 px.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| IM-5 | `importRunners.upload.title`, `.upload.desc`, `.subtitle`, `.errEventorDown`, `.errWrongKind`, `runners.empty.desc`, `wiz.drop.formats` | "Ladda upp anmälningsfil (XML)"; "Använd om Eventor inte svarar eller tävlingen ligger hos en annan klubb. Förväntar en anmälningslista från Eventor eller Purple Pen (XML)."; "Hämta anmälda från Eventor, eller ladda upp en anmälningsfil."; "Eventor svarar inte. Försök igen senare eller ladda upp en anmälningsfil."; "Filen är inte en anmälningslista. Välj en anmälningsfil (XML)."; "Hämta anmälda från Eventor eller ladda upp en anmälningsfil."; `wiz.drop.formats` → Task 10. Write English versions with the same meaning.                                                                                                                                               |
| IM-6 | Modal scrim                                                                                                                             | Done in Task 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| IM-7 | DropZone `<div class="sub">Klicka för att byta fil</div>`; `.sub` 12 px; `.icon` 32 px                                                  | `t('wiz.drop.change')` ("Klicka för att byta fil" / "Click to choose another file"); `.sub` 14 px. `.icon` is now an `<Icon>`: drop the `font-size` and pass `size={32}`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| NY-3 | DropZone `{t('wiz.imported')}: {file.name}`                                                                                             | `t('wiz.drop.chosen', { name: file.name })`: "Vald fil: {{name}}. Läses in när du går vidare." / "Chosen file: {{name}}. It is read when you continue." Grep `wiz.imported`, and remove the key if this was its last use.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

**Out of this task:** `importRunners.eventor.desc` and `.noEvents` name
"StorTuna OK". The organisation is fixed in the edge's Eventor search;
noted in the README as a follow-up, not changed here.

**Existing specs to run:** `walkup-eventor.spec.ts`,
`settings-nav.spec.ts` (import no-key), and `wizard.spec.ts` (DropZone
text).

**Commit:** `fix(web): finish an import with a clear next step and plain words`

---

### Task 6: Export

**Files:** `screens/ExportView.svelte`, `i18n/sv.json`, `en.json`,
`tests/e2e/export.spec.ts`, `screen-floors.spec.ts`, `a11y.spec.ts`.

**Floor entry:** `{ name: 'Export', url: (id) => `/competition/${id}/export`, ready: (p) => p.getByTestId('export-view') }`

**Behaviour tests** (add to `export.spec.ts`, using its
`setupCompetition`):

- **The set button carries the count.** "Sätt 2 ej utlästa till Ej
  start" shows `pending_count` from the preview, and it is disabled
  when the count is 0. "Ångra" is a secondary button
  (`.variant-secondary`).
- **No stale download.**
  - Delay `**/export/preview**` by 1 s and switch the type to
    Preliminär: the download link has `aria-disabled="true"` until the
    new preview arrives.
  - Exactly one preview request is made on page load (count the
    requests with `page.on('request')`).
- **Next step after a download.** After a download, the text "Nästa:
  publicera till Eventor" links to `/competition/<id>/eventor-publish`.

**Edits:**

| Row  | Where (current)                                                                                                                                          | Change                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EX-1 | error boxes                                                                                                                                              | Colours fixed in Task 1. Every error box also starts with `<Icon name="alert-triangle" />` and a bold word ("Fel:"), so colour is not the only cue.                                                                                                                                                                                                                                                         |
| EX-2 | two `.btn` "Sätt ej utlästa…" / "Ångra…" (~191–196)                                                                                                      | `<Button variant="primary" disabled={pending===0 \|\| busy}>`, text `export.unreadDns.set` "Sätt {{n}} ej utlästa till Ej start" / "Set {{n}} unread to DNS"; busy label `export.unreadDns.busy` "Sätter Ej start…" / "Setting DNS…". Undo: `<Button variant="secondary" disabled={busy}>`, text "Ångra Ej start" / "Undo DNS". Runner names: out of scope (needs a new edge field).                        |
| EX-3 | hard-coded h1, intro, "Slutgiltig (Final)", "Provisorisk (Provisional)", "Validerar …", "XSD-fel", "rad {line}:", "· status {status}"                    | Keys `export.title` "Exportera resultat"; `export.intro` "Kontrollera och hämta resultatfilen för Eventor."; `export.type.final` "Slutgiltig"; `export.type.provisional` "Preliminär"; `export.checking` "Kontrollerar filen…"; `export.invalid` "Filen är inte giltig"; the line list goes inside `<details><summary>{t('export.details')}</summary>` ("Visa detaljer"). Drop "status …" from the summary. |
| EX-4 | "Exporttyp", "Validering", "Validering misslyckades", "Validering OK", "Nedladdning", "Hämta ResultList.xml", "Okänt fel" ×2, "klasser · personresultat" | Every string goes to `export.*` keys in sv and en: "Typ", "Kontroll", "Filen är inte giltig", "Filen är giltig", "Hämta fil", "Hämta resultatfilen", `common.unknownError` "Något gick fel", "{{classes}} klasser · {{results}} resultat".                                                                                                                                                                  |
| EX-5 | after the download (~204–216)                                                                                                                            | Once the download link was clicked, show `export.next`: "Filen sparades i Hämtade filer. Nästa: <a>publicera till Eventor</a>". Render the link with an `<a href>` in markup, not inside the i18n string.                                                                                                                                                                                                   |
| EX-6 | `onMount` `refresh()` plus `$effect` on `status` (~57–71); `canDownload` (~55)                                                                           | Remove the `onMount` call; the `$effect` alone fetches. `canDownload = preview?.valid && !loading && previewStatus === status`; keep `previewStatus` from the response. The download `<a>` gets `aria-disabled` and no `href` when it cannot download (no `pointer-events: none`).                                                                                                                          |
| EX-7 | `.radio` rows                                                                                                                                            | `accent-color: var(--accent)`; `input { width: 24px; height: 24px }`; row `min-height: var(--hit)`.                                                                                                                                                                                                                                                                                                         |
| EX-8 | hand-rolled `.btn` (~286–303), `.box` radius 8, `.h0` 28, `.h1` 18                                                                                       | `<Button>` (the download stays an `<a>` styled with Button's classes `btn variant-primary size-md`), `var(--radius)`, `font-size: var(--fs-display)` and `var(--fs-heading)`. Delete the unused CSS.                                                                                                                                                                                                        |

**Existing specs to run:** `export.spec.ts` and `results.spec.ts`.

**Commit:** `fix(web): plain export page with counts, one fetch and a next step`

---

### Task 7: Eventor

**Files:** `screens/EventorPublishView.svelte`, `i18n/sv.json`,
`en.json`, `screen-floors.spec.ts`, `a11y.spec.ts`,
`settings-nav.spec.ts` (only if a text it matches changes), and a new
`tests/e2e/eventor-publish.spec.ts`.

**Floor entry:** `{ name: 'Eventor', url: (id) => `/competition/${id}/eventor-publish`, ready: (p) => p.getByTestId('eventor-publish-view') }`

**Behaviour tests** (`eventor-publish.spec.ts`):

- **Last published survives a reload.** Mock `**/eventor/push-results`
  to `{ url: 'https://eventor.orientering.se/x' }` and click publish:
  "Senast publicerat HH:MM" shows under the results button. After
  `page.reload()` it is still there.
- **Errors are not colour alone.** Mock push to 502: the error box
  contains the alert icon (`svg`) and the word "Fel:".

**Edits:**

| Row  | Where (current)                                                                     | Change                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| EV-1 | `.box.err`                                                                          | Colours fixed in Task 1. Add an icon and "Fel:" as in EX-1.                                                                                                                                                                                                                                                                                                              |
| EV-2 | `eventor.publish.noKey`                                                             | The link is done (PR 6). Text: "Eventor-nyckel saknas." / "Eventor key missing." (`EventorKeyLink` follows it).                                                                                                                                                                                                                                                          |
| EV-3 | `resultsUrl`/`startlistUrl` state only                                              | After a successful push, store `{ at: Date.now(), url }` under `localStorage` key `fartola-eventor-${competitionId}-${kind}` (try/catch). On mount, read it back. Show `eventor.publish.last` "Senast publicerat {{time}}" / "Last published {{time}}", using `formatClockTime` with the competition's clock offset as other screens do; fall back to the local `HH:MM`. |
| EV-4 | both buttons `btn primary`; h2s repeat the button text                              | h2 `eventor.publish.results.heading` "Resultat" / "Results" and `.startlist.heading` "Startlista" / "Start list". Results button primary, start-list button secondary.                                                                                                                                                                                                   |
| EV-5 | `eventor.publish.startlist.desc`                                                    | "Skickar startlistan till Eventor." / "Sends the start list to Eventor."                                                                                                                                                                                                                                                                                                 |
| EV-6 | hand-rolled `.btn` (radius 8, `opacity .55`), `.h0`, `.h1`, `word-break: break-all` | `<Button>`; type tokens; `overflow-wrap: anywhere`.                                                                                                                                                                                                                                                                                                                      |
| —    | `eventor.publish.success` "Publicerat!"                                             | "Publicerat." (no exclamation mark).                                                                                                                                                                                                                                                                                                                                     |

**Existing specs to run:** `settings-nav.spec.ts` (the publish no-key
case).

**Commit:** `fix(web): eventor page remembers the last publish and drops jargon`

---

### Task 8: Kvar i skogen

**Files:** `screens/KvarISkovenView.svelte`, `i18n/sv.json`, `en.json`,
`screen-floors.spec.ts`, `a11y.spec.ts`, and a new
`tests/e2e/kvar-i-skogen.spec.ts`.

**Floor entry:** `{ name: 'Kvar i skogen', url: (id) => `/competition/${id}/kvar-i-skogen`, ready: (p) => p.getByTestId('kvariskov-view') }`

**Behaviour tests** (`kvar-i-skogen.spec.ts`; mock
`**/checkunit/snapshot` with `page.route`; synthetic card numbers):

- **Empty check unit.** `{ cardNumbers: [], returnedCardNumbers: [], overflow: false, readCount: 0 }`
  shows "Inga stämplingar lästes från dosan." and never "Alla löpare
  har återkommit".
- **All back.** `{ cardNumbers: [7501853], returnedCardNumbers: [7501853], … }`
  shows "Alla löpare har återkommit."
- **Marked safe stays visible.** With `{ cardNumbers: [7501853, 1428824], returnedCardNumbers: [] }`,
  clicking "Markera säker" on 7501853 moves that runner into
  "Markerade som säkra (1)", with the text "Markerad på den här
  datorn". The missing count drops to 1.
- **Fetch time.** After a fetch, "Hämtad HH:MM" and a "Hämta igen"
  button show beside the table heading.

**Edits:**

| Row  | Where (current)                                                                          | Change                                                                                                                                                                                                                                                                                                                                                               |
| ---- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KV-1 | `confirmedSafe` (sessionStorage), mark buttons (~318, ~341)                              | Below the table, add a section `kvariskov.markedHeading` "Markerade som säkra ({{n}})" / "Marked safe ({{n}})" listing name, card and class. Under the heading: `kvariskov.markedLocal` "Markerad på den här datorn. Andra datorer ser inte markeringen." / "Marked on this computer only. Other computers do not see it." Undo and a shared event are out of scope. |
| KV-2 | `{#if missingCards.length === 0}` → "Alla löpare har återkommit." (~353–357, hard-coded) | If `startedCards.length === 0`, show `kvariskov.emptyRead` "Inga stämplingar lästes från dosan. Kontrollera att dosan är väckt och försök igen." Otherwise show `kvariskov.allBack` "Alla löpare har återkommit." Both are keys.                                                                                                                                     |
| KV-3 | no fetch time; `elapsed()` at render                                                     | Store `fetchedAt` on success. Show `kvariskov.fetchedAt` "Hämtad {{time}}" and a secondary `<Button>` "Hämta igen" (`kvariskov.refetch`) beside the table heading. Re-render the gångtid once a minute with a `$state` tick set by `setInterval` in an `$effect`, cleared on destroy.                                                                                |
| KV-4 | `kvariskov.hint`, `kvariskov.step2`                                                      | "Lägg stämpeldosan på mini-läsaren och klicka Hämta för att se vem som är kvar i skogen."; step 2 "Lägg dosan på mini-läsaren (USB)."                                                                                                                                                                                                                                |
| KV-5 | tokens                                                                                   | Done in Task 1. Also add an icon and a word to the error and warning boxes, as in EX-1.                                                                                                                                                                                                                                                                              |
| KV-6 | `.summary-text` mono 13 px, `break-all`; `kvariskov.safetySummary` "Saknade: {{names}}"  | A plain 16 px sentence: `kvariskov.summary` "{{missing}} löpare saknas, {{back}} är tillbaka." / "{{missing}} runners missing, {{back}} back." The copied text keeps the names (`safetySummary`). No mono, no `break-all`.                                                                                                                                           |
| KV-7 | three `<p class="step">`, numbers in the strings                                         | `<ol class="steps">` with `<li>`; remove "1. ", "2. " and "3. " from `kvariskov.step1`–`step3` (sv and en).                                                                                                                                                                                                                                                          |
| KV-8 | hand-rolled `.btn`, `.box` radius 8, `.h0`, `.h1`                                        | `<Button>`, `var(--radius)`, type tokens.                                                                                                                                                                                                                                                                                                                            |
| —    | `kvariskov.copied` "Kopierat!"                                                           | "Kopierat." (no exclamation mark).                                                                                                                                                                                                                                                                                                                                   |

**Commit:** `fix(web): kvar i skogen tells an empty read from all back`

---

### Task 9: Tävlingar (home)

**Files:** `screens/HomeView.svelte`, `components/CompetitionCard.svelte`,
`i18n/sv.json`, `en.json`, `screen-floors.spec.ts`, `a11y.spec.ts`, and
a new `tests/e2e/home.spec.ts`.

**Floor entry:** `{ name: 'Tävlingar', url: () => '/', ready: (p) => p.getByTestId('comp-grid') }`

**Behaviour tests** (`home.spec.ts`):

- **Status pills.** Create competitions through the API
  (`POST /api/competitions` with `{ name, date }`), with dates computed
  in the test from the local today:
  - today, started with `POST /api/competitions/<id>/start-race`, shows
    "Pågår";
  - today, not started, shows "I dag";
  - yesterday shows "Avslutad";
  - tomorrow shows "Kommande".

  No card shows "startande" or "i mål". (`seedCompetition` uses a
  fixed date, so it does not fit here.)

- **Cards are links.** The card is a link
  (`getByRole('link', { name: /Designlabb/ })`) with
  `href="/competition/<id>/readout"`.
- **Retry on a failed load.** With `**/api/competitions` mocked to 503
  once, "Kunde inte hämta tävlingar." and "Försök igen" show; the
  retry lists the competitions.
- **One create button when empty.** With `**/api/competitions` mocked
  to `{ competitions: [] }`, exactly one button "Ny tävling" is
  visible.

**Edits:**

| Row  | Where (current)                                                                                     | Change                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TV-1 | CompetitionCard `status='live'` default, pill, progress bar, meta counts                            | Remove the `starters`, `finished` and `status` props, the progress bar and the counts. Derive the pill from the competition: today's date (local) → `home.status.today` "Pågår" when `race_started_at_ms` is set, otherwise "I dag"; past → "Avslutad"; future → "Kommande". en: "Running", "Today", "Finished", "Upcoming". Remove `home.status.live`, `home.starters` and `home.finished` if nothing else uses them (grep first). |
| TV-2 | hero `<p>StorTuna OK</p>`; hero and empty-state CTAs both shown; raw `loadError`                    | Remove the club line. Hide the hero CTA while the empty state shows. On error, show `<LoadError message={t('home.loadError')} onretry={load} />` ("Kunde inte hämta tävlingar." / "Could not load the competitions."). `home.new` "+ Ny tävling" → "Ny tävling" with `<Icon name="plus" />`.                                                                                                                                        |
| TV-3 | `.date` 12, `.pill` 11 uppercase, `.meta` 13, `.eventor-chip` 11, `h3` 17; HomeView `.small` 12     | 14 px; pill in sentence case (no `text-transform`, no letter-spacing); `h3` 18 px.                                                                                                                                                                                                                                                                                                                                                  |
| TV-4 | hero `linear-gradient(...)`; card hover `border-color: var(--accent); box-shadow: var(--shadow-md)` | Hero `background: var(--bg-elev); border: 1px solid var(--border)`. Hover: `border-color: var(--border-strong)` only (this also closes the double-edge leftover).                                                                                                                                                                                                                                                                   |
| TV-5 | card `<button>` with `<h3>` inside; HomeView `openCompetition` uses `goto`                          | `<a class="comp-card" href="/competition/{id}/readout">`, same styles. HomeView drops `onclick`. If `openCompetition` also sets the active competition, keep that as an `onclick` on the link that does not `preventDefault`; read it first.                                                                                                                                                                                        |

**Existing specs to run:** `wizard.spec.ts`, `walking-skeleton.spec.ts`
and `skeleton.spec.ts` (they open the home page). Grep for
`competition-card` and the "PÅGÅENDE" text.

**Commit:** `fix(web): home cards show a real status and open as links`

---

### Task 10: Ny tävling

NY-1, decided 2026-10-10: the reader step goes. The wizard has two
steps. Step 2's primary button creates the competition and opens the
readout; nothing waits for a reader.

**Files:**

- `screens/NewCompetitionWizard.svelte`, `WizardStep1.svelte`,
  `WizardStep2.svelte`
- `WizardStep3.svelte` (deleted; its `start()` moves to the wizard)
- `i18n/sv.json`, `en.json`
- `tests/e2e/wizard.spec.ts`, `screen-floors.spec.ts`, `a11y.spec.ts`

**Floor entry:** `{ name: 'Ny tävling', url: () => '/competition/_new?wizard=1', ready: (p) => p.getByTestId('wiz-name') }`
(HomeView's `openWizard` goes to this URL.)

**Behaviour tests** (`wizard.spec.ts`; update the existing two tests):

- **Create in one click from step 2.** Fill name and date, Nästa,
  upload the course fixture; the step-2 button "Skapa tävling"
  (`data-testid="wiz-start"`, kept) is enabled at once. Clicking it
  lands on `/competition/<id>/readout`. Remove the `toBeEnabled({ timeout: 5_000 })`
  wait and the handshake comments.
- **Two steps.** The step bar has two items, and the header counter
  reads "1/2", then "2/2".
- **Errors are actionable and clear.** Upload an EntryList fixture
  instead of a course file. Clicking "Skapa tävling" shows "Välj en
  banfil (XML) först. Anmälningsfilen läser du in efteråt." in
  `wizard-error`. Choose the course file: the error is gone before the
  next click.
- **A bad date says so.** With date `2026-13-99x`, the text "Skriv
  datum som ÅÅÅÅ-MM-DD" shows and Nästa is disabled.

**Edits:**

| Row  | Where (current)                                                                                                                                                                                                                                 | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NY-1 | `step: 1\|2\|3`; step bar `[1,2,3]`; `{step}/3`; step 3 = `WizardStep3`; Nästa only when `step<3`                                                                                                                                               | `step: 1\|2`; bar `[1,2]`; `{step}/2`. At step 2 the footer shows `<Button variant="primary" data-testid="wiz-start" disabled={!canAdvanceFromStep2 \|\| submitting}>` with label `wiz.create` "Skapa tävling" / "Create competition" and busy label `wiz.creating` "Skapar…" / "Creating…". Move `start()` (base64, `createCompetitionFromWizard`, `setActiveCompetition`, `goto`) into the wizard as `create()`, and keep the `mapServerError` mapping. Delete `WizardStep3.svelte` and the keys `wiz.step3.*`, `wiz.detecting`, `wiz.detected`, `wiz.station`, `wiz.handshake` and `wiz.start` (grep each first). |
| NY-2 | `mapServerError` dead-end text; `importError` cleared only in `back()`; 'Filen kunde inte hanteras.', 'Nätverksfel', WizardStep1 'Eventor svarar inte'                                                                                          | Keys: `wiz.err.needCourse` "Välj en banfil (XML) först. Anmälningsfilen läser du in efteråt."; `wiz.err.file` "Filen kunde inte läsas."; `wiz.err.network` "Kunde inte nå servern. Försök igen."; `wiz.err.eventorDown` "Eventor svarar inte. Försök igen senare." (en to match). Clear `importError` when a new file is chosen and at the start of `create()`.                                                                                                                                                                                                                                                      |
| NY-3 | DropZone "Importerad"                                                                                                                                                                                                                           | Done in Task 5 (`wiz.drop.chosen`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| NY-4 | step 1 `btn primary` ×2 (banfil, Hämta) plus Nästa; sub-labels "Skapa / Importera / Klar"; silent bad date                                                                                                                                      | "Välj banfil…" and "Hämta" become `variant="secondary"`; Nästa stays primary. Remove the sub-labels; the step titles are `wiz.step1.title` "Namn och datum" and `wiz.step2.title` "Bana". When the date field is not empty and not ISO, show `wiz.date.invalid` "Skriv datum som ÅÅÅÅ-MM-DD" under it (`aria-describedby`). Nästa gets `disabledHint={t('wiz.next.missing')}` "Fyll i namn och datum".                                                                                                                                                                                                               |
| NY-5 | WizardStep1 `.small` 12.5, `label` 13, `.small-btn` 12.5, `.loaded-msg` 13.5, `.divider-or` 11.5 uppercase `--fg-faint`; WizardStep2 `.preview .mono` 13, `.hint` 12; wizard `.small` 13, `.wiz-step` 13, `.lbl .small` 11, `.discard-msg` 13.5 | 14 px (`label` 14, `.discard-msg` 16). `.divider-or`: sentence case, no letter-spacing, `--fg-muted`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| NY-6 | `wiz.step1.quickstart.hint`, `wiz.step2.desc`, `wiz.drop.formats`                                                                                                                                                                               | "Banfil från Purple Pen eller Condes (XML). Namn och datum läses från filen; du kan ändra dem."; "Banfil från Purple Pen eller Condes (XML). Klasserna skapas från filen."; "Banfil från Purple Pen eller Condes (XML)". (`wiz.handshake` goes with NY-1.)                                                                                                                                                                                                                                                                                                                                                           |
| NY-7 | `box-shadow` at ~306; `.btn.danger { color:#fff }`                                                                                                                                                                                              | The scrim is done in Task 1. Keep `--shadow-lg` (the spec: a modal floats over the scrim). `color: var(--accent-fg)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| NY-8 | `aria-label="wizard progress"`                                                                                                                                                                                                                  | `aria-label={t('wiz.progress')}`, "Steg i guiden" / "Wizard steps".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Existing specs to run:** `wizard.spec.ts`, `settings-nav.spec.ts`
(wizard no-key), `design-lab-screens.spec.ts` (with
`DESIGN_LAB_SHOTS=1`). Grep `tests/e2e` for `wiz-start`, "Starta
avläsning", `step3` and "Importerad".

**Commit:** `feat(wizard): create the competition from step 2 without the reader step`

---

### Task 11: Inställningar

**Option B (Jonas, 2026-10-10: "A nu, B i plan 2").** Some settings
belong to the active competition: Liveresultat, Radiokontroller and
Hjälpkoder. The page shows them in their own group, headed with the
competition's name. The installation settings sit in a second group:
Eventor and keys, MeOS, Utseende. The anchors (`#eventor`,
`#liveresultat`, `#meos`, `#radio`, `#hjalpkoder`, `#utseende`) and the
deep-link focus stay.

Recommended group order: the competition group first, since it is the
one used every race day. Moving these settings to Tävlingsinfo is not
done here; m2-fees and m2-closing own that screen.

**Files:** `screens/SettingsView.svelte`,
`components/AppearanceSettings.svelte`, `i18n/sv.json`, `en.json`,
`tests/e2e/settings-nav.spec.ts`, `screen-floors.spec.ts`,
`a11y.spec.ts` (already scans `/installningar`; keep),
`screens/SettingsView.test.ts` (keys).

**Floor entry:** `{ name: 'Inställningar', url: () => '/installningar', ready: (p) => p.getByTestId('settings-view') }`

**Behaviour tests** (`settings-nav.spec.ts`):

- **Update the order test.**
  - Select `[data-testid="settings-view"] section[id]` (sections now sit
    inside group elements).
  - The expected order is `['liveresultat', 'radio', 'hjalpkoder', 'eventor', 'meos', 'utseende']`.
  - The group headings read "Den här tävlingen: <name>" and "Alla
    tävlingar på den här datorn".
- **No active competition.** With `**/api/sessions/active-competition`
  returning none, the competition group shows "Välj en tävling under
  Tävlingar först." with a link to `/`. The Eventor section still
  renders.
- **Liveresultat result text.** Mock the save to succeed: the text
  "Liveresultat är påslaget." shows. Clear it: "Liveresultat är
  avstängt."
- **Helper code errors.** Mock generate to 500: "Kunde inte skapa en
  kod." shows inside the Hjälpkoder card.
- **"Sparat." clears on edit.** In the MeOS card: save, then type in
  the password field; "Sparat." disappears.

Look up the exact endpoints in `api/client.ts` (`setLiveresultatCredentials`,
`generateEventCode`, `setMeosSettings`) before writing the route mocks.

**Edits:**

| Row   | Where (current)                                                                           | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B     | six sibling `<section>`s                                                                  | Two `<div class="group">`, each with an `<h2 class="group-title">`:<br>• `settings.group.competition` "Den här tävlingen: {{name}}" / "This competition: {{name}}";<br>• `settings.group.install` "Alla tävlingar på den här datorn" / "All competitions on this computer".<br>The section `h2`s become `h3`; keep `tabindex="-1"` and update the hash-focus code to `#id h3`. Without an active competition, the competition group shows `settings.group.noCompetition` "Välj en tävling under Tävlingar först." with a link to `/`, in place of its sections. Update `settings-nav.spec.ts` selectors from `#eventor h2` to `#eventor h3`. |
| IN-1  | Liveresultat "Spara och starta" / "Sluta skicka" act with no result text                  | Keep the labels. After a save, show `settings.liveresultat.saved` "Liveresultat är påslaget." / "Live results are on."; after a clear, `settings.liveresultat.cleared` "Liveresultat är avstängt." / "Live results are off." Use `role="status"`.                                                                                                                                                                                                                                                                                                                                                                                            |
| IN-2  | `handleGenerate`/`handleRevoke` `catch { // soft fail }`; masking after 30 s with no hint | Errors: `settings.helperCodes.generateError` "Kunde inte skapa en kod." and `.revokeError` "Kunde inte återkalla koden.", in the card with `role="alert"`. Next to a revealed code: `settings.helperCodes.revealHint` "Koden visas i 30 sekunder."                                                                                                                                                                                                                                                                                                                                                                                           |
| IN-3  | `meos-allow-checkbox` saves on change; "Sparat." cleared only by a timer                  | The checkbox saves with the card's Spara button, like the password. Clear `meosToast` on any input or change in the card.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| IN-5  | AppearanceSettings font `<option>{fp}</option>` raw ids                                   | Map the ids to display names: `plex` "IBM Plex", `geist` "Geist", `source` "Source Sans", `atkinson` "Atkinson Hyperlegible".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| IN-6  | `.small` 13, `.badge` 11, `.banner` 13, `.toast` 13, `.code-expiry` 12                    | 14 px.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| IN-7  | `.key-input:focus` outline                                                                | Delete the outline lines; keep `border-color`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| IN-8  | `.code-row.revoked { opacity: .5 }`                                                       | No opacity; `.code` gets `text-decoration: line-through`, and the word "Återkallad" stays.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| IN-9  | checkboxes 18 px / native                                                                 | `width: 24px; height: 24px; accent-color: var(--accent)`; rows `min-height: var(--hit)`, in both SettingsView and AppearanceSettings.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| IN-10 | AppearanceSettings `.sw-*` oklch literals                                                 | At the top of `<style>`, a `.swatches { --swatch-forest: …; --swatch-blue: …; --swatch-magenta: …; --swatch-charcoal: …; }` block with a comment ("previews of each theme; must not follow the active theme"), used by the four `.sw-*` rules.                                                                                                                                                                                                                                                                                                                                                                                               |
| IN-12 | `settings.integrations.desc`                                                              | "Nycklar för Eventor, Livelox och Liveresultat. Nyckeln visas inte igen efter att du sparat den." / "Keys for Eventor, Livelox and Liveresultat. A key is not shown again after you save it."                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| —     | `settings.helperCodes.noCompetition` "Välj en tävling ovan."                              | Unused once the group shows `noCompetition`. Grep it; remove it if unused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

**Commit:** `feat(settings): group settings by competition and installation`

---

### Task 12: Hjälparinloggning

**Files:** `screens/AccessView.svelte`, `i18n/sv.json`, `en.json`,
`screen-floors.spec.ts`, `a11y.spec.ts`, and a new
`tests/e2e/access.spec.ts`.

**Floor entry:** `{ name: 'Hjälparinloggning', url: () => '/access', ready: (p) => p.getByTestId('access-view') }`

**Behaviour tests** (`access.spec.ts`):

- **A failed load is not a failed login.** With `**/api/competitions`
  mocked to 503 once, the page shows "Kunde inte hämta tävlingar." and
  "Försök igen", and never "Inloggning misslyckades". The retry fills
  the select.
- **Empty list.** With `{ competitions: [] }`, "Inga tävlingar att
  logga in på." shows.
- **Label and hint.** The code field's label is "Kod". Its placeholder
  is "t.ex. sänkan-127". "Koden får du av sekretariatet" is visible
  and linked with `aria-describedby`.
- **The disabled button says why.** Before a competition and a code
  are chosen, "Välj tävling och skriv koden" is visible.

**Edits:**

| Row  | Where (current)                                                       | Change                                                                                                                                                                                                                        |
| ---- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HI-1 | `catch { loadError = true }` → `access.error.unknown`; no empty state | `<LoadError message={t('access.loadError')} onretry={load} />` ("Kunde inte hämta tävlingar."). Empty: `access.empty` "Inga tävlingar att logga in på." Hint: `access.codeHint` "Koden får du av sekretariatet". en to match. |
| HI-2 | `.select, .code-input { font-size: var(--fs-label) }`                 | `var(--fs-body)` (16 px; iOS does not zoom).                                                                                                                                                                                  |
| HI-3 | `access.codePlaceholder` used for both label and placeholder          | `access.codeLabel` "Kod" / "Code"; `access.codePlaceholder` "t.ex. sänkan-127" / "e.g. sänkan-127".                                                                                                                           |
| HI-4 | `.err` 13 px                                                          | 14 px with `<Icon name="alert-triangle" />`.                                                                                                                                                                                  |
| HI-5 | submit disabled with no reason                                        | `disabledHint={t('access.missing')}`, "Välj tävling och skriv koden" / "Choose a competition and type the code".                                                                                                              |
| HI-6 | `.select:focus`/`.code-input:focus` outline                           | Delete the outline lines.                                                                                                                                                                                                     |

**Commit:** `fix(web): helper login tells a failed load from a wrong code`

---

### Task 13: README, screenshots, leftovers

**Files:** `docs/design-lab/README.md`,
`.planning/todos/pending/2026-10-10-design-lab-plan-1-leftovers.md`,
`docs/design-lab/audit.md` (a "Plan 2" status line per section).

- [ ] **Step 1:** Run the full gate:
      `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`.
      Expected: PASS. Paste the counts into the report.
- [ ] **Step 2:** Take the after shots:
      `DESIGN_LAB_SHOTS=1 pnpm exec playwright test tests/e2e/design-lab-screens.spec.ts --workers=1`.
      Copy them to
      `~/src/fartOLa-workdirs/fartOLa-docs/design-lab-2026-10/after-plan-2/`.
      Open no other file in `fartOLa-docs`. If the harness lacks a screen
      this plan changed (the wizard at `/competition/_new?wizard=1`, `/access`), add it
      to the harness in this step.
- [ ] **Step 3:** In `README.md`, add a "Plan 2" section with:
  - one line per screen saying what changed, tied to an ADR-0016 rule;
  - the new contrast rows (`PRINT_CONTRAST=1`);
  - the `check-tokens` gate;
  - a note that the bright-sun rows for `--dns`, `--dq`, `--cancel`
    and `--max` equal the default (they are not overridden);
  - the follow-up that the Eventor search's organisation ("StorTuna
    OK") is fixed in the edge.
- [ ] **Step 4:** In the leftovers todo, delete the lines this plan
      closed: `--focus-ring`, `--icon-*`, `IconName`, contrast pairs,
      targets seeding, README note, bright-sun amber, CompetitionCard
      double edge, ActiveCompetitionPill, DropZone icon. Keep the readout
      lines for sekretariat, and the lines named under "Handed to other
      tracks" below. If nothing is left, delete the file.
- [ ] **Step 5:** Commit:
      `docs(design-lab): describe plan 2 changes and close its leftovers`.

---

## PR stack

Three PRs, stacked (`gh stack`), opened only when Jonas says so:

1. Tasks 1–3: `fix(web): tokens, disabled hints and floor checks for the screen passes`.
2. Tasks 4–8: `fix(web): secretariat screens in plain swedish with clear next steps`
   (Registrering, Import, Export, Eventor, Kvar i skogen).
3. Tasks 9–13: `feat(web): two-step wizard, home links and grouped settings`
   (Tävlingar, Ny tävling, Inställningar, Hjälparinloggning, README).

## Handed to other tracks

These come from the audit and the leftovers list, but sit in files
another track owns. The controller sends this list to
`meos-capture-windows-build` when plan 2 starts.

- **m2-fees:**
  - WalkupModal scrim → `var(--scrim)`.
  - `--bg-soft` in WalkupModal and EnteredRunnerStep → `--bg-sunken`;
    then remove their lines from `KNOWN` in `scripts/check-tokens.mjs`.
  - Hyrbrickor rows HY-1 … HY-5.
- **m2-bibs / m2-prerace:**
  - green text `var(--ok, #107a57)` in AddRunnerSheet and
    RunnersListView → `var(--ok)`;
  - AddRunnerSheet's redundant `:focus` outline.
- **Walk-up search components** (ClubAutocomplete, SmartClubSearch,
  SmartRunnerSearch, EventorAutocomplete): their `:focus` outline
  lines are now redundant with the global ring. Delete them when that
  code is next touched.
- **sekretariat:** the readout lines of the leftovers todo, as agreed.

## Not in this plan

- Undo (X7/X11), modal focus (X5), `userMessage()` (X8) and previews
  (I2/P1/U1) stay out, as in the spec.
- Runner names next to "Sätt N ej utlästa" (EX-2) need an edge field.
- `check-icons.mjs` comment stripping is line-based. It has caused no
  false result, so it is left as is.
- Consent from the Eventor entry at import is its own todo
  (`2026-10-10-consent-from-eventor-entry.md`).
