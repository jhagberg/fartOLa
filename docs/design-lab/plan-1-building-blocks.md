# Design lab, plan 1: audit and shared building blocks

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every fartOLa screen a calmer, clearer base: new tokens,
Lucide icons, readable status pills and punch tiles, 44 px targets, a
visible focus ring, a frame that works at tablet width, plain Swedish
wording. Also produce the per-screen audit that plan 2 (screen passes)
is written from.

**Architecture:** Visual changes go through the existing CSS custom
properties in `apps/web/src/lib/tokens.css` and the shared Svelte 5
components; screens are not restyled here (plan 2). Every token pair is
pinned by a vitest contrast test, layout and reachability by Playwright
e2e, accessibility by axe.

**Tech Stack:** Svelte 5 + SvelteKit (adapter-static), TypeScript,
vitest + jsdom (`mount` from `svelte`), Playwright, `@lucide/svelte`
(new), `@axe-core/playwright` (new, dev).

**Spec:** `docs/design-lab/spec.md` (read it first; this plan argues
from it).

## Global Constraints

- Work on branch `design/lab` in `~/src/fartOLa-workdirs/design-lab`.
  Never push. One task, one commit; stage only that task's files.
- Conventional Commits, lowercase subject, ~70 chars, no full stop, **no
  `Claude-Session:` line**, hooks on (lefthook runs prettier + commitlint).
- New files start with `// Authored for fartola. Not ported from upstream.`
  (`<!-- … -->` in Svelte, same text).
- Node: `export PATH=$HOME/.nvm/versions/node/v26.10.0/bin:$PATH`.
- Gate per task: `pnpm lint && pnpm typecheck && pnpm test`; run `pnpm e2e`
  in tasks that say so. Web tests can time out under load: rerun
  `pnpm --filter @fartola/web test` alone before calling a test broken.
- ADR-0016 rule 7: text ≥4.5:1, `--fg-muted` ≥7:1 on `--bg`,
  `--bg-sunken`, `--pend-soft`; non-text ≥3:1; body text ≥16 px; nothing
  that carries meaning below 14 px (13 px only for medium-tile labels);
  targets ≥44 px; never colour alone.
- Bright-sun mode (`.contrast-high` on `<html>`) stays and must pass the
  same contrast floors.
- No personal data: tests use the synthetic fixtures in
  `apps/edge/test/fixtures/` and generated data.
- Do not touch results logic, statuses, timing, the event log,
  `packages/sportident`, receipt templates
  (`apps/web/src/lib/components/receipt-templates/`) or `docs/demo`.
- Swedish UI words: SOFT's terms; results keep `soft.status.*`;
  readout/history use `status.*` = Godkänd, Felstämplad, Utgått, Väntar,
  Ej start, Diskad, Återbud, Maxtid.

## Review Focus

1. **A 35-control course at 1366×768:** "Skriv ut kvitto" and the status
   picker stay reachable without scrolling the page → e2e in Task 9.
2. **A class without a course:** punch tiles must not claim "correct"
   (no check icon, no "saknas") → unit test in Task 7.
3. **Tablet 820×1180 and 1025 px wide:** no clipped readout, hamburger
   shown at ≤1024 px, closed drawer not reachable by Tab → unit test +
   e2e in Task 8.
4. **Bright-sun mode with the new tokens:** every listed pair passes →
   contrast test runs both modes in Task 3.
5. **Shared i18n keys:** renaming `walk.save` must not relabel the
   manual-status picker's save button → unit test in Task 10.

---

## File map

| File                                                                   | Change                                    | Task    |
| ---------------------------------------------------------------------- | ----------------------------------------- | ------- |
| `tests/e2e/helpers/long-course.ts`                                     | new: synthetic CourseData with N controls | 1       |
| `tests/e2e/helpers/seed.ts`                                            | new: seed competition, simulate reads     | 1       |
| `tests/e2e/design-lab-screens.spec.ts`                                 | new: screenshot harness (opt-in)          | 1       |
| `docs/design-lab/audit.md`                                             | new: per-screen findings                  | 2       |
| `apps/web/src/lib/tokens.css`                                          | tokens, focus ring, density fix           | 3, 6, 7 |
| `apps/web/src/lib/tokens.contrast.test.ts`                             | new: contrast test                        | 3       |
| `apps/web/src/lib/ui/Card.svelte`, `ui/Modal.svelte`                   | flat look                                 | 3       |
| `apps/web/src/lib/ui/Icon.svelte`                                      | Lucide behind the same API                | 4       |
| `scripts/check-icons.mjs`, `package.json`                              | new icon gate in `pnpm lint`              | 4       |
| ~15 Svelte files + `i18n/sv.json`, `en.json`                           | symbols → `<Icon>`                        | 4       |
| `apps/web/src/lib/ui/StatusPill.svelte` (+ test)                       | translated label, type                    | 5       |
| `apps/web/src/lib/ui/Button.svelte`, 6 component CSS blocks            | 44 px, 14 px                              | 6       |
| `apps/web/src/lib/components/PunchGrid.svelte` (+ test)                | states, size rule, verdict                | 7       |
| `apps/web/src/lib/screens/ReadoutView.svelte`                          | `verdict` prop, container query           | 7, 8    |
| `apps/web/src/lib/components/LatestReadCard.svelte`                    | action bar, picker up                     | 9       |
| `tests/e2e/readout-long-course.spec.ts`                                | new                                       | 9       |
| `apps/web/src/lib/layout/{breakpoints.ts,AppShell,TopBar,Sidebar}`     | drawer ≤1024, inert, scroll               | 8       |
| `apps/web/src/lib/layout/AppShell.test.ts`, `tests/e2e/layout.spec.ts` | new                                       | 8       |
| `apps/web/src/lib/i18n/sv.json`, `en.json`                             | wording                                   | 5, 10   |
| `tests/e2e/a11y.spec.ts`, `tests/e2e/a11y-known.json`                  | new: axe                                  | 11      |
| `docs/design-lab/README.md`                                            | new: what changed and why                 | 12      |

---

### Task 1: Screenshot harness and "before" shots

**Files:**

- Create: `tests/e2e/helpers/long-course.ts`
- Create: `tests/e2e/helpers/seed.ts`
- Create: `tests/e2e/design-lab-screens.spec.ts`

**Interfaces:**

- Produces: `longCourseCodes(n: number): number[]` (31, 32, …),
  `longCourseXml(n: number): string`;
  `seedCompetition(request, opts: { controls: number }): Promise<{ competitionId: string }>`,
  `simulateRead(request, competitionId: string, card: number, codes: number[], opts?: { start?: number; finish?: number }): Promise<void>`
  (start/finish in seconds of the half day), `voidControl(request, competitionId: string, code: number): Promise<void>`,
  `BASE = 'http://localhost:5174'`. Tasks 8, 9, 11 import these.

- [ ] **Step 1: Write the synthetic course helper**

```ts
// tests/e2e/helpers/long-course.ts
// Authored for fartola. Not ported from upstream.
//
// Synthetic IOF 3.0 CourseData with a long H21 course and a short D21
// course, for tests that need many punch tiles. No real data.

/** Control codes of the long H21 course: 31, 32, … (n codes). */
export function longCourseCodes(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 31 + i);
}

export function longCourseXml(n: number): string {
  const codes = longCourseCodes(n);
  const control = (c: number): string => `<Control><Id>${c}</Id></Control>`;
  const cc = (c: number | string, type?: string): string =>
    `<CourseControl${type ? ` type="${type}"` : ''}><Control>${c}</Control></CourseControl>`;
  const course = (name: string, list: number[]): string =>
    `<Course><Name>${name}</Name><Length>${list.length * 400}</Length><Climb>${list.length * 10}</Climb>` +
    `${cc('S1', 'Start')}${list.map((c) => cc(c)).join('')}${cc('F1', 'Finish')}</Course>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<CourseData xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0"
  createTime="2026-10-09T12:00:00Z" creator="fartola-test">
  <Event><Name>Designlabb</Name>
    <Class><Name>H21</Name><ShortName>H21</ShortName></Class>
    <Class><Name>D21</Name><ShortName>D21</ShortName></Class>
  </Event>
  <RaceCourseData>
    ${codes.map(control).join('')}
    ${course('Lång', codes)}
    ${course('Kort', codes.slice(0, 4))}
    <ClassCourseAssignment><ClassName>H21</ClassName><CourseName>Lång</CourseName></ClassCourseAssignment>
    <ClassCourseAssignment><ClassName>D21</ClassName><CourseName>Kort</CourseName></ClassCourseAssignment>
  </RaceCourseData>
</CourseData>`;
}
```

- [ ] **Step 2: Write the seeding helper**

```ts
// tests/e2e/helpers/seed.ts
// Authored for fartola. Not ported from upstream.
//
// Seed a throwaway competition through the edge API (loopback = operator)
// and simulate card reads. Same calls as readout.spec.ts's setup().
// Synthetic data only: the IOF sample EntryList (Anna Andersson H21
// 7501853, Cia Carlsson D21 1428824) plus a generated course.

import { expect, type APIRequestContext } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { longCourseXml } from './long-course.ts';

export const BASE = 'http://localhost:5174';
const ENTRYLIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../apps/edge/test/fixtures/iof30-entrylist-sample.xml'
);

async function importXml(
  request: APIRequestContext,
  id: string,
  name: string,
  buffer: Buffer
): Promise<void> {
  const res = await request.post(`${BASE}/api/competitions/${id}/import`, {
    multipart: { file: { name, mimeType: 'application/xml', buffer } },
  });
  expect(res.status(), `${name}: ${await res.text()}`).toBe(201);
}

export async function seedCompetition(
  request: APIRequestContext,
  opts: { controls: number }
): Promise<{ competitionId: string }> {
  const created = await request.post(`${BASE}/api/competitions`, {
    data: { name: `Designlabb ${Date.now()}`, date: '2026-10-09' },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  await importXml(request, id, 'coursedata.xml', Buffer.from(longCourseXml(opts.controls)));
  await importXml(request, id, 'entrylist.xml', await readFile(ENTRYLIST));
  const active = await request.post(`${BASE}/api/sessions/active-competition`, {
    data: { competition_id: id },
  });
  expect(active.status()).toBe(200);
  const start = await request.post(`${BASE}/api/competitions/${id}/start-race`);
  expect([200, 201]).toContain(start.status());
  return { competitionId: id };
}

const clock = (s: number) => ({ seconds_in_half_day: s, half_day: 0, weekday: null });

/** Punch `codes` in order, 2 min apart, starting 10:00:00 unless given. */
export async function simulateRead(
  request: APIRequestContext,
  competitionId: string,
  card: number,
  codes: number[],
  opts: { start?: number; finish?: number } = {}
): Promise<void> {
  const start = opts.start ?? 10 * 3600;
  const body: Record<string, unknown> = {
    competition_id: competitionId,
    card_number: card,
    card_type: 'SI10',
    punches: codes.map((c, i) => ({ control_code: c, time_ms: (start + 120 * (i + 1)) * 1000 })),
    start: clock(start),
    finish: clock(opts.finish ?? start + 120 * (codes.length + 1)),
  };
  const res = await request.post(`${BASE}/api/__dev/simulate-read`, { data: body });
  expect(res.status(), `simulate-read: ${await res.text()}`).toBe(201);
}

export async function voidControl(
  request: APIRequestContext,
  competitionId: string,
  code: number
): Promise<void> {
  const res = await request.post(
    `${BASE}/api/competitions/${competitionId}/voided-controls/${code}`
  );
  expect([200, 201, 204], await res.text()).toContain(res.status());
}
```

