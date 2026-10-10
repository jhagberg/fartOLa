// tests/e2e/helpers/home.ts
// Authored for fartola. Not ported from upstream.
//
// Prepared states for the Tävlingar screen: cards with every status pill
// and an Eventor chip, and the load error with its retry button.
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { BASE } from './seed.ts';

function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** One competition per status; the today one is linked to an Eventor event. */
export async function seedHomeStatuses(request: APIRequestContext): Promise<void> {
  for (const [days, start] of [
    [0, true],
    [0, false],
    [-1, false],
    [1, false],
  ] as const) {
    const res = await request.post(`${BASE}/api/competitions`, {
      data: {
        name: `Designlabb status ${Date.now()}`,
        date: dayOffset(days),
        ...(days === 0 && start ? { eventor_event_id: 12345 } : {}),
      },
    });
    expect(res.status()).toBe(201);
    if (start) {
      const { id } = (await res.json()) as { id: string };
      const s = await request.post(`${BASE}/api/competitions/${id}/start-race`);
      expect([200, 201]).toContain(s.status());
    }
  }
}

export async function prepareHome(page: Page, request: APIRequestContext): Promise<void> {
  await seedHomeStatuses(request);
  // The shared DB holds thousands of cards; keep the seeded ones so axe and
  // the floor measurement stay fast.
  await page.route('**/api/competitions', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const { competitions } = (await res.json()) as { competitions: Array<{ name: string }> };
    await route.fulfill({
      json: { competitions: competitions.filter((c) => c.name.startsWith('Designlabb status')) },
    });
  });
  await page.reload();
  const cards = page.getByTestId('competition-card');
  await expect(cards.first()).toBeVisible();
  await expect(cards.first().locator('.pill')).toBeVisible();
  await expect(page.getByTestId('eventor-chip').first()).toBeVisible();
}

export async function prepareHomeError(page: Page): Promise<void> {
  await page.route('**/api/competitions', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 503, json: { error: 'down' } })
      : route.continue()
  );
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Kunde inte hämta tävlingar.');
  await expect(page.getByRole('button', { name: 'Försök igen' })).toBeVisible();
}
