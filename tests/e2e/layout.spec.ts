// tests/e2e/layout.spec.ts
// Authored for fartola. Not ported from upstream.
//
// X1/X2 (UI audit 2026-10-09): drawer at ≤1024 px, sidebar reachable at
// 1366×768, readout card not squeezed by the history rail.

import { test, expect } from '@playwright/test';
import { seedCompetition, simulateRead } from './helpers/seed.ts';

test.describe.configure({ mode: 'serial' });

test('hamburger only at ≤1024 px', async ({ page }) => {
  // 683 px = 1366 px at 200 % zoom
  for (const [width, shown] of [
    [1366, false],
    [1280, false],
    [1025, false],
    [1024, true],
    [820, true],
    [683, true],
  ] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await expect(page.getByTestId('topbar-menu')).toBeVisible({ visible: shown });
  }
});

test('closed drawer takes no Tab stops at 820 px', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto('/');
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    const inSidebar = await page.evaluate(() => !!document.activeElement?.closest('.sidebar-slot'));
    expect(inSidebar).toBe(false);
  }
});

test('settings reachable in the sidebar at 1366×768', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  const settings = page.locator('.sidebar').getByText('Inställningar', { exact: true });
  await settings.scrollIntoViewIfNeeded();
  await expect(settings).toBeInViewport();
});

for (const width of [1366, 1280, 1180, 1025, 1024, 820, 683]) {
  test(`readout column ≥ 560 px at ${width}`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const { competitionId } = await seedCompetition(request, { controls: 12 });
    await page.goto(`/competition/${competitionId}/readout`);
    await simulateRead(
      request,
      competitionId,
      7_501_853,
      [31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42]
    );
    const box = await page.getByTestId('latest-read').boundingBox();
    // 683 px leaves 651 px after the 16 px page padding; still ≥ 560.
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(560);
  });
}

test('walk-up overlay covers the whole viewport, not just the readout area', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const { competitionId } = await seedCompetition(request, { controls: 4 });
  await page.goto(`/competition/${competitionId}/readout?walkup=9999999`);
  await expect(page.getByTestId('walkup-modal')).toBeVisible();
  const overlay = page.getByTestId('walkup-overlay');
  expect(await overlay.boundingBox()).toEqual({ x: 0, y: 0, width: 1366, height: 768 });
  // Outside the size container, so no engine can make it the containing
  // block of the fixed overlay (Chromium does not, others may).
  expect(await overlay.evaluate((e) => e.closest('.readout-wrap') === null)).toBe(true);
});
