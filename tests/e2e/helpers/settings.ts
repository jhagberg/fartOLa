// tests/e2e/helpers/settings.ts
// Authored for fartola. Not ported from upstream.
//
// Puts /installningar into the states its changed parts show in: group
// headings, the Liveresultat result text, a helper-code error, a revealed
// helper code with its hint, and the MeOS "Sparat". All endpoints mocked.
import { expect, type Page } from '@playwright/test';

/** Other specs run in parallel and change the shared active competition:
 * make this page see `id` as the active one. */
export async function pinActive(page: Page, id: string): Promise<void> {
  await page.route('**/api/sessions/active-competition', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: { competition_id: id } }) : r.continue()
  );
}

export async function prepareSettings(page: Page, id: string): Promise<void> {
  // Every mock goes in before the reload, so no real first answer can land
  // after the fields below are filled.
  await pinActive(page, id);
  await page.route(`**/api/competitions/${id}/liveresultat/credentials`, (r) =>
    r.fulfill({
      json:
        r.request().method() === 'PATCH'
          ? { liveresultat_id: '123', has_password: true }
          : { liveresultat_id: null, has_password: false },
    })
  );
  let generated = 0;
  await page.route(`**/api/competitions/${id}/event-codes`, (r) => {
    if (r.request().method() === 'GET')
      return r.fulfill({
        json: {
          codes: [
            {
              id: 'c1',
              masked_code: 'sän****27',
              expires_at_ms: Date.now() + 86_400_000,
              revoked_at_ms: null,
            },
            {
              id: 'c2',
              masked_code: 'abc****11',
              expires_at_ms: Date.now() + 86_400_000,
              revoked_at_ms: Date.now(),
            },
          ],
        },
      });
    generated += 1;
    // The first try fails, the second gives a code.
    if (generated === 1) return r.fulfill({ status: 500, json: { error: 'x' } });
    return r.fulfill({
      json: { id: 'c1', code: 'sändebud-27', expires_at_ms: Date.now() + 86_400_000 },
    });
  });
  await page.route('**/api/settings/meos', (r) =>
    r.fulfill({ json: { has_meos_password: true, meos_allow_without_password: false } })
  );
  const liveLoaded = page.waitForResponse(
    (r) => r.url().includes('/liveresultat/credentials') && r.request().method() === 'GET'
  );
  await page.reload();
  await expect(page.getByTestId('appearance-section')).toBeVisible();
  const heads = page.getByTestId('settings-view').getByRole('heading', { level: 2 });
  await expect(heads).toHaveCount(2);
  await expect(heads.first()).toContainText('Den här tävlingen:');
  await expect(heads.nth(1)).toHaveText('Alla tävlingar på den här datorn');

  // Wait for each card's first load before editing it.
  await liveLoaded;
  await expect(page.locator('#hjalpkoder').getByTestId('helper-code-row')).toHaveCount(2);
  await expect(page.locator('#meos').getByTestId('meos-password-input')).toBeVisible();

  const live = page.locator('#liveresultat');
  await live.getByTestId('liveresultat-id').fill('123');
  await live.getByTestId('liveresultat-password').fill('hemligt');
  await live.getByTestId('liveresultat-save').click();
  await expect(live.getByRole('status')).toHaveText('Liveresultat är påslaget.');

  const codes = page.locator('#hjalpkoder');
  await codes.getByTestId('helper-codes-generate').click();
  await expect(codes.getByRole('alert')).toHaveText('Kunde inte skapa en kod.');
  await codes.getByTestId('helper-codes-generate').click();
  await expect(codes.getByTestId('helper-code-revealed')).toBeVisible();
  await expect(codes).toContainText('Koden visas i 30 sekunder.');
  await expect(codes.locator('.code-row.revoked')).toBeVisible();

  const meos = page.locator('#meos');
  await meos.getByTestId('meos-password-input').fill('abc');
  await meos.getByTestId('meos-password-save').click();
  await expect(meos.getByTestId('meos-settings-toast')).toBeVisible();
}
