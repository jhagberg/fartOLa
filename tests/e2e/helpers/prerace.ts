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

/** Kontroll with a class without start times: the link to Lottning, and the
 * explanation for the open class. */
export async function prepareKontrollNoStart(
  page: Page,
  request: APIRequestContext
): Promise<void> {
  const { id } = await seedNoStartTimes(request);
  await page.goto(`/competition/${id}/kontroll`);
  await expect(page.getByTestId('prerace-view')).toBeVisible();
  const links = page.getByTestId('prerace-class-link');
  await expect(links).toHaveCount(2, { timeout: 20_000 });
  await expect(page.getByRole('link', { name: /^Öppna i Lottning/ }).first()).toBeVisible();
  await expect(page.getByTestId('prerace-open-class-help')).toBeVisible();
  await expect(
    page.getByTestId('prerace-section-noStart').getByTestId('prerace-count')
  ).toBeVisible();
}
