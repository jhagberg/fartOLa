// tests/e2e/helpers/hyrbrickor.ts
// Authored for fartola. Not ported from upstream.
//
// Hyrbrickor: the floor/a11y states of the screen. The one list endpoint is
// mocked (synthetic cards); every changed element is asserted visible
// before the caller measures.
import { expect, type Page } from '@playwright/test';

const LIST = /\/api\/competitions\/[^/]+\/hired-cards$/;
const RETURN = /\/api\/competitions\/[^/]+\/hired-cards\/(\d+)\/return$/;

const BASE_ROW = {
  competition_id: '00000000-0000-4000-8000-000000000001',
  returned_at_ms: null,
  contact_email: null,
  note: null,
  fee: null,
};
const ANNA = {
  ...BASE_ROW,
  card_number: 7501853,
  marked_at_ms: Date.UTC(2026, 5, 6, 8, 25),
  contact_name: 'Anna Andersson',
  contact_phone: '0701234567',
  contact_email: 'anna@example.org',
  note: 'Lämnar tillbaka vid målet',
  fee: 30,
};
const CIA = {
  ...BASE_ROW,
  card_number: 1428824,
  marked_at_ms: Date.UTC(2026, 5, 6, 8, 40),
  contact_name: 'Cia Carlsson',
  contact_phone: '0707654321',
};
const BACK = {
  ...BASE_ROW,
  card_number: 88001,
  marked_at_ms: Date.UTC(2026, 5, 6, 7, 55),
  returned_at_ms: Date.UTC(2026, 5, 6, 9, 30),
  contact_name: 'Hyra Hansson',
};

/** Mock the list; `failList` makes GETs fail, `failReturn` the cards whose
 * return fails. Returns the controls. */
async function mockHired(page: Page, opts: { open: object[]; returned: object[] }) {
  const state = {
    failList: false,
    failReturn: new Set<number>(),
    open: opts.open,
    returned: opts.returned,
  };
  await page.route(RETURN, async (route) => {
    const card = Number(RETURN.exec(route.request().url())![1]);
    if (state.failReturn.has(card)) {
      return route.fulfill({ status: 500, json: { error: 'sqlite_busy' } });
    }
    const row = state.open.find((r) => (r as { card_number: number }).card_number === card);
    if (row) {
      state.open = state.open.filter((r) => r !== row);
      state.returned = [{ ...row, returned_at_ms: Date.UTC(2026, 5, 6, 10, 0) }, ...state.returned];
    }
    return route.fulfill({ json: { ok: true, returned_at_ms: Date.UTC(2026, 5, 6, 10, 0) } });
  });
  await page.route(LIST, (route) =>
    state.failList
      ? route.fulfill({ status: 500, json: { error: 'boom' } })
      : route.fulfill({ json: { open: state.open, returned: state.returned } })
  );
  return state;
}

/** Open cards with badge, contact line and a fee, a returned row, the result
 * toast, a row error and the reload error over the cached lists. */
export async function prepareHyrbrickorFull(page: Page): Promise<void> {
  const state = await mockHired(page, { open: [ANNA, CIA], returned: [BACK] });
  state.failReturn.add(CIA.card_number);
  await page.reload();
  const rows = page.getByTestId('hyrbrickor-open-row');
  await expect(rows).toHaveCount(2, { timeout: 20_000 });
  // The toast leaves after 3 s: stretch that one timer so it stays to measure.
  await page.evaluate(() => {
    const orig = window.setTimeout.bind(window);
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...a: unknown[]) =>
      orig(fn, ms === 3000 ? 600_000 : ms, ...a)) as typeof window.setTimeout;
  });
  await rows.filter({ hasText: '1428824' }).getByTestId('hyrbrickor-row-return').click();
  await expect(
    rows.filter({ hasText: '1428824' }).getByTestId('hyrbrickor-row-error')
  ).toBeVisible();
  state.failList = true;
  await rows.filter({ hasText: '7501853' }).getByTestId('hyrbrickor-row-return').click();
  await expect(page.getByTestId('hyrbrickor-toast')).toHaveText('Bricka 7501853 återlämnad');
  await expect(page.getByTestId('hyrbrickor-reload-error')).toContainText(
    'Kunde inte uppdatera listan. Visar senast hämtade.'
  );
  await expect(page.getByTestId('hyrbrickor-returned-row')).toHaveCount(2);
  await expect(rows).toHaveCount(1);
  await expect(page.locator('.badge').first()).toBeVisible();
  await expect(rows.getByTestId('hyrbrickor-row-name')).toBeVisible();
  await expect(rows.getByTestId('hyrbrickor-row-phone')).toBeVisible();
}

/** An open card, its badge and its contact line, before anything changes. */
export async function prepareHyrbrickorOpen(page: Page): Promise<void> {
  await mockHired(page, { open: [ANNA, CIA], returned: [BACK] });
  await page.reload();
  const row = page.getByTestId('hyrbrickor-open-row').first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.badge').first()).toBeVisible();
  await expect(row.getByTestId('hyrbrickor-row-name')).toBeVisible();
  await expect(row.getByTestId('hyrbrickor-row-phone')).toBeVisible();
  await expect(page.getByTestId('hyrbrickor-returned-row')).toBeVisible();
}

/** The first load failed: one message with its retry, no lists. */
export async function prepareHyrbrickorLoadError(page: Page): Promise<void> {
  const state = await mockHired(page, { open: [], returned: [] });
  state.failList = true;
  await page.reload();
  const alert = page.getByTestId('hyrbrickor-error').getByRole('alert');
  await expect(alert).toContainText('Kunde inte hämta hyrbrickor.');
  await expect(alert.getByRole('button', { name: 'Försök igen' })).toBeVisible();
}

/** No cards at all: the empty state. */
export async function prepareHyrbrickorEmpty(page: Page): Promise<void> {
  await mockHired(page, { open: [], returned: [] });
  await page.reload();
  await expect(page.getByTestId('hyrbrickor-empty')).toContainText('Inga hyrbrickor ute just nu.', {
    timeout: 20_000,
  });
}
