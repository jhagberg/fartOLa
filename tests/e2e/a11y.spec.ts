// Authored for fartola. Not ported from upstream.
//
// ADR-0016 confirmation: an automated accessibility check. Colour
// contrast and target size must be clean on the five main screens in
// both modes; violations already known (a11y-known.json, rule + target)
// are allowed until plan 2 fixes them, and the list may only shrink.

import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { seedCompetition, simulateRead } from './helpers/seed.ts';

test.describe.configure({ mode: 'serial' });

test('no new contrast or target-size violations', async ({ page, request }) => {
  test.setTimeout(120_000);
  const { competitionId: id } = await seedCompetition(request, { controls: 12 });
  await simulateRead(request, id, 7_501_853, [31, 32, 33, 35, 34, 36, 37, 38, 39, 40, 41, 42]);
  // Each screen is scanned only once its own content is on the page.
  const screens: Array<[string, (page: Page) => Locator]> = [
    [
      `/competition/${id}/readout`,
      (p) => p.getByTestId('latest-read').filter({ hasText: '7501853' }),
    ],
    [`/competition/${id}/readout?walkup=7500123`, (p) => p.getByTestId('walkup-modal')],
    [`/competition/${id}/results`, (p) => p.getByTestId('results-view')],
    [`/competition/${id}/lottning`, (p) => p.getByTestId('lottning-view')],
    [`/competition/${id}/info`, (p) => p.getByTestId('competition-info')],
    ['/installningar', (p) => p.getByTestId('appearance-section')],
  ];
  const known = JSON.parse(
    readFileSync(new URL('./a11y-known.json', import.meta.url), 'utf8')
  ) as Array<{ rule: string; target: string }>;
  const allowed = new Set(known.map((k) => `${k.rule} ${k.target}`));
  const found: string[] = [];
  for (const high of [false, true]) {
    for (const [url, ready] of screens) {
      await page.goto(url);
      await expect(ready(page)).toBeVisible();
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
