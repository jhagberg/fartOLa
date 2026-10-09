// Authored for fartola. Not ported from upstream.
//
// ADR-0016 rule 4: the readout's main button never scrolls away. With a
// 35-control course the punch area scrolls inside the card; the page
// itself does not scroll, and "Skriv ut kvitto" and the manual-status
// picker stay fully visible. At 200 % zoom (683×384) the page may scroll,
// but every action is reachable and nothing is clipped.

import { test, expect, type Page } from '@playwright/test';
import { longCourseCodes } from './helpers/long-course.ts';
import { seedCompetition, simulateRead } from './helpers/seed.ts';

test.describe.configure({ mode: 'serial' });

async function openLongRead(
  page: Page,
  request: Parameters<typeof seedCompetition>[0]
): Promise<void> {
  const { competitionId } = await seedCompetition(request, { controls: 35 });
  await page.goto(`/competition/${competitionId}/readout`);
  await expect(page.getByTestId('readout-view')).toBeVisible();
  await simulateRead(request, competitionId, 7_501_853, longCourseCodes(35));
  await expect(page.getByTestId('punch-grid')).toHaveAttribute('data-size', 'medium', {
    timeout: 5_000,
  });
}

const pageScroll = (page: Page) =>
  page.evaluate(() => (document.querySelector('.content')?.scrollTop ?? 0) + window.scrollY);

for (const viewport of [
  { width: 1366, height: 600 },
  { width: 820, height: 640 },
]) {
  test(`35 controls at ${viewport.width}×${viewport.height}: actions in view`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize(viewport);
    await openLongRead(page, request);

    const body = page.locator('[data-testid="latest-read"] .body');
    expect(await body.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    await expect(page.getByTestId('print-btn')).toBeInViewport({ ratio: 1 });

    await body.evaluate((e) => (e.scrollTop = e.scrollHeight));
    const last = page.locator('[data-testid="punch-grid"] .punch').last();
    await expect(last).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('print-btn')).toBeInViewport({ ratio: 1 });
    expect(await pageScroll(page)).toBe(0);

    await page.getByTestId('manual-dnf-btn').click();
    await expect(page.getByTestId('dnf-reason-input')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('dnf-confirm')).toBeInViewport({ ratio: 1 });
  });
}

test('35 controls at 200 % zoom (683×384): every action reachable', async ({ page, request }) => {
  await page.setViewportSize({ width: 683, height: 384 });
  await openLongRead(page, request);
  for (const id of ['print-btn', 'manual-dnf-btn']) {
    await page.getByTestId(id).scrollIntoViewIfNeeded();
    await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
  }
  await page.getByTestId('manual-dnf-btn').click();
  for (const id of ['dnf-reason-input', 'dnf-confirm']) {
    await page.getByTestId(id).scrollIntoViewIfNeeded();
    await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
  }
});