- [ ] **Step 3: Write the opt-in screenshot spec**

```ts
// tests/e2e/design-lab-screens.spec.ts
// Authored for fartola. Not ported from upstream.
//
// Design-lab screenshot harness, opt-in: runs only with
// DESIGN_LAB_SHOTS=<output dir>. Seeds a 22-control course with every
// punch state (miss, wrong order, extra, struck) and shoots every screen
// at laptop and tablet size, default and bright-sun.
//   DESIGN_LAB_SHOTS=~/src/fartOLa-workdirs/fartOLa-docs/design-lab-2026-10/before \
//     pnpm e2e design-lab-screens --workers=1

import { test } from '@playwright/test';
import { longCourseCodes } from './helpers/long-course.ts';
import { seedCompetition, simulateRead, voidControl } from './helpers/seed.ts';

const OUT = process.env['DESIGN_LAB_SHOTS'];
test.skip(!OUT, 'set DESIGN_LAB_SHOTS=<dir> to take design-lab screenshots');
test.describe.configure({ mode: 'serial' });

const SIZES = [
  ['laptop', { width: 1366, height: 768 }],
  ['tablet', { width: 820, height: 1180 }],
] as const;

test('design-lab screens', async ({ browser, request }) => {
  test.setTimeout(300_000);
  const { competitionId: id } = await seedCompetition(request, { controls: 22 });
  const codes = longCourseCodes(22);
  await voidControl(request, id, codes[5]!);
  // Cia (D21, short course) clean; Anna (H21) with 35/34 swapped, 99 extra.
  await simulateRead(request, id, 1_428_824, codes.slice(0, 4));
  const anna = [...codes.slice(0, 3), codes[4]!, codes[3]!, 99, ...codes.slice(5)];
  await simulateRead(request, id, 7_501_853, anna);

  const screens: Array<[string, string]> = [
    ['home', '/'],
    ['readout', `/competition/${id}/readout`],
    ['walkup', `/competition/${id}/readout?walkup=7500123`],
    ['registration', `/competition/${id}/registration`],
    ['runners', `/competition/${id}/runners`],
    ['lottning', `/competition/${id}/lottning`],
    ['results', `/competition/${id}/results`],
    ['export', `/competition/${id}/export`],
    ['eventor', `/competition/${id}/eventor-publish`],
    ['kvar-i-skogen', `/competition/${id}/kvar-i-skogen`],
    ['hyrbrickor', `/competition/${id}/hyrbrickor`],
    ['info', `/competition/${id}/info`],
    ['import', `/competition/${id}/import`],
    ['installningar', '/installningar'],
    ['access', '/access'],
  ];
  for (const [mode, high] of [
    ['default', false],
    ['sun', true],
  ] as const) {
    for (const [tag, viewport] of SIZES) {
      const page = await browser.newPage({ viewport });
      for (const [name, url] of screens) {
        await page.goto(url);
        await page.waitForLoadState('networkidle');
        if (high)
          await page.evaluate(() => document.documentElement.classList.add('contrast-high'));
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}/${name}-${tag}-${mode}.png`, fullPage: true });
      }
      await page.goto('/');
      await page.getByTestId('open-wizard').first().click();
      await page.getByTestId('wiz-name').waitFor();
      if (high) await page.evaluate(() => document.documentElement.classList.add('contrast-high'));
      await page.screenshot({ path: `${OUT}/wizard-${tag}-${mode}.png` });
      await page.close();
    }
  }

  // Colour-blind check of the readout (spec "Verification"): Machado 2009
  // matrices in linear RGB, plus greyscale.
  const M: Record<string, string> = {
    deut: '0.367322 0.860646 -0.227968 0 0 0.280085 0.672501 0.047413 0 0 -0.011820 0.042940 0.968881 0 0 0 0 0 1 0',
    prot: '0.152286 1.052583 -0.204868 0 0 0.114503 0.786281 0.099216 0 0 -0.003882 -0.048116 1.051998 0 0 0 0 0 1 0',
    trit: '1.255528 -0.076749 -0.178779 0 0 -0.078411 0.930809 0.147602 0 0 0.004733 0.691367 0.303900 0 0 0 0 0 1 0',
  };
  const page = await browser.newPage({ viewport: SIZES[0][1] });
  await page.goto(`/competition/${id}/readout`);
  await page.waitForLoadState('networkidle');
  for (const sim of ['deut', 'prot', 'trit', 'grey']) {
    await page.evaluate(
      ([name, values]) => {
        document.getElementById('cvd')?.remove();
        if (values) {
          document.body.insertAdjacentHTML(
            'beforeend',
            `<svg id="cvd" width="0" height="0" style="position:absolute"><filter id="f" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="${values}"/></filter></svg>`
          );
        }
        document.documentElement.style.filter = name === 'grey' ? 'grayscale(1)' : 'url(#f)';
      },
      [sim, M[sim] ?? ''] as const
    );
    await page.screenshot({ path: `${OUT}/readout-laptop-${sim}.png` });
  }
  await page.close();
});
```

- [ ] **Step 4: Run it to take the "before" shots**

Run (repo root):

```bash
mkdir -p ~/src/fartOLa-workdirs/fartOLa-docs/design-lab-2026-10/before
DESIGN_LAB_SHOTS=$HOME/src/fartOLa-workdirs/fartOLa-docs/design-lab-2026-10/before pnpm e2e design-lab-screens --workers=1
ls ~/src/fartOLa-workdirs/fartOLa-docs/design-lab-2026-10/before | wc -l
```

Expected: 1 passed; 68 PNGs (16 screens × 2 sizes × 2 modes + 4 colour-blind readout shots). Open
`readout-laptop-default.png`: Anna's tiles show a miss, "fel ordn.",
"extra", "struken". If a route 404s, fix the path in `screens` (route
list: `apps/web/src/routes/**/+page.svelte`).

- [ ] **Step 5: Run the normal e2e suite to prove the spec is skipped by default**

Run: `pnpm e2e`
Expected: all existing tests pass; `design-lab screens` reported as skipped.

- [ ] **Step 6: Commit** (the PNGs stay in fartOLa-docs, not in this repo)

```bash
git add tests/e2e/helpers/long-course.ts tests/e2e/helpers/seed.ts tests/e2e/design-lab-screens.spec.ts
git commit -m "test(e2e): add design-lab seeding helpers and screenshot harness"
```

---

### Task 2: Per-screen audit

**Files:**

- Create: `docs/design-lab/audit.md`

**Interfaces:**

- Consumes: the "before" PNGs from Task 1; the 2026-10-09 audit
  (`~/src/fartOLa-workdirs/fartOLa-docs/ui-audit-2026-10-09/REPORT.md` —
  read only that file in fartOLa-docs).
- Produces: `docs/design-lab/audit.md`, one section per screen; plan 2 is
  written from it.

- [ ] **Step 1: Collect the checklists** (read, don't copy into the repo)
  - ui-ux-pro-max rules: `~/.claude/plugins/cache/ui-ux-pro-max-skill/ui-ux-pro-max/2.13.0/.claude/skills/ui-ux-pro-max/references/quick-reference.md`, sections 1, 2, 5, 6, 8, 9.
  - The taste rules listed in the spec's "Inputs" section.
  - ADR-0016 rules 1–7.

- [ ] **Step 2: For each of the 16 screens, write a section** in this
      exact format (look at both sizes and both modes; read the screen's
      `.svelte` file for hard-coded colours, sizes and strings):

```markdown
## Avläsning (`screens/ReadoutView.svelte`, `components/LatestReadCard.svelte`)

Solved by plan 1: X1, X3, X4, X6 (buttons), punch tiles, icons.

| ID   | Sev  | Rule                         | Finding                        | Fix (plan 2)       |
| ---- | ---- | ---------------------------- | ------------------------------ | ------------------ |
| RO-1 | high | ADR-0016 r7 / color-contrast | `.faint` 12 px "skriv ut" hint | 14 px `--fg-muted` |
```

IDs: two-letter screen prefix + number. Sev: high/medium/low as in the
2026-10-09 report. Carry over every per-screen finding of that report
that plan 1 does not solve; mark the ones plan 1 solves in the "Solved
by plan 1" line. Hard-coded colours (`#…`, `oklch(…)`, `rgba(…)` not via
`var(`) each get a row.

- [ ] **Step 3: Self-check**

Run: `grep -c '^## ' docs/design-lab/audit.md`
Expected: `16`. Every table row has a fix; no "TBD".

- [ ] **Step 4: Commit**

```bash
pnpm exec prettier --write docs/design-lab/audit.md
git add docs/design-lab/audit.md
git commit -m "docs(design-lab): add per-screen ui audit"
```

---

### Task 3: Tokens, contrast test, flat cards

**Files:**

- Create: `apps/web/src/lib/tokens.contrast.test.ts`
- Modify: `apps/web/src/lib/tokens.css`
- Modify: `apps/web/src/lib/ui/Card.svelte` (`.card` block)
- Modify: `apps/web/src/lib/ui/Modal.svelte:74` (radius, border)
- Modify: `apps/web/src/lib/components/LatestReadCard.svelte` (`.card-num` colour)
- Modify: `apps/web/src/lib/layout/NavItem.svelte` (`.nav-item.active`)
- Modify: `apps/web/src/lib/components/HistoryRow.svelte` (`.hist-row.active`)

**Interfaces:**

- Produces tokens used by Tasks 5, 7: `--mp-fg`, `--punch-ok-fill`,
  `--punch-ok-line`, `--punch-miss-fill`, `--punch-miss-fg`,
  `--punch-order-fill`, `--punch-order-line`, `--icon-sm` (16px),
  `--icon-md` (20px), `--icon-lg` (24px).

- [ ] **Step 1: Write the failing contrast test**

```ts
// apps/web/src/lib/tokens.contrast.test.ts
// Authored for fartola. Not ported from upstream.
//
// ADR-0016 rule 7: the text/background pairs the design-lab spec lists
// meet their contrast floor, in the default palette and in bright-sun
// mode (.contrast-high = :root + its overrides). WCAG 2.x relative
// luminance; oklch → linear sRGB per CSS Color 4.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Comments removed first: a comment that mentions a token ("--mp-soft:")
// would otherwise swallow the next declaration.
const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
);

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no "${selector} {" block in tokens.css`);
  const body = css.slice(start, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

function linear(color: string): [number, number, number] {
  const ok = color.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (ok) {
    const [L, C, h] = [Number(ok[1]), Number(ok[2]), (Number(ok[3]) * Math.PI) / 180];
    const a = C * Math.cos(h);
    const b = C * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    return [
      clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    ];
  }
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) throw new Error(`unsupported colour "${color}"`);
  const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join('') : hex[1]!;
  const ch = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [ch(0), ch(2), ch(4)];
}

