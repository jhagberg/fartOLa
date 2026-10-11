// tests/e2e/helpers/missing-starts.ts
// Authored for fartola. Not ported from upstream.
//
// The missing-starts panel on the results page, with synthetic runners
// (the seeded entry list has no read without a start). Mocks go in before
// the page loads.
import { expect, type Page } from '@playwright/test';

const PATTERN = '**/api/competitions/*/missing-starts';
const APPLY = '**/api/competitions/*/missing-starts/apply';
const T = (h: number, m: number, s = 0) => Date.UTC(2026, 9, 9, h, m, s);

const ITEMS = [
  ['a', 'Anna Andersson', 'H21'],
  ['c', 'Cia Carlsson', 'D21'],
].map(([id, name, cls]) => ({
  competitor_id: id,
  name,
  club: null,
  class_id: `cls-${cls}`,
  class_name: cls,
  card_number: null,
  status: 'OK',
  check_ms: T(9, 55),
  suggested_start_ms: T(9, 57),
  finish_ms: T(10, 20),
}));

const listBody = (items: typeof ITEMS) => ({
  n: 12,
  median_ms: 114_000,
  mean_ms: 127_000,
  offset_ms: 114_000,
  clock_offset_min: 0,
  items,
});

/**
 * The panel with two runners; after Sätt alla the list is empty. With `hold`,
 * the apply request waits until the returned function is called.
 */
export async function mockMissingStarts(page: Page, hold = false): Promise<() => void> {
  let applied = false;
  let release!: () => void;
  const gate = hold ? new Promise<void>((r) => (release = r)) : Promise.resolve();
  await page.route(PATTERN, (route) => route.fulfill({ json: listBody(applied ? [] : ITEMS) }));
  await page.route(APPLY, async (route) => {
    await gate;
    applied = true;
    await route.fulfill({ status: 201, json: { updated: 2 } });
  });
  return () => release?.();
}

/** Every load fails until the returned function is called, then the list loads. */
export async function mockMissingStartsLoadError(page: Page): Promise<() => void> {
  let failing = true;
  await page.route(PATTERN, (route) =>
    failing
      ? route.fulfill({ status: 500, json: { error: 'boom' } })
      : route.fulfill({ json: listBody(ITEMS) })
  );
  return () => {
    failing = false;
  };
}

/** Floor/a11y state: the table and the stats, after a reload that sees the mock. */
export async function prepareMissingStarts(page: Page): Promise<void> {
  await mockMissingStarts(page);
  await page.reload();
  await expect(page.getByTestId('missing-start-row')).toHaveCount(2);
  await expect(page.getByTestId('missing-starts-stats')).toBeVisible();
  await expect(page.getByTestId('missing-starts-set-all')).toBeVisible();
}

/** Floor/a11y state: the failed first load with its retry. */
export async function prepareMissingStartsError(page: Page): Promise<void> {
  await mockMissingStartsLoadError(page);
  await page.reload();
  await expect(page.getByTestId('missing-starts-error')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Försök igen' })).toBeVisible();
}
