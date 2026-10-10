// tests/e2e/import-runners.spec.ts
// Authored for fartola. Not ported from upstream.
//
// Importera löpare: an upload ends with a clear next step, a course file
// still works from the same sheet, and relinking an event only changes the
// competition once the import succeeded. Eventor is always mocked.
import { test, expect } from '@playwright/test';
import { BASE } from './helpers/seed.ts';
import { ENTRYLIST_FIXTURE, COURSE_FIXTURE } from './helpers/wizard.ts';
import { createEmptyCompetition, mockEventorEvents, EVENT } from './helpers/import.ts';

test('an entry list upload ends with Klar and the list shows the names', async ({
  page,
  request,
}) => {
  const id = await createEmptyCompetition(request, true);
  await page.goto(`/competition/${id}/runners?import=1`);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByTestId('import-upload-input').setInputFiles(ENTRYLIST_FIXTURE);
  await expect(page.getByTestId('import-result')).toContainText(
    'Klart: 3 löpare importerade och sparade.'
  );
  await page.getByRole('button', { name: 'Klar – visa anmälda' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Andersson')).toBeVisible();
  await expect(page.getByText('Carlsson')).toBeVisible();
});

test('a course file still works in the same sheet', async ({ page, request }) => {
  const id = await createEmptyCompetition(request);
  await page.goto(`/competition/${id}/runners?import=1`);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByTestId('import-upload-input').setInputFiles(COURSE_FIXTURE);
  await expect(page.getByTestId('import-course-result')).toContainText(
    /Banfilen är inläst: \d+ banor\./
  );
  await page.getByRole('button', { name: 'Klar – visa anmälda' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('relink changes the linked event only after a successful import', async ({
  page,
  request,
}) => {
  const id = await createEmptyCompetition(request);
  const linked = 1111;
  const patched = await request.patch(`${BASE}/api/competitions/${id}`, {
    data: { eventor_event_id: linked },
  });
  expect(patched.ok()).toBe(true);
  await mockEventorEvents(page);
  await page.route(`**/api/eventor/events/${linked}`, (r) =>
    r.fulfill({
      json: {
        eventId: linked,
        name: 'Länkad tävling',
        startDate: '2026-10-09',
        organisation: null,
      },
    })
  );
  await page.route('**/eventor-import**', (r) =>
    r.fulfill({ status: 503, json: { error: 'no_key' } })
  );
  await page.goto(`/competition/${id}/runners?import=1`);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByTestId('linked-relink-btn').click();
  await page.getByTestId('import-search').click();
  await expect(page.getByTestId('import-event-row')).toContainText(EVENT.name);
  await page.getByTestId('import-event-btn').click();
  await expect(page.getByTestId('import-relink-error')).toBeVisible();
  const comp = await request.get(`${BASE}/api/competitions/${id}`);
  const body = (await comp.json()) as { competition?: { eventor_event_id: number | null } };
  expect(
    (body.competition ?? (body as never as { eventor_event_id: number })).eventor_event_id
  ).toBe(linked);
  await page.getByRole('button', { name: 'Välj annan tävling' }).click();
  await expect(page.getByTestId('import-relink-error')).toHaveCount(0);
  await expect(page.getByTestId('import-event-list')).toBeVisible();
});

test('a failed link save after a good import is not reported as a failed import', async ({
  page,
  request,
}) => {
  const id = await createEmptyCompetition(request);
  await request.patch(`${BASE}/api/competitions/${id}`, { data: { eventor_event_id: 1111 } });
  await mockEventorEvents(page);
  await page.route('**/api/eventor/events/1111', (r) =>
    r.fulfill({
      json: { eventId: 1111, name: 'Länkad tävling', startDate: '2026-10-09', organisation: null },
    })
  );
  await page.route('**/eventor-import**', (r) =>
    r.fulfill({
      status: 201,
      json: {
        kind: 'EntryList',
        competitors_created: 2,
        competitors_skipped_duplicate: 0,
        classes_missing: [],
        auto_bound: [],
      },
    })
  );
  await page.route(`**/api/competitions/${id}`, (r) =>
    r.request().method() === 'PATCH'
      ? r.fulfill({ status: 500, json: { error: 'boom' } })
      : r.fallback()
  );
  await page.goto(`/competition/${id}/runners?import=1`);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByTestId('linked-relink-btn').click();
  await page.getByTestId('import-search').click();
  await page.getByTestId('import-event-btn').click();
  await expect(page.getByTestId('import-result')).toBeVisible();
  await expect(page.getByTestId('import-relink-error')).toContainText(
    'Löparna är importerade, men kopplingen till Eventor-tävlingen kunde inte sparas.'
  );
  await expect(page.getByText('Importen misslyckades')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Klar – visa anmälda' })).toBeVisible();
});

test('retrying a failed link save does not import the runners again', async ({ page, request }) => {
  const id = await createEmptyCompetition(request);
  await request.patch(`${BASE}/api/competitions/${id}`, { data: { eventor_event_id: 1111 } });
  await mockEventorEvents(page);
  await page.route('**/api/eventor/events/1111', (r) =>
    r.fulfill({
      json: { eventId: 1111, name: 'Länkad tävling', startDate: '2026-10-09', organisation: null },
    })
  );
  let imports = 0;
  await page.route('**/eventor-import**', (r) => {
    imports += 1;
    return r.fulfill({
      status: 201,
      json: {
        kind: 'EntryList',
        competitors_created: 2,
        competitors_skipped_duplicate: 0,
        classes_missing: [],
        auto_bound: [],
      },
    });
  });
  let patches = 0;
  await page.route(`**/api/competitions/${id}`, (r) => {
    if (r.request().method() !== 'PATCH') return r.fallback();
    patches += 1;
    // The first two saves fail, the third goes to the server.
    return patches <= 2 ? r.fulfill({ status: 500, json: { error: 'boom' } }) : r.continue();
  });
  await page.goto(`/competition/${id}/runners?import=1`);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByTestId('linked-relink-btn').click();
  await expect(page.getByTestId('import-date')).not.toHaveValue('');
  await page.getByTestId('import-search').click();
  await page.getByTestId('import-event-btn').click();
  await expect(page.getByTestId('import-relink-error')).toBeVisible();
  // The way the message invites: pick the same event again.
  await page.getByTestId('import-event-btn').click();
  await expect(async () => expect(patches).toBe(2)).toPass();
  expect(imports).toBe(1);
  await expect(page.getByTestId('import-relink-error')).toBeVisible();
  // The explicit retry.
  await page.getByTestId('import-relink-retry').click();
  await expect(page.getByTestId('linked-event-card')).toContainText(EVENT.name);
  expect(imports).toBe(1);
  expect(patches).toBe(3);
});

test('a failed import of another event does not offer to save the first event link', async ({
  page,
  request,
}) => {
  const id = await createEmptyCompetition(request);
  await request.patch(`${BASE}/api/competitions/${id}`, { data: { eventor_event_id: 1111 } });
  const other = { ...EVENT, eventId: 4243, name: 'Annan tävling' };
  await page.route('**/api/eventor/events?**', (r) =>
    r.fulfill({ json: { events: [EVENT, other] } })
  );
  await page.route('**/api/eventor/events/1111', (r) =>
    r.fulfill({
      json: { eventId: 1111, name: 'Länkad tävling', startDate: '2026-10-09', organisation: null },
    })
  );
  let imports = 0;
  await page.route('**/eventor-import**', (r) => {
    imports += 1;
    return imports === 1
      ? r.fulfill({
          status: 201,
          json: {
            kind: 'EntryList',
            competitors_created: 2,
            competitors_skipped_duplicate: 0,
            classes_missing: [],
            auto_bound: [],
          },
        })
      : r.fulfill({ status: 500, json: { error: 'boom' } });
  });
  await page.route(`**/api/competitions/${id}`, (r) =>
    r.request().method() === 'PATCH'
      ? r.fulfill({ status: 500, json: { error: 'boom' } })
      : r.fallback()
  );
  await page.goto(`/competition/${id}/runners?import=1`);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByTestId('linked-relink-btn').click();
  await page.getByTestId('import-search').click();
  await page.getByTestId('import-event-btn').first().click();
  await expect(page.getByTestId('import-relink-retry')).toBeVisible();
  // A different event whose import fails: the retry would save the first link.
  await page.getByTestId('import-event-btn').nth(1).click();
  await expect(async () => expect(imports).toBe(2)).toPass();
  await expect(page.getByTestId('import-relink-error')).not.toContainText('kopplingen');
  await expect(page.getByTestId('import-relink-retry')).toHaveCount(0);
});
