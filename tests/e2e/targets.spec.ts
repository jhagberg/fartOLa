// tests/e2e/targets.spec.ts
// Authored for fartola. Not ported from upstream.
//
// ADR-0016 rule 7: touch targets at least 44 px. Measures every visible
// button, link, input and select on the frame and the readout, including
// the opened manual-status picker and the start-race confirmation.
// Visually hidden elements (the skip link until focused) are not targets.

import { test, expect } from '@playwright/test';
import { seedCompetition, simulateRead } from './helpers/seed.ts';
import { smallTargets } from './helpers/floors.ts';

test.describe.configure({ mode: 'serial' });

test('frame and readout targets are at least 44 px', async ({ page, request }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const { competitionId } = await seedCompetition(request, { controls: 8 });
  await page.goto(`/competition/${competitionId}/readout`);
  await simulateRead(request, competitionId, 7_501_853, [31, 32, 33, 34, 35, 36, 37, 38]);
  await expect(page.getByTestId('print-btn')).toBeVisible({ timeout: 5_000 });
  expect(await smallTargets(page)).toEqual([]);

  await page.getByTestId('active-comp-pill').click();
  await expect(page.getByTestId('active-comp-panel')).toBeVisible();
  // The competition list loads after the panel opens; measure its rows too.
  await expect(page.getByTestId('active-comp-panel').getByRole('option').first()).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('active-comp-panel')).toBeHidden();

  await page.getByTestId('manual-dnf-btn').click();
  await expect(page.getByTestId('dnf-reason-input')).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);
});

test('start-race confirmation targets are at least 44 px', async ({ page, request }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const { competitionId: id } = await seedCompetition(request, { controls: 8, start: false });

  await page.goto(`/competition/${id}/readout`);
  await expect(page.getByTestId('start-race-btn')).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);
  await page.getByTestId('start-race-btn').click();
  await expect(page.getByTestId('start-race-cancel')).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);
});
