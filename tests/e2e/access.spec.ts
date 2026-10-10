// tests/e2e/access.spec.ts
// Authored for fartola. Not ported from upstream.
//
// Helper login: a failed list load is not a failed login, an empty list
// says so, the code field has a label and a hint, and the disabled button
// says why.
import { test, expect } from '@playwright/test';
import { ACCESS_COMPS, mockCompetitions } from './helpers/access.ts';

test('a failed load is not a failed login, and retry fills the select', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/competitions', (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    calls += 1;
    return calls === 1
      ? route.fulfill({ status: 503, json: { error: 'down' } })
      : route.fulfill({ json: { competitions: ACCESS_COMPS } });
  });
  await page.goto('/access');
  await expect(page.getByText('Kunde inte hämta tävlingar.')).toBeVisible();
  await expect(page.getByText('Inloggning misslyckades')).toHaveCount(0);
  await page.getByRole('button', { name: 'Försök igen' }).click();
  await expect(page.locator('#access-comp option')).toHaveCount(3);
  await expect(page.getByText('Kunde inte hämta tävlingar.')).toHaveCount(0);
});

test('an empty list says there is nothing to log in to', async ({ page }) => {
  await mockCompetitions(page, []);
  await page.goto('/access');
  await expect(page.getByText('Inga tävlingar att logga in på.')).toBeVisible();
});

test('the code field has a label, a placeholder and a linked hint', async ({ page }) => {
  await mockCompetitions(page, ACCESS_COMPS);
  await page.goto('/access');
  const code = page.getByLabel('Kod', { exact: true });
  await expect(code).toHaveAttribute('placeholder', 't.ex. sänkan-127');
  const hint = page.getByText('Koden får du av sekretariatet');
  await expect(hint).toBeVisible();
  const hintId = await hint.getAttribute('id');
  expect(hintId).toBeTruthy();
  expect(await code.getAttribute('aria-describedby')).toContain(hintId!);
});

test('the disabled button says why', async ({ page }) => {
  await mockCompetitions(page, ACCESS_COMPS);
  await page.goto('/access');
  await expect(page.getByText('Välj tävling och skriv koden')).toBeVisible();
});