const lum = (c: string) => {
  const [r, g, b] = linear(c);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** [foreground, background, floor]: token names or literal colours. */
const PAIRS: Array<[string, string, number]> = [
  ['--fg', '--bg', 7],
  ['--fg-muted', '--bg', 7],
  ['--fg-muted', '--bg-sunken', 7],
  ['--fg-muted', '--pend-soft', 7],
  ['--fg-faint', '--bg', 4.5],
  ['--accent-fg', '--accent', 4.5],
  ['--ok', '--ok-soft', 4.5],
  ['--mp-fg', '--mp-soft', 4.5],
  ['--dnf', '--dnf-soft', 4.5],
  ['--dns', '--dns-soft', 4.5],
  ['--dq', '--dq-soft', 4.5],
  ['--cancel', '--cancel-soft', 4.5],
  ['--max', '--max-soft', 4.5],
  ['--fg', '--punch-ok-fill', 4.5],
  ['--fg-muted', '--punch-ok-fill', 4.5],
  ['--punch-ok-line', '--punch-ok-fill', 4.5],
  ['--punch-miss-fg', '--punch-miss-fill', 4.5],
  ['--fg', '--punch-order-fill', 4.5],
  ['--fg-muted', '--punch-order-fill', 4.5],
  ['--punch-order-line', '--punch-order-fill', 4.5],
  // non-text: control borders, the focus ring on the page
  ['--border-strong', '--bg-elev', 3],
  ['--border-strong', '--bg-sunken', 3],
  ['--fg', '--bg-elev', 3],
];

const root = block(':root');
const MODES: Record<string, Record<string, string>> = {
  default: root,
  'bright-sun': { ...root, ...block('.contrast-high') },
};

function resolve(tokens: Record<string, string>, v: string): string {
  if (!v.startsWith('--')) return v;
  const value = tokens[v];
  if (value === undefined) throw new Error(`token ${v} missing`);
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  return ref ? resolve(tokens, ref[1]!) : value;
}

describe.each(Object.entries(MODES))('tokens.css contrast — %s', (_mode, tokens) => {
  it.each(PAIRS)('%s on %s ≥ %d:1', (fg, bg, floor) => {
    const r = ratio(resolve(tokens, fg), resolve(tokens, bg));
    // PRINT_CONTRAST=1 prints the table for docs/design-lab/README.md.
    if (process.env['PRINT_CONTRAST'])
      console.log(`| ${_mode} | \`${fg}\` | \`${bg}\` | ${r.toFixed(2)} | ${floor} |`);
    expect(r).toBeGreaterThanOrEqual(floor);
  });
});

describe('accent variants keep button text readable', () => {
  it.each(['blue', 'magenta', 'charcoal'])('%s', (accent) => {
    const tokens = { ...root, ...block(`[data-accent='${accent}']`) };
    expect(
      ratio(resolve(tokens, '--accent-fg'), resolve(tokens, '--accent'))
    ).toBeGreaterThanOrEqual(4.5);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @fartola/web exec vitest run src/lib/tokens.contrast.test.ts`
Expected: FAIL — `token --mp-fg missing`, `--fg-faint on --bg` 2.72,
`--ok on --ok-soft` 3.91, `--fg-muted on --bg` 5.65, and more.

- [ ] **Step 3: Change `tokens.css`**

In `:root`, replace these values:

```css
--radius: 6px;
--radius-lg: 8px;
--shadow-sm: 0 0 0 1px var(--border);
--shadow-md: 0 0 0 1px var(--border);

--fg-muted: oklch(0.42 0.01 240);
--fg-faint: oklch(0.52 0.01 240);
--border-strong: oklch(0.62 0.005 90);

--ok: oklch(0.46 0.13 145);
--dnf: oklch(0.48 0.18 25);
--dns: oklch(0.46 0.04 240);
--dq: oklch(0.46 0.16 320);
--cancel: oklch(0.46 0.02 220);
--max: oklch(0.46 0.15 50);
```

and add after the status block (keep `--shadow-lg` as it is: the modal
and drawer float over a scrim, elevation means something there):

```css
/* MP text on --mp-soft: --mp itself is too light for text (2.33:1). */
--mp-fg: oklch(0.45 0.12 70);

/* Punch tiles (spec "Punch tiles"): each state differs in lightness,
     border and word, not only in hue. */
--punch-ok-fill: oklch(0.93 0.06 150);
--punch-ok-line: oklch(0.42 0.11 150);
--punch-miss-fill: oklch(0.44 0.17 27);
--punch-miss-fg: #ffffff;
--punch-order-fill: oklch(0.93 0.08 85);
--punch-order-line: oklch(0.45 0.11 65);

--icon-sm: 16px;
--icon-md: 20px;
--icon-lg: 24px;
```

In `.contrast-high`, add:

```css
--mp-fg: #8a4a00;
--punch-ok-fill: #d8eedd;
--punch-ok-line: #005f1a;
--punch-miss-fill: #8a0010;
--punch-order-fill: #ffe9b3;
--punch-order-line: #5c3200;
```

- [ ] **Step 4: Flat card and modal**

`apps/web/src/lib/ui/Card.svelte`: delete the line
`box-shadow: var(--shadow-sm);` from `.card` (border + ring would draw a
2 px edge). `apps/web/src/lib/ui/Modal.svelte:74`: `border-radius: 14px;`
→ `border-radius: var(--radius-lg);` and add `border: 1px solid var(--border);`
(the modal keeps `--shadow-lg`: it floats over a scrim, spec "Card / Modal look").

- [ ] **Step 4b: Green only for meaning** (spec "Rules that come with the tokens")

- `components/LatestReadCard.svelte` `.card-num`: `color: var(--accent-strong);` → `color: var(--fg);`.
- `layout/NavItem.svelte` `.nav-item.active`: `background: var(--accent-soft); color: var(--accent-strong);`
  → `background: var(--bg-sunken); color: var(--fg); font-weight: 600;`; its
  `::before` bar `background: var(--accent);` → `background: var(--fg);`.
- `components/HistoryRow.svelte` `.hist-row.active`: `background: var(--accent-soft);`
  → `background: var(--bg-sunken);`; `.hist-row.active::before` `background: var(--accent);`
  → `background: var(--fg);`. The new-read flash (`flashIn`, accent-soft) stays: it
  says "this just arrived".

Grep afterwards: `grep -n "accent" apps/web/src/lib/components/LatestReadCard.svelte apps/web/src/lib/layout/NavItem.svelte apps/web/src/lib/components/HistoryRow.svelte`
— remaining uses are the primary button, the active status chip and the flash.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @fartola/web exec vitest run src/lib/tokens.contrast.test.ts`
Expected: PASS (46 + 3 cases). Lowest values: `--fg-muted` on
`--pend-soft` 7.09 (default), `--border-strong` on `--bg-sunken` 3.24.

- [ ] **Step 6: Gate and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`

```bash
git add apps/web/src/lib/tokens.css apps/web/src/lib/tokens.contrast.test.ts apps/web/src/lib/ui/Card.svelte apps/web/src/lib/ui/Modal.svelte \
  apps/web/src/lib/components/LatestReadCard.svelte apps/web/src/lib/layout/NavItem.svelte apps/web/src/lib/components/HistoryRow.svelte
git commit -m "feat(web): darken text and status tokens to meet adr-0016 contrast"
```

---

### Task 4: Lucide icons instead of emoji and symbols

**Files:**

- Modify: `apps/web/src/lib/ui/Icon.svelte` (whole file)
- Create: `scripts/check-icons.mjs`
- Modify: `package.json` (root, `lint` script)
- Modify (symbol sites, exact list in Step 5): `components/LatestReadCard.svelte`,
  `components/HistoryRow.svelte`, `screens/ReadoutView.svelte`,
  `layout/StationCard.svelte`, `layout/ActiveCompetitionPill.svelte`,
  `screens/WizardStep1.svelte`, `screens/WizardStep3.svelte`,
  `screens/NewCompetitionWizard.svelte`, `components/DropZone.svelte`,
  `screens/ExportView.svelte`, `components/RadioStatusPanel.svelte`,
  `i18n/sv.json`, `i18n/en.json`, and the component that renders
  `readout.hyrbricka.title` (find with `grep -rn "readout.hyrbricka.title" apps/web/src --include=*.svelte`).
- Delete when done: `.planning/todos/pending/2026-10-06-svg-icons-instead-of-emoji.md`
  (move to `.planning/todos/done/` if that directory exists).

**Interfaces:**

- Produces: `<Icon name={IconName} size?={number} decorative?={boolean} />`
  (same API as today) with `IconName` exported from
  `ui/Icon.svelte`'s module script. New names: `printer`, `arrow-right`,
  `arrow-left`, `arrow-left-right`, `minus`, `play`, `folder-open`,
  `corner-down-right`, `credit-card`, `circle`. Task 7 uses `check`, `x`,
  `arrow-left-right`, `plus`, `minus`.

- [ ] **Step 1: Write the icon gate**

```js
// scripts/check-icons.mjs
// Authored for fartola. Not ported from upstream.
//
// Gate: no emoji or pictographic symbols used as icons in the web UI
// (todo 2026-10-06, ui-ux-pro-max no-emoji-icons). Icons come from
// <Icon> (Lucide). Comments are ignored; arrows in prose (→ ←) are allowed.
// Receipt templates print plain text and are excluded.
// Run: node scripts/check-icons.mjs   (part of `pnpm lint`).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'apps/web/src');
const BANNED = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}↳⇄▢▶▾●]/u;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'receipt-templates') yield* files(p);
    } else if (
      (name.endsWith('.svelte') ||
        (p.includes(`${path.sep}i18n${path.sep}`) && name.endsWith('.json'))) &&
      !name.includes('.test.')
    ) {
      yield p;
    }
  }
}

export function stripComments(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '');
}

const errors = [];
for (const file of files(SRC)) {
  stripComments(readFileSync(file, 'utf8'))
    .split('\n')
    .forEach((line, i) => {
      const m = line.match(BANNED);
      if (m) errors.push(`${path.relative(ROOT, file)}:${i + 1}: "${m[0]}" — use <Icon> instead`);
    });
}
if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`\n${errors.length} icon-like symbol(s) found.`);
  process.exit(1);
}
console.log('check-icons: ok');
```

Root `package.json`: add `"lint:icons": "node scripts/check-icons.mjs",`
and append ` && pnpm run lint:icons` to the `lint` script.

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/check-icons.mjs`
Expected: exit 1, about 20 findings (LatestReadCard ↳ ▢ ⚠ 🖨 ✎, HistoryRow ⚠,
ReadoutView ⚠, StationCard ●, ActiveCompetitionPill ●, WizardStep1 📁 ✓,
WizardStep3 ✓ ▶, DropZone ✓, ExportView ✓ ✗, RadioStatusPanel ✕ ✓,
sv.json/en.json ⚠️).

- [ ] **Step 3: Add Lucide**

Run: `pnpm --filter @fartola/web add @lucide/svelte`
Check `apps/web/node_modules/@lucide/svelte/package.json` → licence ISC.
If an import path below fails, look it up with context7
(`@lucide/svelte`); icons live at `@lucide/svelte/icons/<kebab-name>`.

- [ ] **Step 4: Replace `ui/Icon.svelte`** (same props; existing 30 call
      sites keep working)

