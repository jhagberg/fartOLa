// Authored for fartola. Not ported from upstream.
//
// "Kontroll inför tävlingen" e2e: the check lists what is wrong (no card,
// SI5 on a long course, no club), a fix in the edit modal clears the row,
// the Brickregister finds a card by number and name and keeps the search
// in the URL, and the screen passes the contrast and target-size scan.
// Synthetic data only (seed.ts plus one walk-up).

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { BASE, seedCompetition } from './helpers/seed.ts';

test.describe.configure({ mode: 'serial' });

test('the pre-race check lists problems, a fix clears them, and the card register searches', async ({
  page,
  request,
}) => {
  // H21 runs 35 controls: more than an SI5 holds.
  const { competitionId: id } = await seedCompetition(request, { controls: 35 });
  const classes = (await (await request.get(`${BASE}/api/competitions/${id}/classes`)).json()) as {
    classes: Array<{ id: string; name: string }>;
  };
  const h21 = classes.classes.find((c) => c.name === 'H21')!;
  const walkup = await request.post(`${BASE}/api/competitors`, {
    data: {
      competition_id: id,
      name: 'Eva Femma',
      class_id: h21.id,
      card_number: 12345,
      consent: true,
    },
  });
  expect(walkup.status(), await walkup.text()).toBe(201);

  await page.goto(`/competition/${id}/kontroll`);
  const noCard = page.getByTestId('prerace-section-noCard');
  await expect(noCard.getByTestId('prerace-count')).toHaveText('1');
  await expect(noCard).toContainText('Bo Berg');
  const small = page.getByTestId('prerace-section-cardTooSmall');
  await expect(small).toContainText('Eva Femma');
  await expect(small).toContainText('30 platser, banan har 35 kontroller');
  await expect(page.getByTestId('prerace-section-noClub')).toContainText('Eva Femma');
  await expect(
    page.getByTestId('prerace-section-noCourse').getByTestId('prerace-count')
  ).toHaveText('0');

  const axe = await new AxeBuilder({ page }).withRules(['color-contrast', 'target-size']).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  // Fix: give Bo a card in the edit modal; the check runs again.
  await noCard.getByRole('button', { name: /Bo Berg/ }).click();
  await page.getByTestId('edit-card').fill('8000123');
  await page.getByTestId('edit-save-btn').click();
  await expect(noCard.getByTestId('prerace-count')).toHaveText('0');

  await page.getByTestId('prerace-tab-cards').click();
  await expect(page).toHaveURL(/vy=brickor/);
  const rows = page.getByTestId('prerace-card-row');
  await expect(rows).toHaveCount(4);
  await page.getByTestId('prerace-cards-search').fill('8000123');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Bo Berg');
  await page.reload();
  await expect(page.getByTestId('prerace-cards-search')).toHaveValue('8000123');
  await expect(rows).toHaveCount(1);
  await page.getByTestId('prerace-cards-search').fill('cia');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('1428824');
});
