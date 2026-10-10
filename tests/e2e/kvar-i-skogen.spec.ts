// tests/e2e/kvar-i-skogen.spec.ts
// Authored for fartola. Not ported from upstream.
//
// Safety: the screen must only say everyone is back when every started card
// was physically read at the finish. A manual mark is not a return.
import { test, expect } from '@playwright/test';
import { seedCompetition } from './helpers/seed.ts';
import { ANNA, CIA, fetchSnapshot, snap } from './helpers/kvar.ts';

test.describe.configure({ mode: 'serial' });

let id = '';
test.beforeAll(async ({ request }) => {
  id = (await seedCompetition(request, { controls: 8 })).competitionId;
});

test.beforeEach(async ({ page }) => {
  await page.goto(`/competition/${id}/kvar-i-skogen`);
  await expect(page.getByTestId('kvariskov-view')).toBeVisible();
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.getByTestId('kvariskov-view')).toBeVisible();
});

const view = (p: import('@playwright/test').Page) => p.getByTestId('kvariskov-view');

test('empty check unit is not "all back"', async ({ page }) => {
  await fetchSnapshot(page, snap([]));
  await expect(view(page)).toContainText('Inga stämplingar lästes från dosan.');
  await expect(view(page)).not.toContainText('Alla löpare har återkommit');
});

test('all back', async ({ page }) => {
  await fetchSnapshot(page, snap([ANNA], [ANNA]));
  await expect(view(page)).toContainText('Alla löpare har återkommit.');
});

test('marked safe stays visible', async ({ page }) => {
  await fetchSnapshot(page, snap([ANNA, CIA]));
  await expect(page.getByTestId('kvariskov-row')).toHaveCount(2);
  await page
    .getByTestId('kvariskov-row')
    .filter({ hasText: 'Anna Andersson' })
    .getByTestId('kvariskov-mark-safe')
    .click();
  const marked = page.getByTestId('kvariskov-marked');
  await expect(marked).toContainText('Markerade som säkra (1)');
  await expect(marked).toContainText('Anna Andersson');
  await expect(marked).toContainText('Markerad på den här datorn');
  await expect(page.getByTestId('kvariskov-row')).toHaveCount(1);
  await expect(page.getByTestId('kvariskov-summary')).toContainText(
    '1 löpare saknas, 0 är tillbaka.'
  );
});

test('marked is not returned', async ({ page }) => {
  await fetchSnapshot(page, snap([ANNA]));
  await page.getByTestId('kvariskov-mark-safe').click();
  await expect(view(page)).toContainText(
    'Ingen saknas: 0 har kommit tillbaka och 1 är markerade som säkra.'
  );
  await expect(view(page)).not.toContainText('Alla löpare har återkommit');
});

test('fetch time and fetch again', async ({ page }) => {
  await fetchSnapshot(page, snap([ANNA, CIA]));
  await expect(page.getByTestId('kvariskov-fetched-at')).toHaveText(/^Hämtad \d\d:\d\d$/);
  await expect(page.getByTestId('kvariskov-refetch')).toHaveText('Hämta igen');
});
