// tests/e2e/helpers/eventor.ts
// Authored for fartola. Not ported from upstream.
//
// Puts /eventor-publish into the states its changed parts show in. The
// push endpoints are always mocked: unmocked they call the real Eventor.
import { expect, type Page } from '@playwright/test';

/** Results pushed, start list refused (502), then results without a key. */
export async function prepareEventor(page: Page): Promise<void> {
  await page.route('**/eventor/push-results', (r) =>
    r.fulfill({ json: { url: 'https://eventor.orientering.se/x' } })
  );
  await page.route('**/eventor/push-startlist', (r) =>
    r.fulfill({ status: 502, json: { error: 'upstream' } })
  );
  const results = page.getByTestId('eventor-publish-results');
  const startlist = page.getByTestId('eventor-publish-startlist');
  await results.getByRole('button').click();
  await expect(page.getByTestId('eventor-results-ok')).toBeVisible();
  await expect(results.getByTestId('eventor-results-last')).toContainText('Senast publicerat');
  await startlist.getByRole('button').click();
  await expect(page.getByTestId('eventor-startlist-err')).toBeVisible();
  await expect(page.getByTestId('eventor-startlist-err').locator('svg')).toBeVisible();
}

/** The no-key message with its link, in place of the results box. */
export async function prepareEventorNoKey(page: Page): Promise<void> {
  await page.route('**/eventor/push-results', (r) =>
    r.fulfill({ status: 400, json: { error: 'no_key' } })
  );
  await page.getByTestId('eventor-publish-results').getByRole('button').click();
  const err = page.getByTestId('eventor-results-err');
  await expect(err).toBeVisible();
  await expect(err.getByRole('link', { name: 'Lägg in Eventor-nyckeln' })).toBeVisible();
}
