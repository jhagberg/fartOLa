// tests/e2e/helpers/export.ts
// Authored for fartola. Not ported from upstream.
//
// Puts /export into the states its changed parts show in: the valid
// summary, the Ej start section with a count and a result message, and
// the next step after a download. exportErrors then swaps the preview
// for a failing one to show the error boxes.
import { expect, type Page } from '@playwright/test';

export async function prepareExport(page: Page): Promise<void> {
  await expect(page.getByTestId('export-valid')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('export-pending')).toBeVisible();
  const set = page.getByTestId('export-unread-dns');
  await expect(set).toBeEnabled();
  await set.click();
  await expect(page.getByTestId('export-unread-message')).toContainText('satta till Ej start');
  // Leave the competition as it was found.
  await page.getByTestId('export-unread-dns-undo').click();
  await expect(page.getByTestId('export-unread-message')).toContainText('borttaget');
  await expect(page.getByTestId('export-pending')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByTestId('export-download').click();
  await download;
  await expect(page.getByTestId('export-next')).toBeVisible();
}

/** Mock a failing preview, flip the type to fetch it, and check the box. */
export async function prepareExportError(page: Page, kind: 'invalid' | 'network'): Promise<void> {
  const pattern = '**/export/preview*';
  await page.route(pattern, (route) =>
    kind === 'invalid'
      ? route.fulfill({
          json: { valid: false, errors: [{ line: 3, column: 1, message: 'Element saknas' }] },
        })
      : route.fulfill({ status: 500, json: { error: 'Serverfel' } })
  );
  await page.getByTestId('export-status-provisional').check();
  await expect(
    page.getByTestId(kind === 'invalid' ? 'export-invalid' : 'export-error-network')
  ).toBeVisible();
  if (kind === 'invalid') await page.getByText('Visa detaljer').click();
  await page.unroute(pattern);
}