```svelte
<!--
  Authored for fartola. Not ported from upstream.

  Icon — one icon set (Lucide, ISC) behind a small name map, so call
  sites stay `<Icon name="x" />` and only the icons we use are bundled.
  Decorative icons (next to a text label) are aria-hidden; a standalone
  icon must pass decorative={false} and an aria-label.
-->
<script module lang="ts">
  import type { Component } from 'svelte';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Circle from '@lucide/svelte/icons/circle';
  import CornerDownRight from '@lucide/svelte/icons/corner-down-right';
  import CreditCard from '@lucide/svelte/icons/credit-card';
  import Download from '@lucide/svelte/icons/download';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import House from '@lucide/svelte/icons/house';
  import Info from '@lucide/svelte/icons/info';
  import Key from '@lucide/svelte/icons/key';
  import List from '@lucide/svelte/icons/list';
  import Menu from '@lucide/svelte/icons/menu';
  import Minus from '@lucide/svelte/icons/minus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Play from '@lucide/svelte/icons/play';
  import Plus from '@lucide/svelte/icons/plus';
  import Printer from '@lucide/svelte/icons/printer';
  import Radio from '@lucide/svelte/icons/radio';
  import Search from '@lucide/svelte/icons/search';
  import Settings from '@lucide/svelte/icons/settings';
  import Shuffle from '@lucide/svelte/icons/shuffle';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import UserPlus from '@lucide/svelte/icons/user-plus';
  import Users from '@lucide/svelte/icons/users';
  import X from '@lucide/svelte/icons/x';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ICONS: Record<string, Component<any>> = {
    home: House,
    radio: Radio,
    list: List,
    'arrow-up-right': ArrowUpRight,
    download: Download,
    key: Key,
    settings: Settings,
    check: Check,
    menu: Menu,
    x: X,
    users: Users,
    'user-plus': UserPlus,
    search: Search,
    plus: Plus,
    edit: Pencil,
    info: Info,
    'chevron-right': ChevronRight,
    'chevron-down': ChevronDown,
    shuffle: Shuffle,
    'alert-triangle': TriangleAlert,
    printer: Printer,
    'arrow-right': ArrowRight,
    'arrow-left': ArrowLeft,
    'arrow-left-right': ArrowLeftRight,
    minus: Minus,
    play: Play,
    'folder-open': FolderOpen,
    'corner-down-right': CornerDownRight,
    'credit-card': CreditCard,
    circle: Circle,
  };
  export type IconName =
    | 'home' | 'radio' | 'list' | 'arrow-up-right' | 'download' | 'key' | 'settings'
    | 'check' | 'menu' | 'x' | 'users' | 'user-plus' | 'search' | 'plus' | 'edit'
    | 'info' | 'chevron-right' | 'chevron-down' | 'shuffle' | 'alert-triangle'
    | 'printer' | 'arrow-right' | 'arrow-left' | 'arrow-left-right' | 'minus'
    | 'play' | 'folder-open' | 'corner-down-right' | 'credit-card' | 'circle';
</script>

<script lang="ts">
  interface Props {
    name: IconName;
    size?: number;
    /** Decorative icons (paired with a text label) get aria-hidden;
     * standalone icons MUST set this false AND pass an aria-label. */
    decorative?: boolean;
    'aria-label'?: string;
    fill?: string;
    class?: string;
  }

  let { name, size = 18, decorative = true, ...rest }: Props = $props();
  const Glyph = $derived(ICONS[name]!);
</script>

<Glyph
  {size}
  strokeWidth={2}
  aria-hidden={decorative ? 'true' : undefined}
  role={decorative ? undefined : 'img'}
  {...rest}
/>
```

Run `pnpm exec prettier --write apps/web/src/lib/ui/Icon.svelte` (it
re-wraps the union).

- [ ] **Step 5: Replace the symbol sites.** Import Icon where missing
      (`import Icon from '../ui/Icon.svelte';` — adjust the relative path).
      Put the icon before the text unless noted.

