// Authored for fartola. Not ported from upstream.
//
// The secretariat corrects a read-out from the competitor dialog: a control
// punched by hand (SOFT TR 8.1.4 kommentar), a false start (TR 4.18.14) and
// a finish time by hand (TR 4.20.6). Each shows on the readout card, and
// removing it undoes it. Synthetic data only (helpers/seed.ts).

import { test, expect } from '@playwright/test';
import { seedCompetition, simulateRead } from './helpers/seed.ts';

test('punch, false start and finish by hand, each shown and undone', async ({ page, request }) => {
  const { competitionId } = await seedCompetition(request, { controls: 4 });
  await page.goto(`/competition/${competitionId}/readout`);
  await expect(page.getByTestId('readout-view')).toBeVisible();
  // Anna (H21, 31–34) misses 32: start 10:00:00, finish 10:08:00.
  await simulateRead(request, competitionId, 7_501_853, [31, 33, 34]);
  const card = page.getByTestId('latest-read');
  await expect(card.getByTestId('elapsed')).toHaveText('8:00', { timeout: 5_000 });
  await expect(card.locator('.punch[data-state="miss"]')).toHaveCount(1);
  // An imported entry asks for consent at the first read-out.
  await page.getByTestId('consent-toast-confirm').click();
  await expect(page.getByTestId('consent-confirmation-toast')).toHaveCount(0);

  await page.getByTestId('edit-competitor-btn').click();
  const panel = page.getByTestId('corrections');
  await expect(panel).toBeVisible();

  // The missing control is offered; add it from the start card.
  await panel.getByTestId('corr-punch-pick').filter({ hasText: '32' }).click();
  await panel.getByTestId('corr-punch-add').click();
  await expect(panel.getByTestId('corr-punch')).toContainText('32');
  await expect(panel.getByTestId('corr-now')).toContainText('Godkänd');

  // A false start: one minute, in the time.
  await panel.getByTestId('corr-false-start').click();
  await expect(panel.getByTestId('corr-now')).toContainText('9:00');

  // The finish unit failed: the finish line time was 10:07:30.
  await panel.getByTestId('corr-finish-input').fill('10:07:30');
  await panel.getByTestId('corr-finish-set').click();
  await expect(panel.getByTestId('corr-finish-time')).toHaveText('10:07:30');
  await expect(panel.getByTestId('corr-now')).toContainText('8:30');

  await page.keyboard.press('Escape');
  await expect(card.getByTestId('elapsed')).toHaveText('8:30', { timeout: 5_000 });
  await expect(card.locator('.punch[data-state="manual"]')).toHaveCount(1);
  await expect(card.getByTestId('corrections-line')).toContainText('Stämpel för hand 32');
  await expect(card.getByTestId('corrections-line')).toContainText('Tidstillägg 1 min');
  await expect(card.getByTestId('corrections-line')).toContainText('Måltid för hand 10:07:30');

  // Undo all three: the card is back to the read-out.
  await page.getByTestId('edit-competitor-btn').click();
  await panel.getByTestId('corr-punch-remove').click();
  await panel.getByTestId('corr-addition-remove').click();
  await panel.getByTestId('corr-finish-remove').click();
  await expect(panel.getByTestId('corr-finish-input')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card.getByTestId('elapsed')).toHaveText('8:00', { timeout: 5_000 });
  await expect(card.getByTestId('corrections-line')).toHaveCount(0);
  await expect(card.locator('.punch[data-state="miss"]')).toHaveCount(1);
});
