// tests/e2e/helpers/results.ts
// Authored for fartola. Not ported from upstream.
//
// Floor/a11y states for the results screen. Mocks go in before the page
// loads (a reload that sees them).
import { expect, type Page } from '@playwright/test';

const RESULTS = '**/api/competitions/*/results';

/** The page with its tabs, table headers, counts, status pills and fullscreen button. */
export async function prepareResultsFull(page: Page): Promise<void> {
  await expect(page.getByTestId('class-tab').first()).toBeVisible();
  await expect(page.getByTestId('results-table').first()).toBeVisible();
  await expect(page.getByTestId('results-row').first()).toBeVisible();
  await expect(page.locator('.res-tab .count').first()).toBeVisible();
  await expect(page.locator('.res-table th').first()).toBeVisible();
  await expect(page.locator('.res-table .status').first()).toBeVisible();
  await expect(page.locator('.live')).toBeVisible();
  await expect(page.getByTestId('results-updated')).toBeVisible();
  await expect(page.locator('.finished')).toBeVisible();
  await expect(page.locator('.comp-meta')).toBeVisible();
  await expect(page.getByTestId('results-fullscreen-toggle')).toBeVisible();
}

/** Projector mode (F), where the status pill is enlarged. */
export async function prepareResultsFullscreen(page: Page): Promise<void> {
  // The key handler is attached on mount; the tabs show once the page loaded.
  await expect(page.getByTestId('class-tab').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('body').focus();
  await page.keyboard.press('f');
  await expect(page.getByTestId('results-view')).toHaveAttribute('data-fullscreen', 'true');
  await expect(page.locator('.res-table .status').first()).toBeVisible();
  await expect(page.getByTestId('results-fullscreen-toggle')).toBeVisible();
}

/** The failed load with its retry. */
export async function prepareResultsError(page: Page): Promise<void> {
  // No live socket: its first message would show the rows and clear the error.
  await page.routeWebSocket(/\/ws/, () => {});
  await page.route(RESULTS, (route) => route.fulfill({ status: 500, json: { error: 'boom' } }));
  await page.reload();
  const alert = page.getByRole('alert').filter({ hasText: 'Kunde inte hämta resultaten.' });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole('button', { name: 'Försök igen' })).toBeVisible();
}

/** A class without runners: the empty text. */
export async function prepareResultsEmpty(page: Page): Promise<void> {
  // No live socket: its first message would fill the class again.
  await page.routeWebSocket(/\/ws/, () => {});
  await page.route(RESULTS, (route) =>
    route.fulfill({ json: { competition_id: 'x', classes: [] } })
  );
  await page.reload();
  await expect(page.getByTestId('class-tab').first()).toBeVisible();
  await page.getByTestId('class-tab').first().click();
  await expect(page.getByText('Inga löpare i klassen ännu.')).toBeVisible();
}
