// tests/e2e/helpers/readout.ts
// Authored for fartola. Not ported from upstream.
//
// Prepared states for the Avläsning card: an older read pinned (cue bar), a
// failed print (message, details, retry) and the status popover with a
// failed save. Each asserts every element it adds is visible.
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { seedCompetition, simulateRead } from './seed.ts';

const CIA = 1_428_824;
const ANNA = 7_501_853;

/** A fresh competition with Cia read, then Anna; Cia (older) pinned. */
async function pinnedOlder(page: Page, request: APIRequestContext): Promise<void> {
  const { competitionId: id } = await seedCompetition(request, { controls: 4 });
  await simulateRead(request, id, CIA, [31, 32, 33, 34]);
  await simulateRead(request, id, ANNA, [31, 32, 33, 34]);
  await page.goto(`/competition/${id}/readout`);
  await expect(page.getByTestId('card-number').first()).toHaveText(String(ANNA));
  await page
    .getByTestId('history-row')
    .filter({ hasText: String(CIA) })
    .first()
    .click();
  await expect(page.getByTestId('card-number').first()).toHaveText(String(CIA));
}

/** Pinned older read, cue bar, simulate button and a failed print. */
export async function prepareReadoutPinnedPrintFailed(
  page: Page,
  request: APIRequestContext
): Promise<void> {
  await pinnedOlder(page, request);
  await page.route('**/api/competitions/*/print-receipt', (route) =>
    route.fulfill({ status: 503, json: { error: 'printer_offline' } })
  );
  await page.getByTestId('print-btn').click();
  await expect(page.getByText('Du tittar på en äldre avläsning.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Visa senaste' })).toBeVisible();
  await expect(page.getByTestId('simulate-btn')).toBeVisible();
  await expect(page.getByText('Utskriften misslyckades')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Försök igen' })).toBeVisible();
  await page.getByText('Visa orsak').click();
  await expect(page.getByText('printer_offline')).toBeVisible();
}

/** The status popover after a failed save, with its reason. */
export async function prepareReadoutStatusFailed(
  page: Page,
  request: APIRequestContext
): Promise<void> {
  await pinnedOlder(page, request);
  await page.route('**/competitors/*/status', (route) =>
    route.fulfill({ status: 500, json: { error: 'disk_full' } })
  );
  await page.getByTestId('manual-dnf-btn').click();
  await page.getByTestId('status-pick-DQ').click();
  await page.getByTestId('dnf-confirm').click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Statusen sparades inte.' })
  ).toBeVisible();
  await page.getByText('Visa orsak').click();
  await expect(page.getByText('disk_full')).toBeVisible();
}

/** No read yet: the disabled print button and its hint. */
export async function prepareReadoutEmpty(page: Page, request: APIRequestContext): Promise<void> {
  const { competitionId: id } = await seedCompetition(request, { controls: 4 });
  await page.goto(`/competition/${id}/readout`);
  await expect(page.getByTestId('readout-view')).toBeVisible();
  await expect(page.getByTestId('print-btn')).toBeDisabled();
  await expect(page.getByText('Ingen avläsning att skriva ut')).toBeVisible();
}

/** A read with a printed receipt, so the mirror head shows its "printed" state. */
export async function prepareReadoutPrinted(page: Page, request: APIRequestContext): Promise<void> {
  const { competitionId: id } = await seedCompetition(request, { controls: 4 });
  await simulateRead(request, id, ANNA, [31, 32, 33, 34]);
  await page.route('**/api/competitions/*/print-receipt', (route) =>
    route.fulfill({ status: 201, json: { queued: true, queue_position: 0 } })
  );
  await page.goto(`/competition/${id}/readout`);
  await expect(page.getByTestId('card-number').first()).toHaveText(String(ANNA));
  await page.getByTestId('print-btn').click();
  await expect(page.getByText('Kvittot skrivs ut')).toBeVisible();
  await expect(page.locator('.receipt-mirror .head h3')).toHaveText('Kvitto utskrivet');
  await expect(page.getByText('Auto', { exact: true })).toHaveCount(0);
}
