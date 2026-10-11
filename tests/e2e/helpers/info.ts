// tests/e2e/helpers/info.ts
// Authored for fartola. Not ported from upstream.
//
// Tävlingsinfo for the behaviour spec and the floor/a11y states. Each state
// gets its own competition, not started (max time still open) and with
// 23 controls, so control 53 exists. Mocks go in before the action that
// reads them; every changed element is asserted visible at the end.
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { seedCompetition } from './seed.ts';

export async function openInfo(
  page: Page,
  request: APIRequestContext,
  opts: { start?: boolean } = {}
): Promise<string> {
  const { competitionId } = await seedCompetition(request, {
    controls: 23,
    start: opts.start ?? false,
  });
  await page.goto(`/competition/${competitionId}/info`);
  await expect(page.getByTestId('info-name')).toBeVisible({ timeout: 20_000 });
  return competitionId;
}

/** Before the first start: a voided chip with its result line, the max-time
 * hint, the opened rule text, an error note and a "Sparat" note (last: it
 * fades after 3 s). */
export async function prepareInfo(page: Page, request: APIRequestContext): Promise<void> {
  const id = await openInfo(page, request);
  const chip = page.locator('[data-testid=info-ctrl-chip][data-code="53"]');
  await chip.click();
  await expect(chip).toContainText('struken');
  await expect(page.getByTestId('info-void-result')).toContainText('Kontroll 53 struken.');

  await expect(page.getByTestId('info-max-time-lock')).toHaveText(
    'Låses när tävlingen startar (TR 4.21.2).'
  );
  await page.getByTestId('info-max-time-rule').locator('summary').click();
  await expect(page.getByTestId('info-max-time-rule')).toContainText('densamma för alla klasser');

  let failed = false;
  await page.route(`**/api/competitions/${id}`, (route) => {
    if (route.request().method() !== 'PATCH' || failed) return route.continue();
    failed = true;
    return route.fulfill({ status: 500, json: { error: 'boom' } });
  });
  await page.getByTestId('info-distance').selectOption('sprint');
  await expect(page.getByTestId('info-distance-note')).toHaveText(
    'Ändringen sparades inte. Försök igen.'
  );

  await page.getByTestId('info-level').selectOption('niva2');
  await expect(page.getByTestId('info-level-note')).toHaveText('Sparat');
  await expect(page.getByTestId('info-void-undo')).toBeVisible();
  await expect(page.getByTestId('info-max-time-save')).toBeVisible();
}

/** After the first start: the max time is read-only and says so. */
export async function prepareInfoLocked(page: Page): Promise<void> {
  await expect(page.getByTestId('info-max-time-lock')).toHaveText('Låst sedan första start.');
  await expect(page.getByTestId('info-max-time')).toHaveAttribute('readonly', '');
  await expect(page.getByTestId('info-reimport')).toBeVisible();
}