| File:line (today)                              | Now                                                    | Becomes                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/LatestReadCard.svelte:206`         | `↳ {t('ro.simulate')}`                                 | `<Icon name="corner-down-right" size={16} /> {t('ro.simulate')}`                                                                                                 |
| `components/LatestReadCard.svelte:214`         | `<div class="blink mono">SI ▢</div>`                   | `<div class="blink"><Icon name="credit-card" size={32} /></div>`                                                                                                 |
| `components/LatestReadCard.svelte:224`         | `⚠ {t('ro.unknownCard')}`                              | `<Icon name="alert-triangle" size={24} /> {t('ro.unknownCard')}`                                                                                                 |
| `components/LatestReadCard.svelte:275`         | `⚠ {t(read.startWarning.key, …)}`                      | `<Icon name="alert-triangle" size={16} /> {t(read.startWarning.key, …)}`                                                                                         |
| `components/LatestReadCard.svelte:281`         | `<b>⚠ {t('ro.missingStart')}</b>`                      | `<b><Icon name="alert-triangle" size={16} /> {t('ro.missingStart')}</b>`                                                                                         |
| `components/LatestReadCard.svelte:318`         | `🖨 {t('ro.print')}`                                    | `<Icon name="printer" size={20} /> {t('ro.print')}`                                                                                                              |
| `components/LatestReadCard.svelte:327`         | `✎ {t('ro.edit')}`                                     | `<Icon name="edit" size={20} /> {t('ro.edit')}`                                                                                                                  |
| `components/HistoryRow.svelte:63`              | `{row.unknown ? '⚠ Okänd bricka' : (row.name ?? '—')}` | `{#if row.unknown}<Icon name="alert-triangle" size={16} /> {t('ro.unknownCard')}{:else}{row.name ?? '—'}{/if}` (import `t` from `#lib/i18n/index.ts` if missing) |
| `screens/ReadoutView.svelte:325`               | `cls: cls?.name ?? (r.unmatched ? '⚠' : '—'),`         | `cls: cls?.name ?? '—',`                                                                                                                                         |
| `screens/ReadoutView.svelte:865`               | `<span class="cta">→ {t('ro.register')}</span>`        | `<span class="cta">{t('ro.register')} <Icon name="arrow-right" size={16} /></span>`                                                                              |
| `layout/StationCard.svelte:79`                 | `● {label}`                                            | `<Icon name="circle" size={10} fill="currentColor" /> {label}`                                                                                                   |
| `layout/ActiveCompetitionPill.svelte:169`      | `<span class="row-check" aria-hidden="true">●</span>`  | `<span class="row-check"><Icon name="check" size={16} /></span>`                                                                                                 |
| `screens/WizardStep1.svelte:270`               | `📁 {t('wiz.step1.quickstart.button')}`                | `<Icon name="folder-open" size={20} /> {t(…)}`                                                                                                                   |
| `screens/WizardStep1.svelte:278`, `:330`       | `<span class="ok-icon" aria-hidden="true">✓</span>`    | `<span class="ok-icon"><Icon name="check" size={18} /></span>`                                                                                                   |
| `screens/WizardStep3.svelte:157`               | `✓ {t('wiz.detected')} · …`                            | `<Icon name="check" size={18} /> {t('wiz.detected')} · …`                                                                                                        |
| `screens/WizardStep3.svelte:173`               | `▶ {t('wiz.start')}`                                   | `<Icon name="play" size={18} /> {t('wiz.start')}`                                                                                                                |
| `screens/NewCompetitionWizard.svelte:269`      | `← {t('wiz.back')}`                                    | `<Icon name="arrow-left" size={18} /> {t('wiz.back')}`                                                                                                           |
| `screens/NewCompetitionWizard.svelte:284`      | `{t('wiz.next')} →`                                    | `{t('wiz.next')} <Icon name="arrow-right" size={18} />`                                                                                                          |
| `components/DropZone.svelte:124`               | `<div class="icon ok">✓</div>`                         | `<div class="icon ok"><Icon name="check" size={28} /></div>`                                                                                                     |
| `components/DropZone.svelte:128`               | `<div class="icon">↓ XML</div>`                        | `<div class="icon"><Icon name="download" size={28} /> XML</div>`                                                                                                 |
| `screens/ExportView.svelte:158`                | `<strong>✓ Validering OK</strong>`                     | `<strong><Icon name="check" size={18} /> Validering OK</strong>`                                                                                                 |
| `screens/ExportView.svelte:166`                | `<strong>✗ XSD-fel</strong>`                           | `<strong><Icon name="x" size={18} /> XSD-fel</strong>` (wording: plan 2)                                                                                         |
| `screens/ExportView.svelte:214`                | `↓ Hämta ResultList.xml`                               | `<Icon name="download" size={18} /> Hämta ResultList.xml`                                                                                                        |
| `components/RadioStatusPanel.svelte:66`, `:68` | `✕ {t(…)}`                                             | `<Icon name="x" size={16} /> {t(…)}`                                                                                                                             |
| `components/RadioStatusPanel.svelte:70`        | `✓ {t('radio.linkOk')}`                                | `<Icon name="check" size={16} /> {t('radio.linkOk')}`                                                                                                            |
| `i18n/sv.json:303`, `i18n/en.json:303`         | `"⚠️ Hyrbricka — …"` / `"⚠️ Hired card — …"`           | drop `⚠️ `; in the component that renders `readout.hyrbricka.title`, put `<Icon name="alert-triangle" size={20} />` before `{t('readout.hyrbricka.title')}`      |

Line numbers drift; find each by its text. If a symbol sits in a
flex container, make sure the container has `align-items: center` and a
`gap` of `var(--space-2xs)`–`var(--space-xs)` (no double spaces).

- [ ] **Step 6: Run the gate and the tests that cover these components**

Run: `node scripts/check-icons.mjs && pnpm --filter @fartola/web test`
Expected: `check-icons: ok`; all web tests pass. If a test matched a
removed symbol (e.g. text `'⚠ Okänd bricka'`), update the assertion to
the text without the symbol in this commit.

- [ ] **Step 7: Full gate, e2e, close the todo, commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`

```bash
git mv .planning/todos/pending/2026-10-06-svg-icons-instead-of-emoji.md .planning/todos/done/ 2>/dev/null \
  || git rm .planning/todos/pending/2026-10-06-svg-icons-instead-of-emoji.md
git add package.json pnpm-lock.yaml apps/web/package.json scripts/check-icons.mjs apps/web/src/lib/ui/Icon.svelte \
  apps/web/src/lib/components/LatestReadCard.svelte apps/web/src/lib/components/HistoryRow.svelte \
  apps/web/src/lib/screens/ReadoutView.svelte apps/web/src/lib/layout/StationCard.svelte \
  apps/web/src/lib/layout/ActiveCompetitionPill.svelte apps/web/src/lib/screens/WizardStep1.svelte \
  apps/web/src/lib/screens/WizardStep3.svelte apps/web/src/lib/screens/NewCompetitionWizard.svelte \
  apps/web/src/lib/components/DropZone.svelte apps/web/src/lib/screens/ExportView.svelte \
  apps/web/src/lib/components/RadioStatusPanel.svelte apps/web/src/lib/i18n/sv.json apps/web/src/lib/i18n/en.json
# plus the hyrbricka-title component and any test you updated:
git status --short
git commit -m "feat(web): use lucide icons instead of emoji and unicode symbols"
```

---

### Task 5: StatusPill shows SOFT words, never codes

**Files:**

- Modify: `apps/web/src/lib/ui/StatusPill.svelte` (markup line with
  `{label ?? status}`; style block)
- Create: `apps/web/src/lib/ui/StatusPill.test.ts`
- Modify: `apps/web/src/lib/i18n/sv.json` (`status.MP`, `status.DNF`, `status.DQ`)
- Modify: `apps/web/src/lib/screens/readout-types.ts:381` and
  `readout-types.test.ts:66` (comments naming the old words)

**Interfaces:**

- Consumes: `--mp-fg` (Task 3).
- Produces: `<StatusPill status label? small? tooltip? />` unchanged
  API; without `label` it renders `t('status.<code>')`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/ui/StatusPill.test.ts
// Authored for fartola. Not ported from upstream.
//
// X3 (UI audit 2026-10-09): a pill never shows a raw status code; without
// a label it shows the operator word (status.*), with a label (results:
// SOFT's published word) it shows that.

import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import StatusPill from './StatusPill.svelte';

let instance: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (instance) void unmount(instance);
  instance = null;
  document.body.innerHTML = '';
});

function text(props: {
  status: 'OK' | 'MP' | 'DNF' | 'PEND' | 'DNS' | 'DQ' | 'CANCEL' | 'MAX';
  label?: string;
}): string {
  instance = mount(StatusPill, { target: document.body, props: { ...props, tooltip: false } });
  flushSync();
  return document.body.querySelector('.status')?.textContent?.trim() ?? '';
}

describe('StatusPill label', () => {
  it.each([
    ['OK', 'Godkänd'],
    ['MP', 'Felstämplad'],
    ['DNF', 'Utgått'],
    ['PEND', 'Väntar'],
    ['DNS', 'Ej start'],
    ['DQ', 'Diskad'],
    ['CANCEL', 'Återbud'],
    ['MAX', 'Maxtid'],
  ] as const)('%s → "%s"', (status, word) => {
    expect(text({ status })).toBe(word);
  });

  it('uses the label it is given (results pass SOFT words)', () => {
    expect(text({ status: 'MP', label: 'Ej godkänd' })).toBe('Ej godkänd');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @fartola/web exec vitest run src/lib/ui/StatusPill.test.ts`
Expected: FAIL — `OK → "Godkänd"` received `"OK"`; MP received `"MP"`.

- [ ] **Step 3: Implement**

`StatusPill.svelte` markup: `{label ?? status}` → ``{label ?? t(`status.${status}`)}``.

Style block: in `.status` replace

```css
font-size: var(--fs-caption);
font-weight: 600;
font-family: var(--font-mono);
letter-spacing: 0.02em;
```

with

```css
font-size: var(--fs-label);
font-weight: 600;
font-family: var(--font-ui);
```

`.status.mp { color: oklch(0.45 0.12 70); }` → `color: var(--mp-fg);`.
`.status.small { padding: 2px 8px; font-size: 11px; }` →
`.status.small { padding: 2px 8px; }`.

`sv.json`: `"status.MP": "Felstämplad"`, `"status.DNF": "Utgått"`,
`"status.DQ": "Diskad"` (en.json unchanged).

Comments: `readout-types.ts:381` and `readout-types.test.ts:66` say
"Felstämpling, Bröt" → "Felstämplad, Utgått".

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @fartola/web exec vitest run src/lib/ui/StatusPill.test.ts && grep -rn "Felstämpling\|\"Bröt\"\|'Bröt'\|Disk\.\"" apps/web/src tests --include=*.ts --include=*.svelte`
Expected: PASS; grep prints nothing except `'Bröt loppet'` in
`tests/e2e/readout.spec.ts:215` (a reason text the test types; leave it).

- [ ] **Step 5: Gate, e2e, commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`
(`readout.spec.ts:220` selects `.status.dnf` — the class stays.)

```bash
git add apps/web/src/lib/ui/StatusPill.svelte apps/web/src/lib/ui/StatusPill.test.ts apps/web/src/lib/i18n/sv.json \
  apps/web/src/lib/screens/readout-types.ts apps/web/src/lib/screens/readout-types.test.ts
git commit -m "fix(web): show status words instead of codes in status pills"
```

---

### Task 6: 44 px targets, 14 px labels, visible focus

**Files:**

- Create: `tests/e2e/targets.spec.ts`
- Modify: `apps/web/src/lib/tokens.css` (focus rule, density)
- Modify: `apps/web/src/lib/ui/Button.svelte` (`.size-sm`)
- Modify: `apps/web/src/lib/ui/Input.svelte` (`.input:focus`), `ui/Select.svelte` (`.select:focus`)
- Modify: `apps/web/src/lib/components/LatestReadCard.svelte` (`.btn.sm`, `.status-chip`, `.kbd`, `.faint`, the 36 px inputs)
- Modify: `apps/web/src/lib/screens/KvarISkovenView.svelte` (`.btn.xs`)
- Modify: `apps/web/src/lib/screens/CompetitionInfoView.svelte` (`.ctrl-chip`)
- Modify: `apps/web/src/lib/layout/RacePhaseControl.svelte` (`.reset-btn`, the confirm buttons)
- Modify: `apps/web/src/lib/layout/StationCard.svelte` (`.reconnect-btn`, its `:focus-visible`)
- Modify: `apps/web/src/lib/screens/LottningView.svelte` (`.edit-btn`, `.edit-action-btn`)
- Modify: `apps/web/src/lib/layout/ActiveCompetitionPill.svelte` (`.pill:focus-visible`, `outline: none` ×2)

**Interfaces:**

- Consumes: `seedCompetition`, `simulateRead` (Task 1).
- axe's `target-size` (Task 11) only checks 24 px; this task's e2e test is
  what holds the 44 px rule.

- [ ] **Step 1: Write the failing e2e test**

```ts
// tests/e2e/targets.spec.ts
// Authored for fartola. Not ported from upstream.
//
// ADR-0016 rule 7: touch targets at least 44 px. Measures every visible
// button, link, input and select on the frame and the readout, including
// the opened manual-status picker and the start-race confirmation.
// Visually hidden elements (the skip link until focused) are not targets.

import { test, expect, type Page } from '@playwright/test';
import { seedCompetition, simulateRead } from './helpers/seed.ts';

test.describe.configure({ mode: 'serial' });

async function smallTargets(page: Page): Promise<string[]> {
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
            `${e.tagName.toLowerCase()} "${(e.textContent ?? '').trim().slice(0, 30)}" ${Math.round(e.getBoundingClientRect().height)}px`
        )
  );
}

test('frame and readout targets are at least 44 px', async ({ page, request }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const { competitionId } = await seedCompetition(request, { controls: 8 });
  await page.goto(`/competition/${competitionId}/readout`);
  await simulateRead(request, competitionId, 7_501_853, [31, 32, 33, 34, 35, 36, 37, 38]);
  await expect(page.getByTestId('print-btn')).toBeVisible({ timeout: 5_000 });
  expect(await smallTargets(page)).toEqual([]);

  await page.getByTestId('manual-dnf-btn').click();
  await expect(page.getByTestId('dnf-reason-input')).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);
});
```

Add a second case for the start-race confirmation: create a competition
without `start-race` (copy `seedCompetition`'s first four calls inline),
open the readout, click the start-race button in the sidebar
(`grep -n "data-testid" apps/web/src/lib/layout/RacePhaseControl.svelte`
gives its testid), wait for `start-race-cancel` to be visible, assert
`smallTargets(page)` is `[]`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm e2e targets`
Expected: FAIL listing e.g. `button "Återställ till förtävling" 32px`,
`button "Återanslut" 32px`, `input "" 36px` (reason input),
`button "Avbryt" 32px` (race confirm).

- [ ] **Step 3: Implement**

`tokens.css`, after the `button { … }` reset, add:

```css
/* One visible focus style (ADR-0016 rule 7, ui-ux-pro-max focus-states):
   2px ink ring with an offset, so it sits on the page (≥7:1), not on the
   control's own fill. */
:focus-visible {
  outline: 2px solid var(--fg);
  outline-offset: 2px;
}
```

Component rules that set their own focus outline win over this one, so
change them to the same ring (`outline: 2px solid var(--fg); outline-offset: 2px;`):
`ui/Input.svelte` `.input:focus` and `ui/Select.svelte` `.select:focus`
(today accent, offset -1px), `layout/StationCard.svelte`
`.reconnect-btn:focus-visible` and `layout/ActiveCompetitionPill.svelte`
`.pill:focus-visible` (today `var(--mp)` amber, about 2.3:1). In
`ActiveCompetitionPill.svelte` delete both `outline: none;` lines (the
`.row:focus-visible` background change stays). Check with
`grep -rn "outline" apps/web/src/lib --include=*.svelte`: every remaining
outline is either this ring or on a non-focus state.

`tokens.css` `[data-density='high']`: delete `--fs-body: 15px;`
(ADR-0016 rule 7: body ≥16 px; density high keeps the splits table).

`ui/Button.svelte` `.size-sm`:

```css
.size-sm {
  height: var(--hit);
  min-height: var(--hit);
  padding: 0 var(--space-sm);
  font-size: var(--fs-label);
}
```

`LatestReadCard.svelte`: `.btn.sm { height: var(--hit); padding: 0 12px; font-size: var(--fs-label); }`;
`.status-chip`: `height: 28px` → `height: var(--hit)`, `font-size: 12px` →
`var(--fs-label)`, `font-family: var(--font-mono)` → `var(--font-ui)`,
delete `letter-spacing: 0.02em;`, `color: var(--fg-muted)` → `var(--fg)`;
the rule with `height: 36px` (reason and start-time inputs, ~line 614)
→ `height: var(--hit)`; `.kbd { font-size: 11px }` → `var(--fs-label)`;
`.faint { font-size: 12px }` → `font-size: var(--fs-label); color: var(--fg-muted);`.

The custom controls (X6): in each block add `min-height: var(--hit);`
and set `font-size: var(--fs-label);` (replacing 12/13 px):
`KvarISkovenView .btn.xs` (also `padding: 0 var(--space-sm)`),
`CompetitionInfoView .ctrl-chip`, `RacePhaseControl .reset-btn` (replace
`min-height: 32px`), the `RacePhaseControl` rule with `min-height: 32px`
at ~line 277 (the confirm buttons), `StationCard .reconnect-btn`
(replace `min-height: 32px`), `LottningView .edit-btn` (also
`padding: 0 var(--space-xs)`) and `.edit-action-btn` (also
`padding: 0 var(--space-sm)`). Where two such controls sit side by side,
make the parent's `gap` at least `var(--space-xs)`
(`LottningView .edit-actions { gap: 4px }` → `var(--space-xs)`).

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm e2e targets`
Expected: PASS (2 tests). A remaining hit names the element and its
height; fix it in the component that owns it.

- [ ] **Step 5: Gate, e2e, commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`

```bash
git add tests/e2e/targets.spec.ts apps/web/src/lib/tokens.css apps/web/src/lib/ui/Button.svelte \
  apps/web/src/lib/ui/Input.svelte apps/web/src/lib/ui/Select.svelte apps/web/src/lib/components/LatestReadCard.svelte \
  apps/web/src/lib/screens/KvarISkovenView.svelte apps/web/src/lib/screens/CompetitionInfoView.svelte \
  apps/web/src/lib/layout/RacePhaseControl.svelte apps/web/src/lib/layout/StationCard.svelte \
  apps/web/src/lib/screens/LottningView.svelte apps/web/src/lib/layout/ActiveCompetitionPill.svelte
git commit -m "fix(web): make small controls 44 px with 14 px labels and a focus ring"
```

---

### Task 7: Punch tiles readable for everyone

**Files:**

- Modify: `apps/web/src/lib/components/PunchGrid.svelte` (whole file)
- Create: `apps/web/src/lib/components/PunchGrid.test.ts`
- Modify: `apps/web/src/lib/screens/ReadoutView.svelte` (the
  `<PunchGrid punches={receiptRead.punches} />` line)
- Modify: `apps/web/src/lib/i18n/sv.json`, `en.json` (new key `ro.missing`)

**Interfaces:**

- Consumes: `--punch-*`, `--icon-md` (Task 3); `Icon` names `check`, `x`,
  `arrow-left-right`, `plus`, `minus` (Task 4); `punchLabel`, `punchNo`
  from `components/receipt-templates/punchLabels.ts` (unchanged).
- Produces: `<PunchGrid punches={ReceiptPunch[]} verdict?={boolean} />`;
  root has `data-size="large" | "medium"`, each tile `data-state` ∈
  `ok | miss | order | extra | struck | finish | plain`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/components/PunchGrid.test.ts
// Authored for fartola. Not ported from upstream.
//
// Punch tiles (design-lab spec): every state says what it is in words,
// tiles shrink above 20 course controls, and without a course no tile
// claims to be correct.

import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import PunchGrid from './PunchGrid.svelte';
import type { ReceiptPunch } from './receipt-templates/types.ts';

const ok = (code: number): ReceiptPunch => ({ code, split: '2:00', time: '2:00', ok: true });
const finish: ReceiptPunch = {
  code: 'F' as unknown as number,
  split: '0:41',
  time: '30:00',
  finish: true,
};

let instance: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (instance) void unmount(instance);
  instance = null;
  document.body.innerHTML = '';
});

function render(punches: ReceiptPunch[], verdict = true): HTMLElement {
  instance = mount(PunchGrid, { target: document.body, props: { punches, verdict } });
  flushSync();
  return document.body.querySelector('[data-testid="punch-grid"]')!;
}
const tiles = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.punch')];
const bottom = (tile: HTMLElement) => tile.querySelector('.split, .label')?.textContent?.trim();

describe('PunchGrid states', () => {
  const grid = () =>
    render([
      ok(31),
      { code: 32, split: '—', time: '—', ok: false },
      { ...ok(33), kind: 'struck' },
      ok(34),
      { ...ok(32), kind: 'order' },
      { code: 99, split: '0:48', time: '9:00', ok: false, kind: 'extra' },
      finish,
    ]);

  it('labels each state in words', () => {
    const t = tiles(grid());
    expect(t.map((x) => x.dataset['state'])).toEqual([
      'ok',
      'miss',
      'struck',
      'ok',
      'order',
      'extra',
      'finish',
    ]);
    expect(t.map(bottom)).toEqual([
      '2:00',
      'saknas',
      'struken',
      '2:00',
      'fel ordn.',
      'extra',
      '0:41',
    ]);
  });

  it('gives every non-finish state an icon', () => {
    const t = tiles(grid());
    expect(t.slice(0, 6).every((x) => x.querySelector('svg'))).toBe(true);
    expect(t[6]!.querySelector('svg')).toBeNull();
  });
});

describe('PunchGrid size follows course length', () => {
  const course = (n: number) => Array.from({ length: n }, (_, i) => ok(31 + i));
  it('20 course controls plus extras and finish → large', () => {
    const extras: ReceiptPunch[] = [
      { ...ok(99), ok: false, kind: 'extra' },
      { ...ok(98), ok: false, kind: 'extra' },
    ];
    expect(render([...course(20), ...extras, finish]).dataset['size']).toBe('large');
  });
  it('21 course controls → medium', () => {
    expect(render([...course(21), finish]).dataset['size']).toBe('medium');
  });
  it('struck controls count as course controls', () => {
    expect(render([...course(20), { ...ok(60), kind: 'struck' }, finish]).dataset['size']).toBe(
      'medium'
    );
  });
});

describe('PunchGrid without a course', () => {
  it('shows plain tiles: no check, no verdict', () => {
    const t = tiles(render([ok(31), ok(45), finish], false));
    expect(t.map((x) => x.dataset['state'])).toEqual(['plain', 'plain', 'finish']);
    expect(t.some((x) => x.querySelector('svg'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @fartola/web exec vitest run src/lib/components/PunchGrid.test.ts`
Expected: FAIL — `dataset.state` undefined, no `.label`.

- [ ] **Step 3: Add the i18n key**

`sv.json` next to `ro.struck`: `"ro.missing": "saknas",`;
`en.json`: `"ro.missing": "missing",`.

- [ ] **Step 4: Replace `PunchGrid.svelte`**

```svelte
<!--
  Authored for fartola. Not ported from upstream.

  PunchGrid — the runner's controls in course order, then appended
  punches, then the finish. Each state differs in lightness, border, icon
  and word, so it reads without colour (design-lab spec "Punch tiles";
  ADR-0016 rule 7): ok, miss ("saknas"), order ("fel ordn."), extra,
  struck ("struken"), finish. Without a course (`verdict` false) tiles
  are plain punches: nothing claims correct or missing.

  Size follows course length: large up to 20 course controls (struck
  included, appended punches and finish not), medium above, so a long
  course keeps the action bar in view at 768 px.

  Renders when Tweaks density is 'low' or 'med'; SplitsTable replaces it
  at 'high' (ReadoutView owns that toggle).
-->
<script lang="ts">
  import type { ReceiptPunch } from './receipt-templates/types.ts';
  import { punchLabel, punchNo } from './receipt-templates/punchLabels.ts';
  import Icon, { type IconName } from '../ui/Icon.svelte';
  import { t } from '#lib/i18n/index.ts';

  interface Props {
    punches: ReceiptPunch[];
    /** False when the runner's class has no course. */
    verdict?: boolean;
  }

  let { punches, verdict = true }: Props = $props();

  const LARGE_MAX = 20;
  const courseCount = $derived(
    punches.filter((p) => !p.finish && (p.kind === undefined || p.kind === 'struck')).length
  );
  const size = $derived(courseCount > LARGE_MAX ? 'medium' : 'large');

  type State = 'ok' | 'miss' | 'order' | 'extra' | 'struck' | 'finish' | 'plain';
  const ICON: Partial<Record<State, IconName>> = {
    ok: 'check',
    miss: 'x',
    order: 'arrow-left-right',
    extra: 'plus',
    struck: 'minus',
  };

  function stateOf(p: ReceiptPunch): State {
    if (p.finish) return 'finish';
    if (p.kind) return p.kind;
    if (!verdict) return 'plain';
    return p.ok ? 'ok' : 'miss';
  }

  function bottomText(p: ReceiptPunch, s: State): string {
    if (s === 'miss') return t('ro.missing');
    if (s === 'order' || s === 'extra' || s === 'struck') return punchLabel(p) ?? '';
    return p.split;
  }
</script>

<div class="punch-grid {size}" data-testid="punch-grid" data-size={size}>
  {#each punches as p, i (i)}
    {@const s = stateOf(p)}
    {@const icon = ICON[s]}
    <div class="punch {s}" data-state={s}>
      <div class="top">
        <span class="idx mono">{p.finish ? '' : punchNo(punches, i).replace('.', '')}</span>
        {#if icon}<Icon name={icon} size={size === 'large' ? 20 : 16} />{/if}
      </div>
      <span class="code mono">
        {#if p.finish}M{:else if s === 'struck'}<s>{p.code}</s>{:else}{p.code}{/if}
      </span>
      <span class={s === 'ok' || s === 'finish' || s === 'plain' ? 'split mono' : 'label'}>{bottomText(p, s)}</span>
    </div>
  {/each}
</div>

<style>
  .punch-grid {
    display: grid;
    gap: 7px;
    margin-top: 4px;
  }
  .punch-grid.large {
    grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  }
  .punch-grid.medium {
    grid-template-columns: repeat(auto-fill, minmax(62px, 1fr));
    gap: 6px;
  }
  .punch {
    border: 1.5px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--bg-elev);
    color: var(--fg);
    padding: 5px 7px;
    display: grid;
    grid-template-rows: auto 1fr auto;
  }
  .large .punch {
    min-height: 80px;
  }
  .medium .punch {
    min-height: 66px;
    padding: 4px 6px;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: var(--fs-label);
    font-weight: 600;
  }
  .idx {
    color: var(--fg-muted);
    font-weight: 500;
  }
  .code {
    font-weight: 600;
    align-self: center;
    line-height: 1.1;
  }
  .large .code {
    font-size: 24px;
  }
  .medium .code {
    font-size: 20px;
  }
  .split {
    font-size: 15px;
  }
  .medium .split {
    font-size: var(--fs-label);
  }
  .label {
    font-family: var(--font-ui);
    font-size: var(--fs-label);
    font-weight: 600;
    white-space: nowrap;
  }
  .medium .label {
    font-size: 13px;
  }
  .punch.ok {
    background: var(--punch-ok-fill);
    border-color: var(--punch-ok-line);
    color: var(--punch-ok-line);
  }
  .punch.ok .code,
  .punch.ok .split {
    color: var(--fg);
  }
  .punch.miss {
    background: var(--punch-miss-fill);
    border-color: var(--punch-miss-fill);
    color: var(--punch-miss-fg);
  }
  .punch.miss .idx {
    color: var(--punch-miss-fg);
  }
  .punch.order {
    background: var(--punch-order-fill);
    border: 3px solid var(--punch-order-line);
    color: var(--punch-order-line);
  }
  .punch.order .code {
    color: var(--fg);
  }
  .punch.extra {
    background: var(--bg-sunken);
    border: 2px dashed var(--border-strong);
    color: var(--fg-muted);
  }
  .punch.extra .code {
    color: var(--fg);
  }
  .punch.struck {
    background: var(--bg-sunken);
    border: 2px dotted var(--border-strong);
    color: var(--fg-muted);
  }
  .punch.struck .code s {
    text-decoration-thickness: 2px;
  }
  .punch.finish {
    border: 3px solid var(--fg);
  }
  .mono {
    font-family: var(--font-mono);
    font-feature-settings:
      'tnum' 1,
      'zero' 1;
  }
</style>
```

`ReadoutView.svelte`: `<PunchGrid punches={receiptRead.punches} />` →
`<PunchGrid punches={receiptRead.punches} verdict={(currentRow?.expected_codes?.length ?? 0) > 0} />`
(`currentRow` is the row `receiptRead` is built from, line ~297; if
`expected_codes` is typed non-optional drop the `?.`).

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @fartola/web exec vitest run src/lib/components/PunchGrid.test.ts`
Expected: PASS (6 tests). If the `punchNo` index for struck/extra
differs from the test's expectation, the test only checks `data-state`
and bottom text — do not change `punchNo`.

- [ ] **Step 6: Gate, e2e, commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`

```bash
git add apps/web/src/lib/components/PunchGrid.svelte apps/web/src/lib/components/PunchGrid.test.ts \
  apps/web/src/lib/screens/ReadoutView.svelte apps/web/src/lib/i18n/sv.json apps/web/src/lib/i18n/en.json
git commit -m "feat(readout): make punch tiles readable without colour and size them by course"
```

---

### Task 8: Frame at tablet width

**Files:**

- Create: `apps/web/src/lib/layout/breakpoints.ts`
- Modify: `apps/web/src/lib/layout/AppShell.svelte` (script, `.sidebar-slot`, `@media`)
- Modify: `apps/web/src/lib/layout/TopBar.svelte` (`@media (max-width: 720px)`)
- Modify: `apps/web/src/lib/layout/Sidebar.svelte` (`.sidebar`)
- Modify: `apps/web/src/lib/screens/ReadoutView.svelte` (root markup + `.readout` styles)
- Create: `apps/web/src/lib/layout/AppShell.test.ts`
- Create: `tests/e2e/layout.spec.ts`

**Interfaces:**

- Produces: `DRAWER_MAX_PX = 1024`, `DRAWER_QUERY = '(max-width: 1024px)'`
  from `layout/breakpoints.ts`.

- [ ] **Step 1: Write the failing unit test (closed drawer is inert)**

```ts
// apps/web/src/lib/layout/AppShell.test.ts
// Authored for fartola. Not ported from upstream.
//
// In drawer mode (≤1024 px) the closed drawer is inert, so Tab cannot
// land in an off-screen sidebar; opening it lifts inert.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import AppShell from './AppShell.svelte';

function mockMatchMedia(matches: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

let instance: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (instance) void unmount(instance);
  instance = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const slot = () => document.body.querySelector('.sidebar-slot')!;

describe('AppShell drawer', () => {
  it('closed drawer is inert at tablet width, open drawer is not', () => {
    mockMatchMedia(true);
    instance = mount(AppShell, { target: document.body, props: {} });
    flushSync();
    // Svelte sets the inert property; jsdom does not reflect it to an attribute.
    expect((slot() as HTMLElement).inert).toBe(true);
    document.body.querySelector<HTMLButtonElement>('[data-testid="topbar-menu"]')!.click();
    flushSync();
    expect((slot() as HTMLElement).inert).toBe(false);
  });

  it('sidebar is never inert on a wide screen', () => {
    mockMatchMedia(false);
    instance = mount(AppShell, { target: document.body, props: {} });
    flushSync();
    expect((slot() as HTMLElement).inert).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @fartola/web exec vitest run src/lib/layout/AppShell.test.ts`
Expected: FAIL — `inert` missing in the first test.

- [ ] **Step 3: Implement**

`layout/breakpoints.ts`:

```ts
// Authored for fartola. Not ported from upstream.
//
// Drawer breakpoint shared by AppShell (JS + CSS) and TopBar (CSS). CSS
// media queries cannot read custom properties: keep the literal 1024px in
// AppShell.svelte and TopBar.svelte in step with this constant.
export const DRAWER_MAX_PX = 1024;
export const DRAWER_QUERY = `(max-width: ${DRAWER_MAX_PX}px)`;
```

`AppShell.svelte` script, after `let drawerOpen = $state(false);`:

```ts
import { DRAWER_QUERY } from './breakpoints.ts';
/** True in drawer mode; the closed drawer is then inert (no Tab stops
 * in an off-screen sidebar, WCAG 2.4.3). */
let narrow = $state(false);
$effect(() => {
  const mq = window.matchMedia(DRAWER_QUERY);
  narrow = mq.matches;
  const onChange = (e: MediaQueryListEvent) => (narrow = e.matches);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
});
```

(move the `import` up with the other imports). Markup:
`<div class="sidebar-slot">` → `<div class="sidebar-slot" inert={narrow && !drawerOpen ? true : undefined}>`.
CSS: `@media (max-width: 720px)` → `@media (max-width: 1024px)` with a
comment `/* = DRAWER_MAX_PX in breakpoints.ts */`.

`TopBar.svelte`: `@media (max-width: 720px)` → `@media (max-width: 1024px)`
with the same comment.

`Sidebar.svelte` `.sidebar` add:

```css
height: 100%;
min-height: 0;
overflow-y: auto;
```

`ReadoutView.svelte`: wrap the root `<div class="readout" …>…</div>` in
`<div class="readout-wrap">…</div>` and replace the two `.readout` rules
and the `@media (max-width: 1280px)` block with:

```css
.readout-wrap {
  container: readout / inline-size;
  height: 100%;
}
.readout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 18px;
  height: 100%;
  position: relative;
}
@container readout (max-width: 1280px) {
  .readout {
    grid-template-columns: minmax(0, 1fr) 340px;
  }
}
/* History rail below the card whenever the readout column would be
     narrower than ~600px (340 rail + 18 gap + 600). */
@container readout (max-width: 958px) {
  .readout {
    grid-template-columns: minmax(0, 1fr);
    height: auto;
  }
}
```

- [ ] **Step 4: Run the unit test**

Run: `pnpm --filter @fartola/web exec vitest run src/lib/layout/AppShell.test.ts`
Expected: PASS.

- [ ] **Step 5: Write and run the layout e2e test**

```ts
// tests/e2e/layout.spec.ts
// Authored for fartola. Not ported from upstream.
//
// X1/X2 (UI audit 2026-10-09): drawer at ≤1024 px, sidebar reachable at
// 1366×768, readout card not squeezed by the history rail.

import { test, expect } from '@playwright/test';
import { seedCompetition, simulateRead } from './helpers/seed.ts';

test.describe.configure({ mode: 'serial' });

test('hamburger only at ≤1024 px', async ({ page }) => {
  // 683 px = 1366 px at 200 % zoom
  for (const [width, shown] of [
    [1366, false],
    [1280, false],
    [1025, false],
    [1024, true],
    [820, true],
    [683, true],
  ] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await expect(page.getByTestId('topbar-menu')).toBeVisible({ visible: shown });
  }
});

test('closed drawer takes no Tab stops at 820 px', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto('/');
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    const inSidebar = await page.evaluate(() => !!document.activeElement?.closest('.sidebar-slot'));
    expect(inSidebar).toBe(false);
  }
});

test('settings reachable in the sidebar at 1366×768', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  const settings = page.locator('.sidebar').getByText('Inställningar', { exact: true });
  await settings.scrollIntoViewIfNeeded();
  await expect(settings).toBeInViewport();
});

for (const width of [1366, 1280, 1180, 1025, 1024, 820, 683]) {
  test(`readout column ≥ 560 px at ${width}`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const { competitionId } = await seedCompetition(request, { controls: 12 });
    await page.goto(`/competition/${competitionId}/readout`);
    await simulateRead(
      request,
      competitionId,
      7_501_853,
      [31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42]
    );
    const box = await page.getByTestId('latest-read').boundingBox();
    // 683 px leaves 651 px after the 16 px page padding; still ≥ 560.
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(560);
  });
}
```

Run: `pnpm e2e layout`
Expected: PASS. If "Inställningar" is not matched, use the nav item's
`data-testid` from `layout/NavItem.svelte`/`Sidebar.svelte` instead.

- [ ] **Step 6: Gate, e2e, commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`

```bash
git add apps/web/src/lib/layout/breakpoints.ts apps/web/src/lib/layout/AppShell.svelte apps/web/src/lib/layout/AppShell.test.ts \
  apps/web/src/lib/layout/TopBar.svelte apps/web/src/lib/layout/Sidebar.svelte apps/web/src/lib/screens/ReadoutView.svelte \
  tests/e2e/layout.spec.ts
git commit -m "fix(web): use the drawer up to 1024 px and stack the readout by width"
```

---

### Task 9: Readout actions always in view

Run after Tasks 6, 7 and 8 (it edits `LatestReadCard.svelte` after Task 6
and relies on Task 8's layout at tablet width).

**Files:**

- Modify: `apps/web/src/lib/components/LatestReadCard.svelte` (`.card`, `.body`, `.dnf-pop` styles)
- Create: `tests/e2e/readout-long-course.spec.ts`

**Interfaces:**

- Consumes: `seedCompetition`, `simulateRead`, `longCourseCodes` (Task 1);
  `data-size` on the punch grid (Task 7).

- [ ] **Step 1: Write the failing e2e test**

```ts
// tests/e2e/readout-long-course.spec.ts
// Authored for fartola. Not ported from upstream.
//
// ADR-0016 rule 4: the readout's main button never scrolls away. With a
// 35-control course the punch area scrolls inside the card; the page
// itself does not scroll, and "Skriv ut kvitto" and the manual-status
// picker stay fully visible. At 200 % zoom (683×384) the page may scroll,
// but every action is reachable and nothing is clipped.

import { test, expect, type Page } from '@playwright/test';
import { longCourseCodes } from './helpers/long-course.ts';
import { seedCompetition, simulateRead } from './helpers/seed.ts';

test.describe.configure({ mode: 'serial' });

async function openLongRead(
  page: Page,
  request: Parameters<typeof seedCompetition>[0]
): Promise<void> {
  const { competitionId } = await seedCompetition(request, { controls: 35 });
  await page.goto(`/competition/${competitionId}/readout`);
  await expect(page.getByTestId('readout-view')).toBeVisible();
  await simulateRead(request, competitionId, 7_501_853, longCourseCodes(35));
  await expect(page.getByTestId('punch-grid')).toHaveAttribute('data-size', 'medium', {
    timeout: 5_000,
  });
}

const pageScroll = (page: Page) =>
  page.evaluate(() => (document.querySelector('.content')?.scrollTop ?? 0) + window.scrollY);

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 820, height: 1180 },
]) {
  test(`35 controls at ${viewport.width}×${viewport.height}: actions in view`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize(viewport);
    await openLongRead(page, request);

    const body = page.locator('[data-testid="latest-read"] .body');
    expect(await body.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    await expect(page.getByTestId('print-btn')).toBeInViewport({ ratio: 1 });

    await body.evaluate((e) => (e.scrollTop = e.scrollHeight));
    const last = page.locator('[data-testid="punch-grid"] .punch').last();
    await expect(last).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('print-btn')).toBeInViewport({ ratio: 1 });
    expect(await pageScroll(page)).toBe(0);

    await page.getByTestId('manual-dnf-btn').click();
    await expect(page.getByTestId('dnf-reason-input')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('dnf-confirm')).toBeInViewport({ ratio: 1 });
  });
}

