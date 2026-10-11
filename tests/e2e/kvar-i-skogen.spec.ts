// tests/e2e/kvar-i-skogen.spec.ts
// Authored for fartola. Not ported from upstream.
//
// Safety: the screen must only say everyone is back when every started card
// was physically read at the finish. A manual mark is not a return.
import { test, expect } from '@playwright/test';
import { seedCompetition } from './helpers/seed.ts';
import { ANNA, CIA, UPDATED, fetchSnapshot, snap } from './helpers/kvar.ts';

test.describe.configure({ mode: 'serial' });

let id = '';
test.beforeAll(async ({ request }) => {
  id = (await seedCompetition(request, { controls: 8 })).competitionId;
});

test.beforeEach(async ({ page }) => {
  await page.goto(`/competition/${id}/kvar-i-skogen`);
  await expect(page.getByTestId('kvariskov-view')).toBeVisible();
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.getByTestId('kvariskov-view')).toBeVisible();
});

const view = (p: import('@playwright/test').Page) => p.getByTestId('kvariskov-view');

test('empty check unit is not "all back"', async ({ page }) => {
  await fetchSnapshot(page, snap([]));
  await expect(view(page)).toContainText('Inga stämplingar lästes från dosan.');
  await expect(view(page)).not.toContainText('Alla löpare har återkommit');
  await expect(page.locator('.count-badge')).toHaveCount(0);
});

test('all back', async ({ page }) => {
  await fetchSnapshot(page, snap([ANNA], [ANNA]));
  await expect(view(page)).toContainText('Alla löpare har återkommit.');
});

test('marked safe stays visible', async ({ page }) => {
  await fetchSnapshot(page, snap([ANNA, CIA]));
  await expect(page.getByTestId('kvariskov-row')).toHaveCount(2);
  await page
    .getByTestId('kvariskov-row')
    .filter({ hasText: 'Anna Andersson' })
    .getByTestId('kvariskov-mark-safe')
    .click();
  const marked = page.getByTestId('kvariskov-marked');
  await expect(marked).toContainText('Markerade som säkra (1)');
  await expect(marked).toContainText('Anna Andersson');
  await expect(marked).toContainText('Markerad på den här datorn');
  await expect(page.getByTestId('kvariskov-row')).toHaveCount(1);
  await expect(page.getByTestId('kvariskov-summary')).toContainText(
    '1 löpare saknas, 0 är tillbaka.'
  );
});

test('marked is not returned', async ({ page }) => {
  await fetchSnapshot(page, snap([ANNA]));
  await page.getByTestId('kvariskov-mark-safe').click();
  await expect(view(page)).toContainText(
    'Ingen saknas: 0 har kommit tillbaka och 1 är markerade som säkra.'
  );
  await expect(view(page)).not.toContainText('Alla löpare har återkommit');
});

test('fetch time and fetch again', async ({ page }) => {
  await fetchSnapshot(page, snap([ANNA, CIA]));
  await expect(page.getByTestId('kvariskov-fetched-at')).toHaveText(/^Hämtad \d\d:\d\d$/);
  await expect(page.getByTestId('kvariskov-refetch')).toHaveText('Hämta igen');
});

test('wrapped memory is never all clear', async ({ page }) => {
  await fetchSnapshot(page, snap([ANNA], [ANNA], true));
  await expect(view(page)).not.toContainText('Alla löpare har återkommit');
  await expect(view(page)).not.toContainText('Ingen saknas:');
  await expect(page.locator('.count-badge')).toHaveCount(0);
  await expect(view(page)).toContainText(
    'Ingen saknas bland de lästa brickorna, men minnet har runnit runt. Kontrollera startlistan för tidiga starter.'
  );
});

test('a failed refetch removes the all-back box', async ({ page }) => {
  await fetchSnapshot(page, snap([ANNA], [ANNA]));
  await expect(view(page)).toContainText('Alla löpare har återkommit.');
  await page.unroute('**/checkunit/snapshot');
  await page.route('**/checkunit/snapshot', (route) =>
    route.fulfill({ status: 500, json: { error: 'Serverfel' } })
  );
  await page.getByTestId('kvariskov-refetch').click();
  await expect(page.getByTestId('kvariskov-error')).toBeVisible();
  await expect(view(page)).not.toContainText('Alla löpare har återkommit');
  await expect(page.getByTestId('kvariskov-fetched-at')).toBeVisible();
});

