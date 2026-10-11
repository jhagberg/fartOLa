// tests/e2e/runners.spec.ts
// Authored for fartola. Not ported from upstream.
//
// Anmälda: an edit gives a result (toast, scroll, highlight; Återbud mutes
// the row), errors sit under their field, search and class are in the URL.
// Synthetic data only (seed.ts plus a hire-card runner).

import { test, expect } from '@playwright/test';
import { openRunners, seedRunners } from './helpers/runners.ts';

test('saving an edit closes the dialog, shows a toast and highlights the row', async ({
  page,
  request,
}) => {
  const { id } = await seedRunners(request);
  await openRunners(page, id);
  await page.getByTestId('runners-row').filter({ hasText: 'Cia' }).click();
  await page.getByTestId('edit-club').fill('Ny Klubb OK');
  await page.getByTestId('edit-save-btn').click();
  await expect(page.getByTestId('edit-name')).toHaveCount(0);
  await expect(page.getByTestId('runners-toast')).toHaveText('Cia Carlsson sparad');
  const row = page.getByTestId('runners-row').filter({ hasText: 'Cia' });
  await expect(row).toHaveAttribute('data-highlight', 'true');
  await expect(row).toBeInViewport();
  await expect(row).toContainText('Ny Klubb OK');
  await expect(row).not.toHaveAttribute('data-highlight', 'true', { timeout: 5_000 });
  await expect(page.getByTestId('runners-toast')).toHaveCount(0, { timeout: 5_000 });
});

test('a withdrawal mutes the row and shows Återbud on it', async ({ page, request }) => {
  const { id } = await seedRunners(request);
  await openRunners(page, id);
  const row = page.getByTestId('runners-row').filter({ hasText: 'Anna' });
  await expect(row).not.toHaveAttribute('data-withdrawn', 'true');
  await row.click();
  await page.getByTestId('edit-withdraw-btn').click();
  await page.getByTestId('edit-withdraw-confirm').click();
  await expect(page.getByTestId('edit-name')).toHaveCount(0);
  await expect(row).toHaveAttribute('data-withdrawn', 'true');
  await expect(row).toContainText('Återbud');
  await expect(page.getByTestId('runners-toast')).toHaveText('Anna Andersson har lämnat återbud');
});

test('a missing name is reported under the name field, not at the bottom', async ({
  page,
  request,
}) => {
  const { id } = await seedRunners(request);
  await openRunners(page, id);
  await page.getByTestId('runners-row').filter({ hasText: 'Anna' }).click();
  await page.getByTestId('edit-name').fill('');
  await page.getByTestId('edit-save-btn').click();
  const err = page.getByTestId('edit-name-error');
  await expect(err).toHaveText('Fyll i namn');
  await expect(err).toHaveAttribute('role', 'alert');
  const name = page.getByTestId('edit-name');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  const describedBy = await name.getAttribute('aria-describedby');
  expect(describedBy).toBe(await err.getAttribute('id'));
  await expect(page.getByTestId('edit-error')).toHaveCount(0);
  await name.fill('Anna A');
  await expect(err).toHaveCount(0);
  await expect(name).not.toHaveAttribute('aria-invalid', 'true');
});

test('search and class are in the URL, the count reads N av M, no empty quotes', async ({
  page,
  request,
}) => {
  const { id, d21 } = await seedRunners(request);
  await openRunners(page, id);
  const count = page.getByTestId('runners-count');
  await expect(count).toHaveText('4 st');
  await page.getByTestId('runners-search').fill('cia');
  await expect(page).toHaveURL(/q=cia/);
  await expect(count).toHaveText('1 av 4');
  await page.reload();
  await expect(page.getByTestId('runners-search')).toHaveValue('cia');
  await expect(page.getByTestId('runners-row')).toHaveCount(1);
  await page.getByTestId('runners-search-clear').click();
  await expect(page).not.toHaveURL(/q=/);
  await expect(count).toHaveText('4 st');

  await page.getByTestId('runners-class-chip').filter({ hasText: 'D21' }).click();
  await expect(page).toHaveURL(new RegExp(`klass=${d21}`));
  await page.reload();
  await expect(page.getByTestId('runners-class-chip').filter({ hasText: 'D21' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(count).toContainText(/ av 4$/);

  // A filter with no query and no hits: no quotes in the title.
  await page.getByTestId('runners-status-mp').click();
  await expect(page.getByTestId('runners-noresults')).toBeVisible();
  await expect(page.getByTestId('runners-noresults').locator('h2')).toHaveText('Inga träffar');
  await page.getByTestId('runners-search').fill('zzz');
  await expect(page.getByTestId('runners-noresults').locator('h2')).toHaveText(
    'Inga träffar för "zzz"'
  );
});
