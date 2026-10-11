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
 * hint, the opened rule text, an error note and a "Sparat" note that is held
 * on screen. Its own competition, not the harness's: that one has started
 * (no "Låses…" hint), has too few controls for 53, and voiding a control
 * would change its results for the other screens. */
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

  // "Sparat" fades after 3 s; drop that one timer so the floor and a11y
  // checks measure the note however slow the run is.
  await page.evaluate(() => {
    const later = window.setTimeout;
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) =>
      ms === 3000 ? 0 : later(fn, ms, ...args)) as typeof window.setTimeout;
  });
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

/** "Hämta från Eventor" whose reload failed: the fees stay locked, with a
 * plain error and a retry. The competition is shown as Eventor-linked. */
export async function prepareInfoFeesReloadError(
  page: Page,
  request: APIRequestContext
): Promise<void> {
  const { competitionId: id } = await seedCompetition(request, { controls: 23, start: false });
  await page.route(`**/api/competitions/${id}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = (await response.json()) as { competition: Record<string, unknown> };
    body.competition.eventor_event_id = 1;
    return route.fulfill({ response, json: body });
  });
  await page.route(`**/api/competitions/${id}/fees/from-eventor`, (route) =>
    route.fulfill({ json: { updated: 0 } })
  );
  await page.goto(`/competition/${id}/info`);
  const fetchFees = page.getByTestId('fees-from-eventor');
  await expect(fetchFees).toBeEnabled({ timeout: 20_000 });
  await page.route(`**/api/competitions/${id}/fees`, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 500, json: { error: 'boom' } })
      : route.continue()
  );
  await fetchFees.click();
  await expect(page.getByTestId('fees-reload-error')).toContainText(
    'Det gick inte att läsa avgifterna igen.'
  );
  await expect(page.getByTestId('fees-reload-error').getByRole('button')).toBeVisible();
  await expect(page.getByTestId('fees-card-fee')).toBeDisabled();
}
