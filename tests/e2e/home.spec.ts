// tests/e2e/home.spec.ts
// Authored for fartola. Not ported from upstream.
//
// Tävlingar (home): the status pill comes from the competition's date and
// race start, cards are links, a failed load offers a retry, and an empty
// list has exactly one create button. The shared e2e DB holds competitions
// from other specs, so every assertion is scoped to the cards made here.
import { test, expect, type APIRequestContext } from '@playwright/test';
import { BASE } from './helpers/seed.ts';
import { dayOffset } from './helpers/home.ts';

async function create(
  request: APIRequestContext,
  name: string,
  date: string,
  start = false
): Promise<string> {
  const res = await request.post(`${BASE}/api/competitions`, { data: { name, date } });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  if (start) {
    const s = await request.post(`${BASE}/api/competitions/${id}/start-race`);
    expect([200, 201]).toContain(s.status());
  }
  return id;
}

test('status pills follow the date and the race start', async ({ page, request }) => {
  const tag = Date.now();
  await create(request, `Hemma pågår ${tag}`, dayOffset(0), true);
  await create(request, `Hemma idag ${tag}`, dayOffset(0));
  await create(request, `Hemma igår ${tag}`, dayOffset(-1));
  await create(request, `Hemma imorgon ${tag}`, dayOffset(1));
  await page.goto('/');
  const card = (n: string) => page.getByRole('link', { name: new RegExp(`Hemma ${n} ${tag}`) });
  await expect(card('pågår')).toContainText('Pågår');
  await expect(card('idag')).toContainText('I dag');
  await expect(card('igår')).toContainText('Avslutad');
  await expect(card('imorgon')).toContainText('Kommande');
  await expect(card('idag')).not.toContainText('Pågår');
  await expect(page.getByTestId('comp-grid')).not.toContainText(/startande|i mål/i);
});

test('a card is a link to the readout', async ({ page, request }) => {
  const name = `Designlabb hem ${Date.now()}`;
  const id = await create(request, name, dayOffset(0));
  await page.goto('/');
  const link = page.getByRole('link', { name: new RegExp(name) });
  await expect(link).toHaveAttribute('href', `/competition/${id}/readout`);
  await link.click();
  // First visit: Vite compiles the readout route before the URL changes.
  await expect(page).toHaveURL(new RegExp(`/competition/${id}/readout`), { timeout: 20_000 });
});

test('a failed load says so and retry lists the competitions', async ({ page, request }) => {
  const name = `Designlabb retry ${Date.now()}`;
  await create(request, name, dayOffset(0));
  let failed = false;
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/api/competitions', async (route) => {
    if (!failed && route.request().method() === 'GET') {
      failed = true;
      return route.fulfill({ status: 503, json: { error: 'down' } });
    }
    // Hold the retry so the screen can be checked while it waits.
    await held;
    return route.continue();
  });
  await page.goto('/');
  await expect(page.getByText('Kunde inte hämta tävlingar.')).toBeVisible();
  await page.getByRole('button', { name: 'Försök igen' }).click();
  await expect(page.getByText('Kunde inte hämta tävlingar.')).toBeHidden();
  await expect(page.getByTestId('home-empty')).toHaveCount(0);
  release();
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
  await expect(page.getByText('Kunde inte hämta tävlingar.')).toBeHidden();
});

test('an empty list shows exactly one create button', async ({ page }) => {
  await page.route('**/api/competitions', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { competitions: [] } })
      : route.continue()
  );
  await page.goto('/');
  await expect(page.getByTestId('home-empty')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ny tävling' })).toHaveCount(1);
});