test('a retry after a failed refetch shows no all-clear until it succeeds', async ({ page }) => {
  await fetchSnapshot(page, snap([ANNA], [ANNA]));
  await expect(page.getByTestId('kvariskov-all-returned')).toBeVisible();
  await page.unroute('**/checkunit/snapshot');
  await page.route('**/checkunit/snapshot', (route) =>
    route.fulfill({ status: 500, json: { error: 'Serverfel' } })
  );
  await page.getByTestId('kvariskov-refetch').click();
  await expect(page.getByTestId('kvariskov-error')).toBeVisible();
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.unroute('**/checkunit/snapshot');
  await page.route('**/checkunit/snapshot', async (route) => {
    await held;
    await route.fulfill({ json: snap([ANNA], [ANNA]) });
  });
  await page.getByTestId('kvariskov-refetch').click();
  await expect(page.getByTestId('kvariskov-refetch')).toBeDisabled();
  await expect(page.getByTestId('kvariskov-all-returned')).toHaveCount(0);
  await expect(view(page)).not.toContainText('Alla löpare har återkommit');
  release();
  await expect(page.getByTestId('kvariskov-all-returned')).toBeVisible();
  await expect(page.getByTestId('kvariskov-error')).toHaveCount(0);
});

test('the old count and summary are hidden after a failed or pending refetch', async ({ page }) => {
  await fetchSnapshot(page, snap([ANNA], [ANNA]));
  const badge = page.locator('.count-badge');
  const text = page.getByTestId('kvariskov-summary-text');
  await expect(badge).toBeVisible();
  await expect(text).toContainText('0 löpare saknas');
  await page.unroute('**/checkunit/snapshot');
  await page.route('**/checkunit/snapshot', (route) =>
    route.fulfill({ status: 500, json: { error: 'Serverfel' } })
  );
  await page.getByTestId('kvariskov-refetch').click();
  await expect(page.getByTestId('kvariskov-error')).toBeVisible();
  await expect(badge).toHaveCount(0);
  await expect(text).toHaveCount(0);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.unroute('**/checkunit/snapshot');
  await page.route('**/checkunit/snapshot', async (route) => {
    await held;
    await route.fulfill({ json: snap([ANNA], [ANNA]) });
  });
  await page.getByTestId('kvariskov-refetch').click();
  await expect(page.getByTestId('kvariskov-refetch')).toBeDisabled();
  await expect(badge).toHaveCount(0);
  await expect(text).toHaveCount(0);
  release();
  await expect(badge).toBeVisible();
  await expect(text).toContainText('0 löpare saknas');
});

test('an unknown card is listed and blocks all back', async ({ page }) => {
  await fetchSnapshot(page, snap([ANNA, 9_999_001], [ANNA]));
  await expect(page.getByTestId('kvariskov-unknown')).toContainText('Okända brickor');
  await expect(page.getByTestId('kvariskov-unknown')).toContainText('#9999001');
  await expect(view(page)).not.toContainText('Alla löpare har återkommit');
});

const row = (p: import('@playwright/test').Page, name: string) =>
  p.getByTestId('kvariskov-row').filter({ hasText: name });

test('each missing runner shows where it was seen', async ({ page }) => {
  await fetchSnapshot(
    page,
    snap([ANNA, CIA], [], false, {
      sources: { [ANNA]: [{ kind: 'checkunit' }], [CIA]: [{ kind: 'radio', code: 53 }] },
      checkunit: 'read',
    })
  );
  await expect(row(page, 'Anna Andersson')).toContainText('Dosa');
  await expect(row(page, 'Cia Carlsson')).toContainText('Radio K53');
});

test('a card read at the start is shown as such, also when unknown', async ({ page }) => {
  await fetchSnapshot(
    page,
    snap([ANNA, 9_999_001], [], false, {
      sources: { [ANNA]: [{ kind: 'read' }], 9999001: [{ kind: 'radio', code: 40 }] },
    })
  );
  await expect(row(page, 'Anna Andersson')).toContainText('Avläst start');
  await expect(page.getByTestId('kvariskov-unknown')).toContainText('Radio K40');
});

test('no check punch is shown with a word', async ({ page }) => {
  await fetchSnapshot(
    page,
    snap([ANNA, CIA], [], false, {
      sources: { [ANNA]: [{ kind: 'radio', code: 53 }], [CIA]: [{ kind: 'checkunit' }] },
      noCheckCardNumbers: [ANNA],
    })
  );
  await expect(row(page, 'Anna Andersson')).toContainText('Ingen checkstämpling');
  await expect(row(page, 'Cia Carlsson')).not.toContainText('Ingen checkstämpling');
});

