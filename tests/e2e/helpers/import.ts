// tests/e2e/helpers/import.ts
// Authored for fartola. Not ported from upstream.
//
// Prepared state for the import sheet: an event list from a mocked
// Eventor search, a date error, and a finished upload with the "Klar"
// button. Eventor is always mocked: unmocked it calls the real service.
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { BASE } from './seed.ts';
import { ENTRYLIST_FIXTURE } from './wizard.ts';
import { longCourseXml } from './long-course.ts';

export const EVENT = { eventId: 4242, name: 'Testtävling', date: '2026-10-09', clock: '18:00:00' };

/** A competition with no runners, made active. With `withCourse` it has the generated course
 * (an entry list is refused without one). */
export async function createEmptyCompetition(
  request: APIRequestContext,
  withCourse = false
): Promise<string> {
  const created = await request.post(`${BASE}/api/competitions`, {
    data: { name: `Importlabb ${Date.now()}`, date: '2026-10-09' },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  if (withCourse) {
    const course = await request.post(`${BASE}/api/competitions/${id}/import`, {
      multipart: {
        file: {
          name: 'coursedata.xml',
          mimeType: 'application/xml',
          buffer: Buffer.from(longCourseXml(3)),
        },
      },
    });
    expect(course.status()).toBe(201);
  }
  const active = await request.post(`${BASE}/api/sessions/active-competition`, {
    data: { competition_id: id },
  });
  expect(active.status()).toBe(200);
  return id;
}

export async function mockEventorEvents(page: Page): Promise<void> {
  await page.route('**/api/eventor/events?**', (r) => r.fulfill({ json: { events: [EVENT] } }));
}

/** Event list, a bad date, then a finished upload with its Klar button. */
export async function prepareImport(page: Page): Promise<void> {
  await mockEventorEvents(page);
  // The date fills in after the competition loads; a click before that
  // only shows a date error.
  await expect(page.getByTestId('import-date')).not.toHaveValue('');
  await page.getByTestId('import-search').click();
  await expect(page.getByTestId('import-event-list')).toBeVisible();
  await page.getByTestId('import-date').fill('2026-1');
  await page.getByTestId('import-date').blur();
  await expect(page.getByTestId('import-date-error')).toBeVisible();
  await page.getByTestId('import-upload-input').setInputFiles(ENTRYLIST_FIXTURE);
  await expect(page.getByTestId('import-result')).toBeVisible();
  await expect(page.getByTestId('import-skipped')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Klar – visa anmälda' })).toBeVisible();
}
