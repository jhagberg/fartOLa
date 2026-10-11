// Authored for fartola. Not ported from upstream.
//
// Tävlingsinfo has one save model (ADR-0016 rule 3): every field saves on
// change and says "Sparat" or the error at the field. Max time keeps an
// explicit Spara, because it locks at the first start (SOFT TR 4.21.2).
// Quick edits are queued per card / row, so none is lost.

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { BASE } from './helpers/seed.ts';
import { openInfo } from './helpers/info.ts';

async function competition(request: APIRequestContext, id: string) {
  const res = await request.get(`${BASE}/api/competitions/${id}`);
  return ((await res.json()) as { competition: Record<string, unknown> }).competition;
}

async function classId(request: APIRequestContext, id: string, name: string): Promise<string> {
  const res = await request.get(`${BASE}/api/competitions/${id}/classes`);
  const { classes } = (await res.json()) as { classes: Array<{ id: string; name: string }> };
  return classes.find((c) => c.name === name)!.id;
}

/** Hold the first matching request until `release` is called. */
function gate(): { wait: Promise<void>; release: () => void } {
  let release!: () => void;
  const wait = new Promise<void>((r) => (release = r));
  return { wait, release };
}

const kindRow = (page: Page, cls: string) =>
  page.locator(`[data-testid=class-kind-row][data-class-id="${cls}"]`);
const feeRow = (page: Page, cls: string) =>
  page.locator(`[data-testid=fees-row][data-class-id="${cls}"]`);

test.describe('details card', () => {
  test('a select saves on change and says Sparat next to it; the card has no Spara', async ({
    page,
    request,
  }) => {
    const id = await openInfo(page, request);
    await expect(page.getByTestId('info-save')).toHaveCount(0);
    await page.getByTestId('info-level').selectOption('niva2');
    await expect(page.getByTestId('info-level-note')).toHaveText('Sparat');
    expect((await competition(request, id)).level).toBe('niva2');
  });

  test('the name saves on Enter and on blur', async ({ page, request }) => {
    const id = await openInfo(page, request);
    await page.getByTestId('info-name').fill('Höstlabbet');
    await page.getByTestId('info-name').press('Enter');
    await expect(page.getByTestId('info-name-note')).toHaveText('Sparat');
    expect((await competition(request, id)).name).toBe('Höstlabbet');

    await page.getByTestId('info-name').fill('Höstlabbet två');
    await page.getByTestId('info-receipt').focus();
    await expect.poll(async () => (await competition(request, id)).name).toBe('Höstlabbet två');
  });

  test('a failed save shows the error at that field and the saved value again', async ({
    page,
    request,
  }) => {
    const id = await openInfo(page, request);
    await page.route(`**/api/competitions/${id}`, (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 500, json: { error: 'boom' } })
        : route.continue()
    );
    await page.getByTestId('info-distance').selectOption('sprint');
    await expect(page.getByTestId('info-distance-note')).toHaveText(
      'Ändringen sparades inte. Försök igen.'
    );
    await expect(page.getByTestId('info-distance')).toHaveValue('');
    await expect(page.getByTestId('info-level-note')).toHaveText('');
  });

  test('the date is ISO text; a date that is not one is not sent', async ({ page, request }) => {
    const id = await openInfo(page, request);
    const date = page.getByTestId('info-date');
    await expect(date).toHaveAttribute('type', 'text');
    await expect(date).toHaveValue('2026-10-09');
    const patches: unknown[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PATCH') patches.push(r.postDataJSON());
    });
    await date.fill('2026-13-40');
    await date.press('Enter');
    await expect(page.getByTestId('info-date-error')).toHaveText('Skriv datum som ÅÅÅÅ-MM-DD');
    expect(patches).toEqual([]);
    await date.fill('2026-10-10');
    await date.press('Enter');
    await expect(page.getByTestId('info-date-note')).toHaveText('Sparat');
    await expect(page.getByTestId('info-date-error')).toHaveCount(0);
    expect((await competition(request, id)).date).toBe('2026-10-10');
  });
});