test('a hand-set status is not a return', async ({ page }) => {
  await fetchSnapshot(page, snap([ANNA], [], false, { outCardNumbers: [ANNA] }));
  await expect(row(page, 'Anna Andersson')).toContainText('Handsatt status');
  await expect(page.getByTestId('kvariskov-mark-safe')).toBeVisible();
  await expect(view(page)).not.toContainText('Alla löpare har återkommit');
});

test('a stored check-unit read is never all clear', async ({ page }) => {
  await fetchSnapshot(page, snap([ANNA], [ANNA], false, { checkunit: 'stored', updated: UPDATED }));
  await expect(view(page)).not.toContainText('Alla löpare har återkommit');
  await expect(page.getByTestId('kvariskov-all-returned')).toHaveCount(0);
  await expect(page.getByTestId('kvariskov-stored-none-missing')).toContainText(
    'Ingen saknas enligt dosan från'
  );
  await expect(page.getByTestId('kvariskov-stored-none-missing')).toContainText(
    'Läs dosan igen för att vara säker.'
  );
  await expect(page.getByTestId('kvariskov-stored')).toContainText('(sparad avläsning)');
  await expect(page.locator('.count-badge')).toHaveCount(0);
  await expect(page.getByTestId('kvariskov-summary-text')).toHaveCount(0);
});

test('an unavailable check unit warns and is never all clear', async ({ page }) => {
  await fetchSnapshot(
    page,
    snap([ANNA], [ANNA], false, {
      checkunit: 'unavailable',
      updated: { ...UPDATED, checkunit_read_at_ms: null },
    })
  );
  await expect(page.getByTestId('kvariskov-unavailable')).toContainText(
    'Dosan är inte avläst. Listan bygger på radio och avläsningar.'
  );
  await expect(view(page)).not.toContainText('Alla löpare har återkommit');
  await expect(page.getByTestId('kvariskov-none-missing')).toHaveCount(0);
  await expect(page.getByTestId('kvariskov-stored-none-missing')).toHaveCount(0);
  await expect(page.locator('.count-badge')).toHaveCount(0);
  await expect(page.getByTestId('kvariskov-summary-text')).toHaveCount(0);
});

test('shows when the check unit was read and the last radio punch', async ({ page }) => {
  await fetchSnapshot(page, snap([ANNA], [], false, { checkunit: 'read', updated: UPDATED }));
  await expect(page.getByTestId('kvariskov-checkunit-read-at')).toHaveText(
    /^Dosan avläst \d\d:\d\d$/
  );
  await expect(page.getByTestId('kvariskov-radio-last')).toHaveText(
    /^Senaste radiostämpling \d\d:\d\d$/
  );
});

test('no radio punch yet', async ({ page }) => {
  await fetchSnapshot(
    page,
    snap([ANNA], [], false, {
      checkunit: 'read',
      updated: { ...UPDATED, radio_last_punch_at_ms: null },
    })
  );
  await expect(page.getByTestId('kvariskov-radio-last')).toHaveText(
    'Senaste radiostämpling ingen än'
  );
});

test('radio off: no radio line', async ({ page }) => {
  await fetchSnapshot(
    page,
    snap([ANNA], [], false, { checkunit: 'read', updated: { ...UPDATED, radio_enabled: false } })
  );
  await expect(page.getByTestId('kvariskov-checkunit-read-at')).toBeVisible();
  await expect(page.getByTestId('kvariskov-radio-last')).toHaveCount(0);
});

test('a runner with a hand-set status seen by radio is still missing (real edge shape)', async ({
  page,
}) => {
  await fetchSnapshot(
    page,
    snap([ANNA, CIA], [ANNA], false, {
      sources: { [ANNA]: [{ kind: 'checkunit' }], [CIA]: [{ kind: 'radio', code: 53 }] },
      outCardNumbers: [CIA],
      checkunit: 'read',
    })
  );
  await expect(row(page, 'Cia Carlsson')).toContainText('Handsatt status');
  await expect(row(page, 'Cia Carlsson')).toContainText('Radio K53');
  await expect(view(page)).not.toContainText('Alla löpare har återkommit');
});

test('a check-unit card without a sources entry is labelled Dosa', async ({ page }) => {
  await fetchSnapshot(page, snap([ANNA], [], false, { sources: {}, checkunit: 'read' }));
  await expect(row(page, 'Anna Andersson')).toContainText('Dosa');
});

test('a stored read with an empty list does not show the empty-read hint', async ({ page }) => {
  await fetchSnapshot(page, snap([], [], false, { checkunit: 'stored', updated: UPDATED }));
  await expect(view(page)).not.toContainText('Inga stämplingar lästes från dosan');
  await expect(view(page)).not.toContainText('Alla löpare har återkommit');
});
