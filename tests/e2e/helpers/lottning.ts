// tests/e2e/helpers/lottning.ts
// Authored for fartola. Not ported from upstream.
//
// Floor/a11y states for the draw screen. Mocks go in before the page
// loads or the action that reads them; every changed element is asserted
// visible at the end of its state.
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { BASE, seedCompetition, useDrawnStarts } from './seed.ts';

const LOTTNING = '**/api/competitions/*/lottning/*';

/** Its own competition (these states
 * draw and save, which would change what the shared one shows other screens. */
async function ownLottning(page: Page, request: APIRequestContext): Promise<string> {
  const { competitionId } = await seedCompetition(request, { controls: 8, start: false });
  await useDrawnStarts(request, competitionId);
  await page.goto(`/competition/${competitionId}/lottning`);
  await expect(page.getByTestId('lottning-view')).toBeVisible();
  return competitionId;
}

async function chooseClass(page: Page, name: string): Promise<void> {
  await page.getByTestId('lottning-class-select').selectOption({ label: name });
}

/** A drawn and redrawn class: the form, kind lines, "Fler val" with the seeding
 * fields and bibs, the start list with a row error, the undo link and the
 * saved max time. The max time goes last: its "Sparat" fades after 3 s. */
export async function prepareLottningFull(page: Page, request: APIRequestContext): Promise<void> {
  await ownLottning(page, request);
  await chooseClass(page, 'H21');
  await expect(page.getByTestId('lottning-draw-btn')).toBeEnabled();
  await page.getByTestId('lottning-draw-btn').click();
  await expect(page.getByTestId('lottning-row').first()).toBeVisible();
  await expect(page.getByTestId('lottning-draw-btn')).toHaveText('Lotta om');
  await page.getByTestId('lottning-draw-btn').click();
  await expect(page.getByTestId('lottning-redrawn')).toBeVisible();
  await expect(page.getByTestId('lottning-class-kind')).toBeVisible();
  await expect(page.getByTestId('lottning-preview')).toBeVisible();
  await expect(page.locator('.start-table th').first()).toBeVisible();

  await page.getByTestId('lottning-mode-select').selectOption('Seeded');
  await expect(page.getByTestId('lottning-seeding')).toBeVisible();
  await expect(page.locator('.seed-table th').first()).toBeVisible();
  await expect(page.getByTestId('lottning-bibs')).toBeVisible();
  await expect(page.locator('.group legend').first()).toBeVisible();

  await page.getByTestId('lottning-edit-time-btn').first().click();
  await page.getByTestId('lottning-edit-time-input').fill('xx:yy');
  await page.getByTestId('lottning-edit-time-input').press('Enter');
  await expect(page.getByTestId('lottning-row-error')).toBeVisible();

  // A draw in the past locks the real max time (SOFT TR 4.21.2): mock the save.
  await page.route('**/api/competitions/*/classes/*', (route) =>
    route.request().method() === 'PATCH' ? route.fulfill({ json: { ok: true } }) : route.continue()
  );
  await expect(page.getByTestId('lottning-start-method')).toBeVisible();
  await expect(page.getByText('Startlista. Tiden räknas från starttiden.')).toBeVisible();
  await page.getByTestId('lottning-start-start_time').check();
  await page.getByTestId('lottning-max-time').fill('60:00');
  await page.getByTestId('lottning-max-time-save').click();
  await expect(page.getByTestId('lottning-start-method-note')).toContainText('Sparat');
  await expect(page.getByText('Sparat')).toHaveCount(2);
}

/** Class settings that did not save, with their notes in the error colour,
 * and a max time typed wrong (its field error replaces the max-time note). */
export async function prepareLottningMaxTimeError(
  page: Page,
  request: APIRequestContext
): Promise<void> {
  await ownLottning(page, request);
  await chooseClass(page, 'H21');
  await expect(page.getByTestId('lottning-draw-btn')).toBeEnabled();
  await page.route('**/api/competitions/*/classes/*', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, json: { error: 'boom' } })
      : route.continue()
  );
  await page.getByTestId('lottning-max-time').fill('45:00');
  await page.getByTestId('lottning-max-time-save').click();
  await expect(page.getByText('Maxtiden sparades inte. Försök igen.')).toBeVisible();
  await page.getByTestId('lottning-max-time').fill('abc');
  await page.getByTestId('lottning-max-time-save').click();
  await expect(page.getByTestId('lottning-max-time-error')).toBeVisible();
  await expect(page.getByTestId('lottning-start-method')).toBeVisible();
  await page.getByTestId('lottning-start-start_time').click();
  await expect(page.getByTestId('lottning-start-method-note')).toContainText(
    'Valet sparades inte. Försök igen.'
  );
  // A failed save unticks the box again, so click rather than check().
  await page.getByTestId('lottning-no-timing').click();
  await expect(page.getByTestId('lottning-no-timing-note')).toContainText(
    'Valet sparades inte. Försök igen.'
  );
}

