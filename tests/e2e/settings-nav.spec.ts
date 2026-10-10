// tests/e2e/settings-nav.spec.ts
// Authored for fartola. Not ported from upstream.
//
// PR 6 (design lab): the settings page is a normal menu item, deep
// links land on the right section, and a missing Eventor key is one
// click from the place that fixes it (ADR-0016 rule 4).

import { test, expect } from '@playwright/test';
import { seedCompetition } from './helpers/seed.ts';

test('Inställningar in the sidebar opens the settings page, marked active', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/');
  const nav = page.locator('.sidebar').getByRole('button', { name: 'Inställningar' });
  await nav.click();
  await expect(page).toHaveURL(/\/installningar$/);
  await expect(page.getByTestId('settings-view')).toBeVisible();
  await expect(nav).toHaveAttribute('aria-current', 'page');
  await expect(
    page.locator('.sidebar').getByRole('button', { name: 'Tävlingar' })
  ).not.toHaveAttribute('aria-current', 'page');
});

test('/access does not mark Tävlingar active', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/access');
  await expect(
    page.locator('.sidebar').getByRole('button', { name: 'Tävlingar' })
  ).not.toHaveAttribute('aria-current', 'page');
});

test('/installningar#eventor scrolls to and focuses the Eventor heading', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 600 });
  await page.goto('/installningar#eventor');
  const heading = page.locator('#eventor h2');
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
});

test('settings sections come in the agreed order', async ({ page }) => {
  await page.goto('/installningar');
  await expect(page.getByTestId('settings-view')).toBeVisible();
  const ids = await page
    .locator('[data-testid="settings-view"] > section[id]')
    .evaluateAll((els) => els.map((e) => e.id));
  expect(ids).toEqual(['eventor', 'liveresultat', 'meos', 'radio', 'hjalpkoder', 'utseende']);
});

test('Utseende toggles bright-sun and it survives a reload', async ({ page }) => {
  await page.goto('/installningar');
  const toggle = page.locator('#utseende').getByRole('checkbox');
  await toggle.check();
  await expect(page.locator('html')).toHaveClass(/contrast-high/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/contrast-high/);
  await page.locator('#utseende').getByRole('checkbox').uncheck();
  await expect(page.locator('html')).not.toHaveClass(/contrast-high/);
});

const KEY_LINK = '/installningar#eventor';

test('wizard: missing Eventor key links to the key field', async ({ page }) => {
  await page.route('**/api/eventor/events/**', (r) =>
    r.fulfill({ status: 400, json: { error: 'no_key' } })
  );
  await page.goto('/');
  await page.getByTestId('open-wizard').first().click();
  await page.getByTestId('wiz-evqs-input').fill('12345');
  await page.getByTestId('wiz-evqs-fetch').click();
  const err = page.getByTestId('wiz-evqs-error');
  await expect(err).toBeVisible();
  await expect(err.getByRole('link', { name: 'Lägg in Eventor-nyckeln' })).toHaveAttribute(
    'href',
    KEY_LINK
  );
});

test('import: missing Eventor key links to the key field', async ({ page, request }) => {
  const { competitionId: id } = await seedCompetition(request, { controls: 3 });
  await page.route('**/api/eventor/events?**', (r) =>
    r.fulfill({ status: 503, json: { error: 'no_key' } })
  );
  await page.goto(`/competition/${id}/import`);
  await page.getByTestId('import-search').click();
  const err = page.getByTestId('import-search-error');
  await expect(err).toBeVisible();
  await expect(err.getByRole('link', { name: 'Lägg in Eventor-nyckeln' })).toHaveAttribute(
    'href',
    KEY_LINK
  );
});

test('publish: missing Eventor key links to the key field', async ({ page, request }) => {
  const { competitionId: id } = await seedCompetition(request, { controls: 3 });
  await page.route('**/eventor/push-results', (r) =>
    r.fulfill({ status: 400, json: { error: 'no_key' } })
  );
  await page.goto(`/competition/${id}/eventor-publish`);
  await page.getByTestId('eventor-publish-results').getByRole('button').first().click();
  const err = page.getByTestId('eventor-results-err');
  await expect(err).toBeVisible();
  await expect(err.getByRole('link', { name: 'Lägg in Eventor-nyckeln' })).toHaveAttribute(
    'href',
    KEY_LINK
  );
});
