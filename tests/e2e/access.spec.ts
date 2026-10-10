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

test('the empty text waits for the list to load', async ({ page }) => {
  await page.route('**/api/competitions', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await new Promise((r) => setTimeout(r, 1000));
    return route.fulfill({ json: { competitions: [] } });
  });
  await page.goto('/access');
  await expect(page.getByTestId('access-view')).toBeVisible();
  await expect(page.getByText('Inga tävlingar att logga in på.')).toHaveCount(0);
  await expect(page.getByText('Inga tävlingar att logga in på.')).toBeVisible();
  await expect(page.getByText('Välj tävling och skriv koden')).toHaveCount(0);
});

test('a wrong code is not a failed load', async ({ page }) => {
  await mockCompetitions(page, ACCESS_COMPS);
  await page.route('**/access', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 401, json: { error: 'invalid_code' } })
      : route.continue()
  );
  await page.goto('/access');
  await page.locator('#access-comp').selectOption('c-1');
  await page.locator('#access-code').fill('fel-000');
  await page.getByTestId('access-submit').click();
  await expect(page.getByText('Ogiltig kod')).toBeVisible();
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