/** H21 stored as free start, then confirmed as an age class at nivå 1: the
 * third answer is closed, the conflict stands in the error style and Lotta
 * waits with its hint. */
export async function prepareLottningStartChoiceConflict(
  page: Page,
  request: APIRequestContext
): Promise<void> {
  const id = await ownLottning(page, request);
  const res = await request.get(`${BASE}/api/competitions/${id}/classes`);
  const { classes } = (await res.json()) as { classes: Array<{ id: string; name: string }> };
  const h21 = classes.find((c) => c.name === 'H21')!.id;
  // Free start is allowed while the level is unset; the rules then close it.
  const free = await request.patch(`${BASE}/api/competitions/${id}/classes/${h21}`, {
    data: { start_method: 'free_start' },
  });
  expect(free.status(), await free.text()).toBe(200);
  const kind = await request.put(`${BASE}/api/competitions/${id}/classes/kinds`, {
    data: { items: [{ class_id: h21, class_kind: 'senior', age_class: null }] },
  });
  expect(kind.status(), await kind.text()).toBeLessThan(300);
  const level = await request.patch(`${BASE}/api/competitions/${id}`, { data: { level: 'niva1' } });
  expect(level.status()).toBe(200);
  await page.reload();
  await expect(page.getByTestId('lottning-view')).toBeVisible();
  await chooseClass(page, 'H21');
  await expect(page.getByTestId('lottning-start-free_start')).toBeDisabled();
  await expect(page.getByTestId('lottning-start-free_start')).toBeChecked();
  await expect(page.getByTestId('lottning-start-method-rule')).toHaveText(
    'Fri start är inte tillåten i åldersklass på nivå 1–3 (TR 7.4.2).'
  );
  await expect(page.getByTestId('lottning-draw-btn')).toBeDisabled();
  await expect(
    page.getByText('Klassen har fri start. Välj Lottad starttid för att lotta.')
  ).toBeVisible();
}

/** A pursuit file chosen and being read: Lotta waits with its hint. */
export async function prepareLottningPursuitReading(
  page: Page,
  request: APIRequestContext
): Promise<void> {
  await ownLottning(page, request);
  await chooseClass(page, 'H21');
  await expect(page.getByTestId('lottning-draw-btn')).toBeEnabled();
  await page.route('**/import/previous-results', () => new Promise(() => {}));
  await page.getByTestId('lottning-mode-select').selectOption('Pursuit');
  await expect(page.getByTestId('lottning-pursuit')).toBeVisible();
  await page.getByTestId('pursuit-results-file').setInputFiles({
    name: 'dag1.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from('<ResultList/>'),
  });
  await expect(page.getByText('Resultatlistan läses in', { exact: true })).toBeVisible();
  await page.getByTestId('pursuit-results-upload').click();
  await expect(page.getByTestId('pursuit-results-upload')).toHaveText('Läser in filen…');
  await expect(page.locator('.file-label')).toBeVisible();
}

/** A class without a start list: the empty hint. */
export async function prepareLottningEmpty(page: Page, request: APIRequestContext): Promise<void> {
  await ownLottning(page, request);
  await chooseClass(page, 'D21');
  await expect(page.getByTestId('lottning-empty')).toHaveText(
    'Inga starttider ännu. Välj klass och tryck Lotta.'
  );
}

/** The failed load with its retry. */
export async function prepareLottningLoadError(page: Page): Promise<void> {
  await page.route(LOTTNING, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 500, json: { error: 'boom' } })
      : route.continue()
  );
  await page.reload();
  const alert = page.getByRole('alert').filter({ hasText: 'Kunde inte hämta lottningen.' });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole('button', { name: 'Försök igen' })).toBeVisible();
}
