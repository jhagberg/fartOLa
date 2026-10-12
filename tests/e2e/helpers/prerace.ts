// tests/e2e/helpers/prerace.ts
// Authored for fartola. Not ported from upstream.
//
// A competition for Kontroll where classes lack start times: H21 is timed
// from the start time, D21 is an open class timed from the start time. Its
// own competition, so the shared one keeps showing other screens what they
// expect.
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { BASE, seedCompetition } from './seed.ts';

export async function seedNoStartTimes(
  request: APIRequestContext
): Promise<{ id: string; ids: Record<string, string> }> {
  const { competitionId: id } = await seedCompetition(request, { controls: 8, start: false });
  const res = await request.get(`${BASE}/api/competitions/${id}/classes`);
  const { classes } = (await res.json()) as { classes: Array<{ id: string; name: string }> };
  const ids = Object.fromEntries(classes.map((c) => [c.name, c.id]));
  for (const name of ['H21', 'D21']) {
    const patch = await request.patch(`${BASE}/api/competitions/${id}/classes/${ids[name]}`, {
      data: { start_method: 'start_time' },
    });
    expect(patch.status(), await patch.text()).toBeLessThan(300);
  }
  const kind = await request.put(`${BASE}/api/competitions/${id}/classes/kinds`, {
    data: { items: [{ class_id: ids['D21'], class_kind: 'oppen', age_class: null }] },
  });
  expect(kind.status(), await kind.text()).toBeLessThan(300);
  return { id, ids };
}

/** Two more answers the rules refuse, set through the API: H16 (a runner,
 * free start stored while the level was unset) is confirmed as an age class,
 * D21 (open, start time) is already confirmed; then the competition gets
 * nivå 2. Kontroll lists H16 as forbidden and D21 as required. */
export async function addStartChoiceConflicts(
  request: APIRequestContext,
  id: string,
  ids: Record<string, string>
): Promise<void> {
  const made = await request.post(`${BASE}/api/competitions/${id}/classes`, {
    data: { name: 'H16' },
  });
  expect(made.status(), await made.text()).toBe(201);
  const h16 = ((await made.json()) as { id: string }).id;
  const runner = await request.post(`${BASE}/api/competitors`, {
    data: {
      competition_id: id,
      name: 'Dan Dahl',
      class_id: h16,
      card_number: 12346,
      consent: true,
    },
  });
  expect(runner.status(), await runner.text()).toBe(201);
  const free = await request.patch(`${BASE}/api/competitions/${id}/classes/${h16}`, {
    data: { start_method: 'free_start' },
  });
  expect(free.status(), await free.text()).toBe(200);
  const kind = await request.put(`${BASE}/api/competitions/${id}/classes/kinds`, {
    data: {
      items: [
        { class_id: h16, class_kind: 'senior', age_class: null },
        { class_id: ids['D21'], class_kind: 'oppen', age_class: null },
      ],
    },
  });
  expect(kind.status(), await kind.text()).toBeLessThan(300);
  const level = await request.patch(`${BASE}/api/competitions/${id}`, { data: { level: 'niva2' } });
  expect(level.status(), await level.text()).toBe(200);
}

/** Kontroll with classes without start times: Lotta klassen, Fri start with
 * its explanation, the open-class hint, and the line after Fri start on H21. */
export async function prepareKontrollNoStart(
  page: Page,
  request: APIRequestContext
): Promise<void> {
  const { id } = await seedNoStartTimes(request);
  await page.goto(`/competition/${id}/kontroll`);
  await expect(page.getByTestId('prerace-view')).toBeVisible();
  const links = page.getByTestId('prerace-class-link');
  await expect(links).toHaveCount(2, { timeout: 20_000 });
  await expect(page.getByRole('link', { name: /^Lotta klassen/ }).first()).toBeVisible();
  await expect(page.getByTestId('prerace-open-class-help')).toBeVisible();
  await expect(links.filter({ hasText: 'D21' }).getByTestId('prerace-free-start')).toBeVisible();
  await links.filter({ hasText: 'H21' }).getByTestId('prerace-free-start').click();
  const done = page.getByTestId('prerace-free-start-done');
  await expect(done).toContainText('H21 har nu fri start.');
  await expect(done.getByRole('link', { name: 'Ändra i Lottning' })).toBeVisible();
  await expect(links).toHaveCount(1);
}

/** Kontroll with the section for start choices the rules refuse: H16 is
 * forbidden (no button, a link), D21 is required (button and link). */
export async function prepareKontrollStartChoice(
  page: Page,
  request: APIRequestContext
): Promise<void> {
  const { id, ids } = await seedNoStartTimes(request);
  await addStartChoiceConflicts(request, id, ids);
  await page.goto(`/competition/${id}/kontroll`);
  await expect(page.getByTestId('prerace-view')).toBeVisible();
  const conflicts = page.getByTestId('prerace-section-startChoice');
  await expect(conflicts).toContainText('H16: fri start är inte tillåten', { timeout: 20_000 });
  await expect(conflicts).toContainText('D21: öppen klass ska ha fri starttid');
  await expect(conflicts.getByRole('link', { name: /Ändra i Lottning/ })).toHaveCount(2);
  await expect(conflicts.getByTestId('prerace-free-start')).toBeVisible();
}
