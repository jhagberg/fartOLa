// tests/e2e/helpers/access.ts
// Authored for fartola. Not ported from upstream.
//
// Prepared states for the helper login (/access). The shared e2e DB holds
// thousands of competitions, so the list is always mocked.
import { expect, type Page } from '@playwright/test';

export const ACCESS_COMPS = [
  { id: 'c-1', name: 'Designlabb natt-OL' },
  { id: 'c-2', name: 'Designlabb sprint' },
];

export async function mockCompetitions(page: Page, competitions: unknown[]): Promise<void> {
  await page.route('**/api/competitions', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { competitions } })
      : route.continue()
  );
}

/** The form before anything is chosen: code hint and the disabled-button hint. */
export async function prepareAccess(page: Page): Promise<void> {
  await mockCompetitions(page, ACCESS_COMPS);
  await page.reload();
  await expect(page.locator('#access-comp option')).toHaveCount(3);
  await expect(page.getByText('Koden får du av sekretariatet')).toBeVisible();
  await expect(page.getByText('Välj tävling och skriv koden')).toBeVisible();
}

/** A wrong code: the access POST answers 401 invalid_code. */
export async function prepareAccessWrongCode(page: Page): Promise<void> {
  await mockCompetitions(page, ACCESS_COMPS);
  await page.route('**/access', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 401, json: { error: 'invalid_code' } })
      : route.continue()
  );
  await page.reload();
  await page.locator('#access-comp').selectOption('c-1');
  await page.locator('#access-code').fill('fel-000');
  await page.getByTestId('access-submit').click();
  await expect(page.getByTestId('access-error')).toBeVisible();
  await expect(page.getByTestId('access-error')).toContainText('Ogiltig kod');
}

export async function prepareAccessLoadError(page: Page): Promise<void> {
  await page.route('**/api/competitions', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 503, json: { error: 'down' } })
      : route.continue()
  );
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Kunde inte hämta tävlingar.');
  await expect(page.getByRole('button', { name: 'Försök igen' })).toBeVisible();
}

export async function prepareAccessEmpty(page: Page): Promise<void> {
  await mockCompetitions(page, []);
  await page.reload();
  await expect(page.getByText('Inga tävlingar att logga in på.')).toBeVisible();
}
