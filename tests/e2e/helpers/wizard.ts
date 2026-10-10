// tests/e2e/helpers/wizard.ts
// Authored for fartola. Not ported from upstream.
//
// Prepared states for the new-competition wizard: step 1 with its hints,
// step 2 with a chosen course file, and the import error banner.
import { expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(dir, '../../../apps/edge/test/fixtures');
export const COURSE_FIXTURE = path.join(fixtures, 'iof30-coursedata-sample.xml');
export const ENTRYLIST_FIXTURE = path.join(fixtures, 'iof30-entrylist-sample.xml');

/** Open the wizard from Home and clear any draft left by an earlier test. */
export async function openWizard(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => sessionStorage.removeItem('fartola-wizard-draft'));
  await page.getByTestId('open-wizard').first().click();
  await expect(page.getByTestId('wiz-name')).toBeVisible();
}

/** A bad date, the Nästa hint, and the Eventor lookup error. */
export async function prepareWizardStep1(page: Page): Promise<void> {
  await page.route('**/api/eventor/events/**', (r) =>
    r.fulfill({ status: 404, json: { error: 'not_found' } })
  );
  await page.getByTestId('wiz-name').fill('Designlabb');
  await page.getByTestId('wiz-date').fill('2026-13-99x');
  await page.getByTestId('wiz-evqs-input').fill('12345');
  await page.getByTestId('wiz-evqs-fetch').click();
  await expect(page.getByTestId('wiz-evqs-error')).toBeVisible();
  await expect(page.getByTestId('wiz-date-error')).toBeVisible();
  await expect(page.getByTestId('wiz-next')).toBeDisabled();
  await expect(page.locator('.btn-hint')).toBeVisible();
}

async function toStep2(page: Page, file: string): Promise<void> {
  await page.getByTestId('wiz-name').fill('Designlabb');
  await page.getByTestId('wiz-date').fill('2026-05-19');
  await page.getByTestId('wiz-next').click();
  await page.getByTestId('drop-zone-input').setInputFiles(file);
  await expect(page.getByTestId('wiz-preview')).toBeVisible();
}

/** Step 2 with a chosen course file and its preview. */
export async function prepareWizardStep2(page: Page): Promise<void> {
  await toStep2(page, COURSE_FIXTURE);
}

/** Step 2 after Skapa tävling was refused: the error banner shows. */
export async function prepareWizardImportError(page: Page): Promise<void> {
  await toStep2(page, ENTRYLIST_FIXTURE);
  await page.getByTestId('wiz-start').click();
  await expect(page.getByTestId('wizard-error')).toBeVisible();
}
