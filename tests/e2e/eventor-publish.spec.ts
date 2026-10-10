// tests/e2e/eventor-publish.spec.ts
// Authored for fartola. Not ported from upstream.
//
// The Eventor publish page: it remembers the last publish across a reload,
// and an error is marked with an icon and a word, not colour alone.
// Push endpoints are mocked: unmocked they call the real Eventor.
import { test, expect } from '@playwright/test';
import { seedCompetition } from './helpers/seed.ts';

test('last published survives a reload', async ({ page, request }) => {
  const { competitionId: id } = await seedCompetition(request, { controls: 3 });
  await page.route('**/eventor/push-results', (r) =>
    r.fulfill({ json: { url: 'https://eventor.orientering.se/x' } })
  );
  await page.goto(`/competition/${id}/eventor-publish`);
  const results = page.getByTestId('eventor-publish-results');
  await expect(results.getByText(/Senast publicerat/)).toHaveCount(0);
  await results.getByRole('button').click();
  await expect(results.getByText(/^Senast publicerat \d\d:\d\d$/)).toBeVisible();
  await page.reload();
  await expect(results.getByText(/^Senast publicerat \d\d:\d\d$/)).toBeVisible();
  // The start list was never published.
  await expect(
    page.getByTestId('eventor-publish-startlist').getByText(/Senast publicerat/)
  ).toHaveCount(0);
});

test('a failed publish shows an alert icon and the word Fel', async ({ page, request }) => {
  const { competitionId: id } = await seedCompetition(request, { controls: 3 });
  await page.route('**/eventor/push-results', (r) =>
    r.fulfill({ status: 502, json: { error: 'upstream' } })
  );
  await page.goto(`/competition/${id}/eventor-publish`);
  await page.getByTestId('eventor-publish-results').getByRole('button').click();
  const err = page.getByTestId('eventor-results-err');
  await expect(err).toBeVisible();
  await expect(err.locator('svg')).toBeVisible();
  await expect(err).toContainText('Fel:');
});

test('sections have their own headings and the wording is plain', async ({ page, request }) => {
  const { competitionId: id } = await seedCompetition(request, { controls: 3 });
  await page.goto(`/competition/${id}/eventor-publish`);
  await expect(
    page.getByRole('heading', { level: 2, name: 'Resultat', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Startlista', exact: true })
  ).toBeVisible();
  await expect(page.getByText('Skickar startlistan till Eventor.')).toBeVisible();
  await expect(page.getByText(/IOF XML/)).toHaveCount(0);
});
