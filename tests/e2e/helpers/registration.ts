// tests/e2e/helpers/registration.ts
// Authored for fartola. Not ported from upstream.
//
// Puts /registration into the state where every conditional element is
// on screen: queue badge, queue list with a chip, known-card banner,
// dedupe toast and manual-entry error. The walk-up modal stays open for
// the current card (it is another track's screen).
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { simulateRead } from './seed.ts';

/** Wait for the modal to show `card`, skipping the "who is entered" step on the way. */
async function showsCard(page: Page, card: number): Promise<void> {
  const skip = page.getByRole('button', { name: /direktanmälan/ });
  await expect(async () => {
    if (await skip.isVisible()) await skip.click();
    await expect(page.getByTestId('walkup-card')).toHaveValue(String(card), { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

export async function prepareRegistration(
  page: Page,
  id: string,
  request: APIRequestContext
): Promise<void> {
  // Fresh cards per call: an earlier call may have registered its own.
  const A = 1_000_000 + Math.floor(Math.random() * 8_000_000);
  const B = A + 1;
  const C = A + 2;
  // The page subscribes to reads after it mounts; an earlier read is lost.
  await page.waitForTimeout(1_000);
  await simulateRead(request, id, A, []);
  await showsCard(page, A);
  await simulateRead(request, id, B, []);
  await simulateRead(request, id, C, []);
  await expect(page.getByTestId('reg-queue-badge')).toContainText('2', { timeout: 5_000 });
  // Register A so that reading it again shows the known-card banner.
  await page.getByTestId('walkup-name').fill('Provlöpare Ett');
  await page.getByTestId('walkup-class').selectOption({ index: 1 });
  await page.getByTestId('walkup-consent').check();
  await page.getByTestId('walkup-save').click();
  await showsCard(page, B);
  await simulateRead(request, id, A, []);
  await expect(page.getByTestId('reg-known-banner')).toBeVisible({ timeout: 5_000 });
  // Current card read again: dedupe toast (lives about 3 s).
  await simulateRead(request, id, B, []);
  await expect(page.getByTestId('reg-toast')).toBeVisible({ timeout: 3_000 });
  // Manual entry error.
  await page.getByTestId('reg-manual-input').fill('abc');
  await page.getByTestId('reg-manual-input').blur();
  await expect(page.getByTestId('reg-manual-error')).toBeVisible();
  // Let button transitions finish so a measurement sees the final colours.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished)
    )
  );
  await expect(page.getByTestId('reg-queue-badge')).toBeVisible();
  await expect(page.getByTestId('reg-queue-chip').first()).toBeVisible();
}
