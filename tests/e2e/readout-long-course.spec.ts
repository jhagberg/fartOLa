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
  request: Parameters<typeof seedCompetition>[0],
  controls = 35
): Promise<void> {
  const { competitionId } = await seedCompetition(request, { controls });
  await page.goto(`/competition/${competitionId}/readout`);
  await expect(page.getByTestId('readout-view')).toBeVisible();
  await simulateRead(request, competitionId, 7_501_853, longCourseCodes(controls));
  if (controls > 20) {
    await expect(page.getByTestId('punch-grid')).toHaveAttribute('data-size', 'medium', {
      timeout: 5_000,
    });
  } else {
    await expect(page.getByTestId('punch-grid')).toBeVisible({ timeout: 5_000 });
  }
}

// Every part of the open status picker: chips, reason input, cancel, confirm.
async function expectPickerVisible(page: Page, scroll: boolean): Promise<void> {
  const parts = page.locator(
    '.dnf-pop [data-testid^="status-pick-"], [data-testid="dnf-reason-input"], [data-testid="dnf-cancel"], [data-testid="dnf-confirm"]'
  );
  // The popover must not start above the scroll origin of .content, where
  // no amount of scrolling can reach it.
  const aboveOrigin = await page.evaluate(() => {
    const c = document.querySelector('.content')!;
    const p = document.querySelector('.dnf-pop')!;
    return c.getBoundingClientRect().top - (p.getBoundingClientRect().top + 0) - c.scrollTop;
  });
  expect(aboveOrigin).toBeLessThanOrEqual(0);
  // The reason label carries meaning: 14 px, sentence case (ADR-0016 rule 7).
  const label = page.locator('.dnf-pop .dnf-label');
  await expect(label).toHaveCSS('font-size', '14px');
  await expect(label).toHaveCSS('text-transform', 'none');
  const n = await parts.count();
  expect(n).toBeGreaterThanOrEqual(7);
  for (let i = 0; i < n; i++) {
    if (scroll) await parts.nth(i).scrollIntoViewIfNeeded();
    await expect(parts.nth(i)).toBeInViewport({ ratio: 1 });
  }
}

const pageScroll = (page: Page) =>
  page.evaluate(() => (document.querySelector('.content')?.scrollTop ?? 0) + window.scrollY);

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 820, height: 1180 },
]) {
  test(`35 controls at ${viewport.width}×${viewport.height}: print and picker fully in view`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize(viewport);
    await openLongRead(page, request);
    await expect(page.getByTestId('print-btn')).toBeInViewport({ ratio: 1 });
    await page.getByTestId('manual-dnf-btn').click();
    await expectPickerVisible(page, false);
    await expect(page.getByTestId('print-btn')).toBeInViewport({ ratio: 1 });
    expect(await pageScroll(page)).toBe(0);
  });
}

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 683, height: 384 },
  { width: 1024, height: 500 },
]) {
  test(`4 controls at ${viewport.width}×${viewport.height}: picker fully in view`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize(viewport);
    await openLongRead(page, request, 4);
    await page.getByTestId('manual-dnf-btn').click();
    await expectPickerVisible(page, true);
  });
}

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

    // Only the punch area scrolls; the runner's identity stays put.
    const punches = page.getByTestId('punch-scroll');
    expect(await punches.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    await expect(page.getByTestId('print-btn')).toBeInViewport({ ratio: 1 });

    await punches.evaluate((e) => (e.scrollTop = e.scrollHeight));
    const last = page.locator('[data-testid="punch-grid"] .punch').last();
    await expect(last).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('print-btn')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('card-number')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('runner-name')).toBeInViewport({ ratio: 1 });
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
  await expectPickerVisible(page, true);
});
