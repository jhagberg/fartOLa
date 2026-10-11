// Authored for fartola. Not ported from upstream.
//
// The edit dialog ("Ändra") shows the runner's start, punches and splits
// above the form, from the corrections endpoint (not the readout list).
// Synthetic data only (helpers/seed.ts).

import { test, expect } from '@playwright/test';
import { seedCompetition, simulateRead } from './helpers/seed.ts';
import { seedRunners } from './helpers/runners.ts';
import {
  expectPanelLoaded,
  failBlockCorrections,
  openEditFor,
  prepareEditReadNeverRead,
  seedAnnaMispunch,
} from './helpers/edit-runner.ts';

test('a mispunched read shows 35 as saknas and the splits', async ({ page, request }) => {
  const { id } = await seedAnnaMispunch(request, null);
  await openEditFor(page, id, 'Anna');
  const block = page.getByTestId('edit-read');
  const miss = block.locator('[data-testid=punch-grid] [data-state=miss]');
  await expect(miss).toHaveCount(1, { timeout: 20_000 });
  await expect(miss).toContainText('35');
  await expect(miss).toContainText('saknas');
  await expect(block.getByTestId('splits-table')).toBeVisible();
  await expect(block.getByTestId('edit-read-finish')).toHaveText('10:10:00');
  await expect(block.getByTestId('edit-read-readat')).toBeVisible();
  await expect(block.getByTestId('edit-read-status')).toContainText('Felstämplad');
  await expect(block.getByTestId('edit-read-card')).toContainText('7501853');
});

test('the start shows the drawn time and the start punch and which one counts', async ({
  page,
  request,
}) => {
  const { id } = await seedAnnaMispunch(request, 180);
  await openEditFor(page, id, 'Anna');
  const block = page.getByTestId('edit-read');
  await expect(block.getByTestId('edit-read-start')).toContainText('Lottad starttid 09:57:00', {
    timeout: 20_000,
  });
  await expect(block.getByTestId('edit-read-start')).toContainText('Startstämpling 10:00:00');
  await expect(block.getByTestId('edit-read-from')).toContainText('lottad starttid');
});

test('Sen start shows over 60 s late, not at exactly 60 s', async ({ page, request }) => {
  const late = await seedAnnaMispunch(request, 180);
  await openEditFor(page, late.id, 'Anna');
  await expect(page.getByTestId('edit-read-late')).toContainText('Sen start +3:00', {
    timeout: 20_000,
  });
  await page.keyboard.press('Escape');

  const exact = await seedAnnaMispunch(request, 60);
  await openEditFor(page, exact.id, 'Anna');
  await expect(page.getByTestId('edit-read-status')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('edit-read-late')).toHaveCount(0);
});

test('a manual punch refetches the block: för hand, and the status follows', async ({
  page,
  request,
}) => {
  const { id } = await seedAnnaMispunch(request, null);
  await openEditFor(page, id, 'Anna');
  const block = page.getByTestId('edit-read');
  await expect(block.getByTestId('edit-read-status')).toContainText('Felstämplad', {
    timeout: 20_000,
  });
  const panel = page.getByTestId('corrections');
  await panel.getByTestId('corr-punch-pick').filter({ hasText: '35' }).click();
  await panel.getByTestId('corr-punch-add').click();
  await expect(block.getByTestId('edit-read-by-hand')).toContainText('Stämpel för hand 35');
  await expect(block.locator('[data-testid=punch-grid] [data-state=manual]')).toHaveCount(1);
  await expect(block.locator('[data-testid=punch-grid] [data-state=miss]')).toHaveCount(0);
  await expect(block.getByTestId('edit-read-status')).toContainText('Godkänd');
});

test('never read says so, with the card and the rental', async ({ page, request }) => {
  const seed = await seedRunners(request);
  await openEditFor(page, seed.id, 'Hyra');
  const block = page.getByTestId('edit-read');
  await expect(block.getByTestId('edit-read-never')).toHaveText('Inte avläst ännu', {
    timeout: 20_000,
  });
  await expect(block.getByTestId('edit-read-card')).toContainText('88001');
  await expect(block.getByTestId('edit-read-hire')).toContainText('Hyrbricka');
  await expect(block.getByTestId('edit-read-error')).toHaveCount(0);
});

test('a lost card with a finish by hand still shows the finish, status and time', async ({
  page,
  request,
}) => {
  await prepareEditReadNeverRead(page, request);
  const block = page.getByTestId('edit-read');
  await expect(block.getByTestId('edit-read-readat')).toHaveCount(0);
  // Scored from the finish alone, against the course: no punches, so MP.
  await expect(block.getByTestId('edit-read-status')).toContainText('Felstämplad');
});

test('a failed fetch is not "never read": message, retry, card and rental stay', async ({
  page,
  request,
}) => {
  const seed = await seedRunners(request);
  await failBlockCorrections(page);
  await openEditFor(page, seed.id, 'Hyra');
  const block = page.getByTestId('edit-read');
  await expect(block.getByTestId('edit-read-error')).toContainText(
    'Kunde inte hämta stämplingarna',
    { timeout: 20_000 }
  );
  await expect(block.getByTestId('edit-read-never')).toHaveCount(0);
  await expectPanelLoaded(page);
  await expect(block.getByTestId('edit-read-card')).toContainText('88001');
  await expect(block.getByTestId('edit-read-hire')).toBeVisible();
  await block.getByRole('button', { name: 'Försök igen' }).click();
  await expect(block.getByTestId('edit-read-never')).toHaveText('Inte avläst ännu');
  await expect(block.getByTestId('edit-read-error')).toHaveCount(0);
});

test('the block is also in the dialog opened from the readout', async ({ page, request }) => {
  const { competitionId } = await seedCompetition(request, { controls: 4 });
  await page.goto(`/competition/${competitionId}/readout`);
  await expect(page.getByTestId('readout-view')).toBeVisible();
  await simulateRead(request, competitionId, 7_501_853, [31, 33, 34]);
  await expect(page.getByTestId('latest-read').getByTestId('elapsed')).toHaveText('8:00', {
    timeout: 20_000,
  });
  await page.getByTestId('edit-competitor-btn').click();
  const block = page.getByTestId('edit-read');
  await expect(block.locator('[data-state=miss]')).toContainText('32', { timeout: 20_000 });
  await expect(block.getByTestId('edit-read-card')).toContainText('7501853');
});
