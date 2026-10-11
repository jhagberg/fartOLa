// tests/e2e/helpers/runners.ts
// Authored for fartola. Not ported from upstream.
//
// Anmälda: a competition with a withdrawn runner, a hire card and a start
// time, and the floor/a11y states of the list, the edit dialog and the add
// sheet. Its own competition: the states edit and withdraw. Every changed
// element is asserted visible at the end of its state.
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { BASE, seedCompetition } from './seed.ts';

export type RunnersSeed = { id: string; h21: string; d21: string };

/** Anna H21 (card 7501853), Bo, Cia D21 (card 1428824) from the entry list,
 * plus Hyra Hansson with a hire card; Bo has withdrawn, Cia has a start time. */
export async function seedRunners(request: APIRequestContext): Promise<RunnersSeed> {
  const { competitionId: id } = await seedCompetition(request, { controls: 8 });
  const classes = (await (await request.get(`${BASE}/api/competitions/${id}/classes`)).json()) as {
    classes: Array<{ id: string; name: string }>;
  };
  const h21 = classes.classes.find((c) => c.name === 'H21')!.id;
  const d21 = classes.classes.find((c) => c.name === 'D21')!.id;
  const hire = await request.post(`${BASE}/api/competitors`, {
    data: {
      competition_id: id,
      name: 'Hyra Hansson',
      class_id: h21,
      card_number: 88001,
      consent: true,
      hired_card: true,
      hired_contact: { name: null, phone: '0701234567', email: null, note: null },
    },
  });
  expect(hire.status(), await hire.text()).toBe(201);
  const list = (await (await request.get(`${BASE}/api/competitions/${id}/competitors`)).json()) as {
    competitors: Array<{ id: string; name: string }>;
  };
  const byName = (n: string) => list.competitors.find((c) => c.name.startsWith(n))!.id;
  const start = await request.patch(
    `${BASE}/api/competitions/${id}/competitors/${byName('Cia')}/start-time`,
    { data: { start_time_ms: Date.now() + 3_600_000 } }
  );
  expect(start.status(), await start.text()).toBeLessThan(300);
  const cancel = await request.post(
    `${BASE}/api/competitions/${id}/competitors/${byName('Bo')}/status`,
    { data: { status: 'CANCEL', reason: 'Återbud' } }
  );
  expect(cancel.status(), await cancel.text()).toBeLessThan(300);
  return { id, h21, d21 };
}

export async function openRunners(page: Page, id: string): Promise<void> {
  await page.goto(`/competition/${id}/runners`);
  await expect(page.getByTestId('runners-view')).toBeVisible();
  // The first visit compiles the route and runs five requests.
  await expect(page.getByTestId('runners-row').first()).toBeVisible({ timeout: 20_000 });
}

/** The list: a muted Återbud row, an owned card, a hire card, a start-time
 * chip, the search clear button and the filtered count. */
export async function prepareRunnersList(page: Page, request: APIRequestContext): Promise<void> {
  const { id } = await seedRunners(request);
  await openRunners(page, id);
  await expect(page.locator('[data-testid=runners-row][data-withdrawn=true]')).toBeVisible();
  await expect(page.getByTestId('runners-card-owned').first()).toBeVisible();
  await expect(page.getByTestId('runners-card-hire')).toContainText('Hyrbricka');
  await expect(page.getByTestId('runners-card-hire').locator('svg')).toBeVisible();
  await expect(page.getByTestId('runners-start-time')).toBeVisible();
  await page.getByTestId('runners-search').fill('r');
  await expect(page.getByTestId('runners-search-clear')).toBeVisible();
  await expect(page.getByTestId('runners-count')).toContainText(/\d+ av \d+/);
}

/** The edit dialog with an error under the name, class and card fields. */
export async function prepareRunnersEdit(page: Page, request: APIRequestContext): Promise<void> {
  const { id } = await seedRunners(request);
  await openRunners(page, id);
  await page.getByTestId('runners-row').filter({ hasText: 'Anna' }).click();
  await expect(page.getByTestId('edit-name')).toBeVisible();
  await expect(page.getByTestId('edit-close')).toBeVisible();
  await page.getByTestId('edit-name').fill('');
  await page.getByTestId('edit-card').fill('abc');
  await page.getByTestId('edit-save-btn').click();
  await expect(page.getByTestId('edit-name-error')).toHaveText('Fyll i namn');
  await expect(page.getByTestId('edit-card-error')).toBeVisible();
  await expect(page.getByTestId('edit-withdraw-btn')).toBeVisible();
}

/** The add sheet, opened with its toggles, hint and a missing-name error. */
export async function prepareRunnersAdd(page: Page, request: APIRequestContext): Promise<void> {
  const { id } = await seedRunners(request);
  await openRunners(page, id);
  await page.getByTestId('runners-add-btn').click();
  await expect(page.getByTestId('add-runner-name')).toBeVisible();
  await expect(page.getByTestId('add-runner-klubblos')).toBeVisible();
  await page.getByTestId('add-runner-hire').check();
  await expect(page.getByTestId('add-runner-hired-fields')).toBeVisible();
  await page.getByTestId('add-runner-save').click();
  await expect(page.getByTestId('add-runner-error')).toBeVisible();
}

/** More runners in H21, sorted after the seeded ones (Zorro 01...). */
export async function addRunners(
  request: APIRequestContext,
  seed: RunnersSeed,
  names: string[],
  cards: Array<number | null> = []
): Promise<void> {
  await Promise.all(
    names.map(async (name, i) => {
      const res = await request.post(`${BASE}/api/competitors`, {
        data: {
          competition_id: seed.id,
          name,
          class_id: seed.h21,
          card_number: cards[i] ?? null,
          consent: true,
        },
      });
      expect(res.status(), await res.text()).toBe(201);
    })
  );
}