test('35 controls at 200 % zoom (683×384): every action reachable', async ({ page, request }) => {
  await page.setViewportSize({ width: 683, height: 384 });
  await openLongRead(page, request);
  for (const id of ['print-btn', 'manual-dnf-btn']) {
    await page.getByTestId(id).scrollIntoViewIfNeeded();
    await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
  }
  await page.getByTestId('manual-dnf-btn').click();
  for (const id of ['dnf-reason-input', 'dnf-confirm']) {
    await page.getByTestId(id).scrollIntoViewIfNeeded();
    await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm e2e readout-long-course`
Expected: FAIL — the body does not overflow (the card grows instead) and
`print-btn` is below the fold at 1366×768; at 683×384 the picker (which
opens downwards inside a card with `overflow: hidden`) is clipped.

- [ ] **Step 3: Implement** (`LatestReadCard.svelte` styles)

`.card` (this file's own rule, ~line 396): `overflow: hidden;` →
`overflow: visible;` so the picker can extend past the card. Nothing
inside the card paints a background into its rounded corners, so the
clip is not needed; check the flash (`.latest[data-flash]`) still shows
rounded corners in a screenshot.

```css
.body {
  padding: 16px 18px;
  /* The punch area scrolls inside the card so the action bar (.foot)
     stays in view on long courses (ADR-0016 rule 4). 240px = top bar +
     page padding + card header + action bar; 120px floor for 200 % zoom. */
  max-height: max(120px, calc(100dvh - 240px));
  overflow-y: auto;
}
```

`.dnf-pop`: `top: calc(100% + 8px);` → `bottom: calc(100% + 8px);`
(opens upwards, over the punch area) and `z-index: 10` → `z-index: 20`.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm e2e readout-long-course readout`
Expected: PASS (3 new + existing readout tests).

- [ ] **Step 5: Gate, commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`

```bash
git add apps/web/src/lib/components/LatestReadCard.svelte tests/e2e/readout-long-course.spec.ts
git commit -m "fix(readout): keep print and status actions in view on long courses"
```

---

### Task 10: Plain Swedish in `sv.json`

**Files:**

- Modify: `apps/web/src/lib/i18n/sv.json`, `en.json` (new key only)
- Modify: `apps/web/src/lib/components/LatestReadCard.svelte` (`t('walk.save')` → `t('ro.status.save')`)
- Modify: `apps/web/src/lib/components/LatestReadCard.test.ts` (new test)
- Modify: `tests/e2e/walkup-eventor.spec.ts:132` (`'Bana'` → `'Klass'`)

**Interfaces:**

- Produces: i18n key `ro.status.save` ("Spara" / "Save").

- [ ] **Step 1: Write the failing test** (append to `LatestReadCard.test.ts`)

```ts
describe('LatestReadCard manual-status picker', () => {
  it('saves with "Spara", not the walk-up form\'s label', () => {
    const el = html(read());
    el.querySelector<HTMLButtonElement>('[data-testid="manual-dnf-btn"]')!.click();
    flushSync();
    expect(el.querySelector('[data-testid="dnf-confirm"]')?.textContent?.trim()).toBe('Spara');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @fartola/web exec vitest run src/lib/components/LatestReadCard.test.ts`
Expected: FAIL — received "Spara och bind".

- [ ] **Step 3: Inventory every changed key's consumers**

Run, for each key in the table below:
`grep -rn "'<key>'\|\"<key>\"" apps/web/src --include=*.svelte --include=*.ts`
If a key has a consumer where the new text would be wrong, add a new key
for that consumer (as `ro.status.save` below) instead of sharing.

- [ ] **Step 4: Change the texts**

`LatestReadCard.svelte`: `{t('walk.save')}` → `{t('ro.status.save')}`.
Add `"ro.status.save": "Spara",` (sv) and `"ro.status.save": "Save",` (en).

`sv.json` (exact new values; keys unchanged):

| Key                                | New text                                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `walk.title`                       | `Direktanmälan`                                                                                                         |
| `walk.desc`                        | `Okänd bricka. Anmäl löparen och fortsätt.`                                                                             |
| `walk.bana`                        | `Klass`                                                                                                                 |
| `walk.banaPlaceholder`             | `Välj klass`                                                                                                            |
| `walk.save`                        | `Spara anmälan`                                                                                                         |
| `ro.register`                      | `Direktanmäl`                                                                                                           |
| `ro.feed.live`                     | `direkt`                                                                                                                |
| `runners.addSheet.namePlaceholder` | `För- och efternamn`                                                                                                    |
| `race.reset.body`                  | `Resultat tas bort från alla avläsningar och löparna väntar på avläsning igen. Manuella statusar behålls.`              |
| `importRunners.errNoKey`           | `Eventor-nyckel saknas. Lägg in den under Inställningar.`                                                               |
| `tweaks.eventor.no_key`            | `Eventor: nyckel saknas`                                                                                                |
| `tw.title`                         | `Utseende`                                                                                                              |
| `settings.meos.desc`               | `Lösenord för MeOS-kopplingen. Ange samma lösenord i MeOS. Utan lösenord fungerar kopplingen bara från den här datorn.` |
| `eventor.publish.results.desc`     | `Skickar resultatlistan till Eventor.`                                                                                  |
| `settings.helperCodes.description` | `Koder för sekretariatshjälpare att direktanmäla löpare från telefon.`                                                  |
| `edit.withdraw.confirmBody`        | `Bekräfta att löparen lämnar återbud.`                                                                                  |
| `edit.withdraw.confirm`            | `Ja, återbud`                                                                                                           |
| `registration.cancelToast`         | `{{name}} har lämnat återbud`                                                                                           |

Hard-coded strings in `.svelte` files ("XSD-fel", "80mm thermal ·
ESC/POS", device paths, "v0.1.0-phase1 · localhost") are plan 2 (screen
passes), not this task.

`tests/e2e/walkup-eventor.spec.ts:132`: `toHaveText('Bana')` →
`toHaveText('Klass')`, and its comment on line 131 to match.

- [ ] **Step 5: Run tests and grep for e2e text dependencies**

Run:

```bash
pnpm --filter @fartola/web test
grep -rn "Walk-up registrering\|Spara och bind\|Registrera deltagare\|Efternamn, Förnamn\|avregistrera\|Tweaks" tests apps/web/src --include=*.ts
```

Expected: tests pass; grep prints nothing (fix any hit in this commit).

- [ ] **Step 6: Gate, e2e, commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`

```bash
git add apps/web/src/lib/i18n/sv.json apps/web/src/lib/i18n/en.json apps/web/src/lib/components/LatestReadCard.svelte \
  apps/web/src/lib/components/LatestReadCard.test.ts tests/e2e/walkup-eventor.spec.ts
git commit -m "fix(i18n): use plain swedish and one word per concept in the ui"
```

---

### Task 11: Axe in e2e

**Files:**

- Modify: `package.json` (root devDependency)
- Create: `tests/e2e/a11y.spec.ts`
- Create: `tests/e2e/a11y-known.json`
- Create: `.planning/todos/pending/2026-10-09-axe-known-violations.md`

**Interfaces:**

- Consumes: `seedCompetition`, `simulateRead` (Task 1).
- axe's `target-size` rule checks WCAG 2.2's 24 px minimum; the 44 px
  rule is held by `tests/e2e/targets.spec.ts` (Task 6).
- Run the e2e suite with `--workers=1` when this spec flakes: specs share
  one database and the active-competition pointer.

- [ ] **Step 1: Add the dependency**

Run: `pnpm add -D -w @axe-core/playwright`

- [ ] **Step 2: Write the test**

```ts
// tests/e2e/a11y.spec.ts
// Authored for fartola. Not ported from upstream.
//
// ADR-0016 confirmation: an automated accessibility check. Colour
// contrast and target size must be clean on the five main screens in
// both modes; violations already known (a11y-known.json, rule + target)
// are allowed until plan 2 fixes them, and the list may only shrink.

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { seedCompetition, simulateRead } from './helpers/seed.ts';

test.describe.configure({ mode: 'serial' });

test('no new contrast or target-size violations', async ({ page, request }) => {
  test.setTimeout(120_000);
  const { competitionId: id } = await seedCompetition(request, { controls: 12 });
  await simulateRead(request, id, 7_501_853, [31, 32, 33, 35, 34, 36, 37, 38, 39, 40, 41, 42]);
  const screens = [
    `/competition/${id}/readout`,
    `/competition/${id}/readout?walkup=7500123`,
    `/competition/${id}/results`,
    `/competition/${id}/lottning`,
    `/competition/${id}/info`,
  ];
  const known = JSON.parse(
    readFileSync(new URL('./a11y-known.json', import.meta.url), 'utf8')
  ) as Array<{ rule: string; target: string }>;
  const allowed = new Set(known.map((k) => `${k.rule} ${k.target}`));
  const found: string[] = [];
  for (const high of [false, true]) {
    for (const url of screens) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      if (high) await page.evaluate(() => document.documentElement.classList.add('contrast-high'));
      const result = await new AxeBuilder({ page })
        .withRules(['color-contrast', 'target-size'])
        .analyze();
      for (const v of result.violations) {
        for (const n of v.nodes) {
          const key = `${v.id} ${n.target.join(' ')}`;
          if (!allowed.has(key)) found.push(`${high ? 'sun' : 'default'} ${url}: ${key}`);
        }
      }
    }
  }
  expect(found, found.join('\n')).toEqual([]);
});
```

`tests/e2e/a11y-known.json`: `[]`

- [ ] **Step 3: Run it, and record what is left**

Run: `pnpm e2e a11y`
If it fails, each line is `mode url: rule target`. For each: if it is on
a surface plan 1 changed (tokens, pills, buttons, punch tiles, frame,
readout card), fix it now. Otherwise add
`{ "rule": "<rule>", "target": "<target>" }` to `a11y-known.json` and a
line to the todo below. Rerun until green.

- [ ] **Step 4: Write the todo for the rest** (and for what axe cannot see)

```markdown
---
created: 2026-10-09T00:00:00+02:00
title: Axe violations left after design-lab plan 1, and modal focus
area: web
files:
  - tests/e2e/a11y-known.json
  - apps/web/src/lib/ui/Modal.svelte
---

## Problem

`tests/e2e/a11y.spec.ts` allows the violations in `a11y-known.json`
(each listed below with screen and selector). Modals never take focus,
trap it or restore it, and have no `aria-labelledby` (audit X5); axe's
colour/target rules do not cover that.

## What

- Empty `a11y-known.json` during plan 2's screen passes.
- X5: focus first field, trap, restore, `aria-labelledby`, one
  `requestClose()` with a dirty check (WalkupModal, wizard onto Modal).
- Then widen the axe run from two rules to the full WCAG 2.2 AA set.

## Known violations

(Write one line per entry in a11y-known.json here: rule, screen URL, selector.)
```

- [ ] **Step 5: Gate, commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`

```bash
git add package.json pnpm-lock.yaml tests/e2e/a11y.spec.ts tests/e2e/a11y-known.json \
  .planning/todos/pending/2026-10-09-axe-known-violations.md
git commit -m "test(e2e): check contrast and target size with axe"
```

---

### Task 12: "After" shots, README, hand-off to plan 2

**Files:**

- Create: `docs/design-lab/README.md`

- [ ] **Step 1: Take the "after" shots**

```bash
mkdir -p ~/src/fartOLa-workdirs/fartOLa-docs/design-lab-2026-10/after-plan-1
DESIGN_LAB_SHOTS=$HOME/src/fartOLa-workdirs/fartOLa-docs/design-lab-2026-10/after-plan-1 pnpm e2e design-lab-screens --workers=1
```

Expected: 68 PNGs. Compare `readout-*` and `walkup-*` before/after by
eye: green only on OK, correct tiles and the main button; tiles say
saknas/fel ordn./extra/struken; tablet shows the hamburger and the
history below the card.

- [ ] **Step 2: Write `docs/design-lab/README.md`**

Sections, each change tied to a user need or an ADR-0016 rule:
"What changed" (one bullet per Task 3–11, with the rule), "Contrast"
(copy the pairs from `tokens.contrast.test.ts` with the ratios printed
by `PRINT_CONTRAST=1 pnpm --filter @fartola/web exec vitest run src/lib/tokens.contrast.test.ts`, one table row per pair and mode),
"Screenshots" (path in fartOLa-docs, including the four `readout-laptop-{deut,prot,trit,grey}.png`), "Left for plan 2" (link
`audit.md` and the axe todo). Prettier it.

- [ ] **Step 3: Final gate and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`

```bash
git add docs/design-lab/README.md
git commit -m "docs(design-lab): describe plan 1 changes and contrast"
```

- [ ] **Step 4: Hand-off**

Tell Jonas: plan 1 is done on `design/lab` (not pushed); plan 2 (screen
passes) is to be written from `docs/design-lab/audit.md`.
