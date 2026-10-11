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

/** Anna's rows carry an open hired card, so a read of her raises that toast. */
async function mockHiredCard(page: Page): Promise<void> {
  await page.route('**/api/competitions/*/readout', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { history: Array<Record<string, unknown>> };
    for (const row of body.history) {
      if (row.card_number === ANNA) {
        row.hired_card_open = {
          contact_name: 'Hyr Hyrsson',
          contact_phone: '0701234567',
          contact_email: 'hyr@example.test',
          note: 'Lämnas i kassan',
        };
      }
    }
    await route.fulfill({ response: res, json: body });
  });
}

/**
 * The whole readout page with a read, a card read twice (a group), and the
 * consent and hire-card toasts together. Cia is read first (raises the consent
 * toast), then Anna twice (raises the hire-card toast).
 */
export async function prepareReadoutFrame(page: Page, request: APIRequestContext): Promise<void> {
  const { competitionId: id } = await seedCompetition(request, { controls: 4 });
  await mockHiredCard(page);
  // Live reads only: a read that reaches the page through the server's replay
  // after the first load is already in its history and raises no prompts.
  // The readout hello also subscribes results:<id>, which the server answers
  // with results_full after it has subscribed the readout channel; that first
  // frame on /ws (not Vite's socket) says live reads will reach the page.
  const subscribed = new Promise<void>((resolve) =>
    page.on('websocket', (ws) => {
      if (new URL(ws.url()).pathname === '/ws') ws.on('framereceived', () => resolve());
    })
  );
  await page.goto(`/competition/${id}/readout`);
  await expect(page.getByTestId('readout-view')).toBeVisible();
  await subscribed;
  await simulateRead(request, id, CIA, [31, 32, 33, 34]);
  await expect(page.getByTestId('consent-confirmation-toast')).toBeVisible();
  await simulateRead(request, id, ANNA, [31, 32, 33, 34]);
  await simulateRead(request, id, ANNA, [31, 32, 33, 34], { start: 11 * 3600 });
  await expect(page.getByTestId('hyrbricka-toast')).toBeVisible();
  await expect(page.getByTestId('card-number').first()).toHaveText(String(ANNA));
  const group = page.getByTestId('history-group').filter({ hasText: String(ANNA) });
  await expect(group.getByTestId('history-group-toggle')).toHaveText(/2 avläsningar/);
  await group.getByTestId('history-group-toggle').click();
  await expect(group.getByTestId('history-row')).toHaveCount(2);
}