test.describe('class kinds and fees', () => {
  test('a changed class kind or fee says Sparat at its row', async ({ page, request }) => {
    const id = await openInfo(page, request);
    const h21 = await classId(request, id, 'H21');
    await kindRow(page, h21).getByTestId('class-kind-select').selectOption('oppen');
    await expect(kindRow(page, h21).getByTestId('class-kind-note')).toHaveText('Sparat');

    const fee = page.getByLabel('Avgift för H21 i kronor', { exact: true });
    await fee.fill('150');
    await fee.blur();
    await expect(feeRow(page, h21).getByTestId('fees-row-note')).toHaveText('Sparat');
  });

  test('a failed class kind save shows the error at the row and the saved kind again', async ({
    page,
    request,
  }) => {
    const id = await openInfo(page, request);
    const h21 = await classId(request, id, 'H21');
    const select = kindRow(page, h21).getByTestId('class-kind-select');
    const before = await select.inputValue();
    await page.route('**/api/competitions/*/classes/kinds', (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({ status: 500, json: { error: 'boom' } })
        : route.continue()
    );
    await select.selectOption('oppen');
    await expect(kindRow(page, h21).getByTestId('class-kind-note')).toHaveText(
      'Klasstypen kunde inte sparas. Försök igen.'
    );
    await expect(select).toHaveValue(before);
  });

  test('a failed fee save shows the error at the row and the saved fee again', async ({
    page,
    request,
  }) => {
    const id = await openInfo(page, request);
    const h21 = await classId(request, id, 'H21');
    await page.route('**/api/competitions/*/fees', (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({ status: 500, json: { error: 'boom' } })
        : route.continue()
    );
    const fee = page.getByLabel('Avgift för H21 i kronor', { exact: true });
    await fee.fill('999');
    await fee.blur();
    await expect(feeRow(page, h21).getByTestId('fees-row-note')).toHaveText(
      'Det gick inte att spara avgiften.'
    );
    await expect(fee).toHaveValue('');
  });
});

test.describe('rapid edits are not lost', () => {
  test('nivå then distans while the first save is held: both persist, each alone', async ({
    page,
    request,
  }) => {
    const id = await openInfo(page, request);
    const bodies: unknown[] = [];
    const first = gate();
    let released = false;
    /** Whether each request reached the network after the first was let go. */
    const afterRelease: boolean[] = [];
    await page.route(`**/api/competitions/${id}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      bodies.push(route.request().postDataJSON());
      afterRelease.push(released);
      if (bodies.length === 1) await first.wait;
      return route.continue();
    });
    await page.getByTestId('info-level').selectOption('niva3');
    await expect.poll(() => bodies.length).toBe(1);
    await page.getByTestId('info-distance').selectOption('medel');
    // The second edit is taken while the first is held.
    await expect(page.getByTestId('info-distance-note')).toHaveText('Sparar…');
    released = true;
    first.release();
    await expect(page.getByTestId('info-level-note')).toHaveText('Sparat');
    await expect(page.getByTestId('info-distance-note')).toHaveText('Sparat');
    expect(bodies).toEqual([{ level: 'niva3' }, { distance: 'medel' }]);
    // The second waited for the first instead of going out beside it.
    expect(afterRelease).toEqual([false, true]);

    await page.reload();
    await expect(page.getByTestId('info-level')).toHaveValue('niva3', { timeout: 20_000 });
    await expect(page.getByTestId('info-distance')).toHaveValue('medel');
  });

  test('two fees in one row while the first save is held: both persist, on the saved row', async ({
    page,
    request,
  }) => {
    const id = await openInfo(page, request);
    const h21 = await classId(request, id, 'H21');
    const bodies: unknown[] = [];
    const first = gate();
    await page.route('**/api/competitions/*/fees', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      bodies.push(route.request().postDataJSON());
      if (bodies.length === 1) await first.wait;
      return route.continue();
    });
    const entry = page.getByLabel('Avgift för H21 i kronor', { exact: true });
    const late = page.getByLabel('Tillägg för H21 i procent', { exact: true });
    await entry.fill('120');
    await entry.blur();
    await expect.poll(() => bodies.length).toBe(1);
    await late.fill('30');
    await late.blur();
    first.release();
    await expect(feeRow(page, h21).getByTestId('fees-row-note')).toHaveText('Sparat');
    await expect.poll(() => bodies.length).toBe(2);
    const row = { class_id: h21, entry_fee: null, youth_entry_fee: null, late_fee_pct: null };
    expect(bodies).toEqual([
      { classes: [{ ...row, entry_fee: 120 }] },
      { classes: [{ ...row, entry_fee: 120, late_fee_pct: 30 }] },
    ]);

    await page.reload();
    await expect(page.getByLabel('Avgift för H21 i kronor', { exact: true })).toHaveValue('120', {
      timeout: 20_000,
    });
    await expect(page.getByLabel('Tillägg för H21 i procent', { exact: true })).toHaveValue('30');
  });
});

test.describe('max time', () => {
  test('before the first start it says it locks then, and keeps its Spara', async ({
    page,
    request,
  }) => {
    const id = await openInfo(page, request);
    await expect(page.getByTestId('info-max-time-lock')).toHaveText(
      'Låses när tävlingen startar (TR 4.21.2).'
    );
    await page.getByTestId('info-max-time-rule').getByText('Visa regeltext').click();
    await expect(page.getByTestId('info-max-time-rule')).toContainText('densamma för alla klasser');
    await page.getByTestId('info-max-time').fill('150');
    await page.getByTestId('info-max-time-save').click();
    await expect(page.getByTestId('info-max-time-note')).toHaveText('Sparat');
    expect((await competition(request, id)).max_time_sec).toBe(9000);
  });

  test('after the first start it is read-only and says since when', async ({ page, request }) => {
    await openInfo(page, request, { start: true });
    await expect(page.getByTestId('info-max-time-lock')).toHaveText('Låst sedan första start.');
    await expect(page.getByTestId('info-max-time')).toHaveAttribute('readonly', '');
    await expect(page.getByTestId('info-max-time-save')).toBeVisible();
    await expect(page.getByTestId('info-max-time-save')).toBeDisabled();
  });
});

test.describe('voiding a control', () => {
  test('the chip names its code, shows struken with an icon, and the result line undoes it', async ({
    page,
    request,
  }) => {
    const id = await openInfo(page, request);
    const chip = page.locator('[data-testid=info-ctrl-chip][data-code="53"]');
    await expect(chip).toHaveAttribute('title', 'Stryk kontroll 53');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(chip).toContainText('struken');
    await expect(chip.locator('svg')).toBeVisible();
    await expect(page.getByTestId('info-void-result')).toHaveText('Kontroll 53 struken. Ångra');

    await page.getByTestId('info-void-undo').click();
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await expect(chip).not.toContainText('struken');
    const res = await request.get(`${BASE}/api/competitions/${id}/voided-controls`);
    expect(((await res.json()) as { control_codes: number[] }).control_codes).toEqual([]);
  });

  test('a failed void shows the error at the chip, not as a page error', async ({
    page,
    request,
  }) => {
    await openInfo(page, request);
    await page.route('**/api/competitions/*/voided-controls/*', (route) =>
      route.fulfill({ status: 500, json: { error: 'boom' } })
    );
    const chip = page.locator('[data-testid=info-ctrl-chip][data-code="53"]');
    await chip.click();
    await expect(page.getByTestId('info-void-result')).toHaveText(
      'Kontroll 53 kunde inte strykas. Försök igen.'
    );
    await expect(page.getByRole('heading', { name: 'Tävlingsinfo' })).toBeVisible();
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
  });
});
