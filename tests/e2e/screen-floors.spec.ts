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

type Screen = {
  name: string;
  url: (id: string) => string;
  ready: (p: Page) => Locator;
  /** Measure only inside this selector (a dialog over another track's screen). */
  root?: string;
};
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
      expect(await smallText(page, { root: s.root })).toEqual([]);
      expect(await smallTargets(page, { root: s.root, labels: true })).toEqual([]);
    });
  }
}
