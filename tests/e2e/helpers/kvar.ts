// tests/e2e/helpers/kvar.ts
// Authored for fartola. Not ported from upstream.
//
// Kvar i skogen needs a reader, so the snapshot POST is mocked with synthetic
// card numbers from the seeded entry list. prepareKvar fetches a table with
// missing runners, an unknown card and an overflow warning, marks one runner
// safe and leaves the page showing every changed part; the asleep and error
// variants then fail a second fetch.
import { expect, type Page } from '@playwright/test';

export const ANNA = 7_501_853;
export const CIA = 1_428_824;
const PATTERN = '**/checkunit/snapshot';

export type Snapshot = {
  cardNumbers: number[];
  returnedCardNumbers: number[];
  overflow: boolean;
  readCount: number;
  // Added by the in-forest list (#109); absent from an older edge.
  sources?: Record<
    string,
    Array<{ kind: 'checkunit' } | { kind: 'radio'; code: number } | { kind: 'read' }>
  >;
  noCheckCardNumbers?: number[];
  outCardNumbers?: number[];
  checkunit?: 'read' | 'stored' | 'unavailable';
  updated?: {
    checkunit_read_at_ms: number | null;
    radio_enabled: boolean;
    radio_last_punch_at_ms: number | null;
    roc_last_success_at: number | null;
  };
};

export function snap(
  cards: number[],
  returned: number[] = [],
  overflow = false,
  extra: Partial<Snapshot> = {}
): Snapshot {
  return {
    cardNumbers: cards,
    returnedCardNumbers: returned,
    overflow,
    readCount: cards.length,
    ...extra,
  };
}

export const UPDATED = {
  checkunit_read_at_ms: Date.UTC(2026, 5, 6, 10, 15),
  radio_enabled: true,
  radio_last_punch_at_ms: Date.UTC(2026, 5, 6, 10, 20),
  roc_last_success_at: null,
};

export async function mockSnapshot(page: Page, body: Snapshot): Promise<void> {
  await page.unroute(PATTERN).catch(() => {});
  await page.route(PATTERN, (route) => route.fulfill({ json: body }));
}

export async function fetchSnapshot(page: Page, body: Snapshot): Promise<void> {
  await mockSnapshot(page, body);
  await page.getByTestId('kvariskov-fetch').click();
  await expect(page.getByTestId('kvariskov-summary')).toBeVisible();
}

export async function prepareKvar(page: Page): Promise<void> {
  // Marks live in sessionStorage: start without any from an earlier visit.
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.getByTestId('kvariskov-view')).toBeVisible();
  await fetchSnapshot(
    page,
    snap([ANNA, CIA, 9_999_001], [], true, {
      sources: {
        [ANNA]: [{ kind: 'checkunit' }],
        [CIA]: [{ kind: 'radio', code: 53 }],
        9999001: [{ kind: 'read' }],
      },
      noCheckCardNumbers: [CIA, 9_999_001],
      outCardNumbers: [ANNA],
      checkunit: 'stored',
      updated: UPDATED,
    })
  );
  await expect(page.getByTestId('kvariskov-row')).toHaveCount(2);
  await expect(page.getByTestId('kvariskov-unknown')).toBeVisible();
  await expect(page.getByTestId('kvariskov-seen').first()).toBeVisible();
  await expect(page.getByTestId('kvariskov-no-check').first()).toBeVisible();
  await expect(page.getByTestId('kvariskov-hand-set').first()).toBeVisible();
  await expect(page.getByTestId('kvariskov-stored')).toBeVisible();
  await expect(page.getByTestId('kvariskov-checkunit-read-at')).toBeVisible();
  await expect(page.getByTestId('kvariskov-radio-last')).toBeVisible();
  await expect(page.getByTestId('kvariskov-overflow')).toBeVisible();
  await page.getByTestId('kvariskov-mark-safe').first().click();
  await expect(page.getByTestId('kvariskov-marked')).toBeVisible();
  await expect(page.getByTestId('kvariskov-summary-text')).toBeVisible();
  await expect(page.getByTestId('kvariskov-fetched-at')).toBeVisible();
  await expect(page.getByTestId('kvariskov-refetch')).toBeVisible();
}

async function failRefetch(page: Page, status: number, json: object, box: string): Promise<void> {
  await prepareKvar(page);
  await page.unroute(PATTERN);
  await page.route(PATTERN, (route) => route.fulfill({ status, json }));
  await page.getByTestId('kvariskov-refetch').click();
  await expect(page.getByTestId(box)).toBeVisible();
}

export const prepareKvarAsleep = (page: Page) =>
  failRefetch(page, 503, { error: 'station_asleep' }, 'kvariskov-asleep');
export const prepareKvarError = (page: Page) =>
  failRefetch(page, 500, { error: 'Serverfel' }, 'kvariskov-error');
