// tests/e2e/readout-frame.spec.ts
// Authored for fartola. Not ported from upstream.
//
// Design lab plan 3, task 3: readout toasts stack without overlap, a card
// read twice is one history row, the missing-starts panel recovers from a
// failed load and counts what it sets, the reader status names its subject.
import { test, expect } from '@playwright/test';
import { seedCompetition, simulateRead } from './helpers/seed.ts';
import { prepareReadoutFrame } from './helpers/readout.ts';
import { mockMissingStarts, mockMissingStartsLoadError } from './helpers/missing-starts.ts';

const ANNA = 7_501_853;
const CIA = 1_428_824;
const CODES = [31, 32, 33, 34];

test('the consent and hire-card toasts stack without overlapping', async ({ page, request }) => {
  await prepareReadoutFrame(page, request);
  const a = (await page.getByTestId('consent-confirmation-toast').boundingBox())!;
  const b = (await page.getByTestId('hyrbricka-toast').boundingBox())!;
  const apart = a.y + a.height <= b.y || b.y + b.height <= a.y;
  expect(apart, `consent ${JSON.stringify(a)} hire ${JSON.stringify(b)}`).toBe(true);
  for (const box of [a, b]) {
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  }
  await expect(page.getByRole('button', { name: 'Senare' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Markera återlämnad' })).toBeVisible();
});

test('two notices and the consent toast show at once, without overlapping', async ({
  page,
  request,
}) => {
  const { competitionId: id } = await seedCompetition(request, { controls: 4 });
  await simulateRead(request, id, ANNA, CODES);
  await simulateRead(request, id, CIA, CODES);
  await page.goto(`/competition/${id}/readout`);
  await expect(page.getByTestId('card-number').first()).toHaveText(String(CIA));
  const pinAnna = async () => {
    await page
      .getByTestId('history-row')
      .filter({ hasText: String(ANNA) })
      .click();
    await expect(page.getByText('Du tittar på en äldre avläsning.')).toBeVisible();
  };
  const notices = page.getByTestId('toast').filter({ hasText: 'Ny avläsning' });
  await pinAnna();
  await simulateRead(request, id, CIA, CODES, { start: 11 * 3600 });
  await expect(notices).toHaveCount(1);
  await expect(page.getByTestId('consent-confirmation-toast')).toBeVisible();
  // A second pinned-replaced notice while the first is still up: both stay.
  await pinAnna();
  await simulateRead(request, id, CIA, CODES, { start: 12 * 3600 });
  await expect(notices).toHaveCount(2);
  const boxes = [...(await notices.all()), page.getByTestId('consent-confirmation-toast')];
  const rects = await Promise.all(boxes.map((b) => b.boundingBox()));
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!;
      const b = rects[j]!;
      expect(
        a.y + a.height <= b.y || b.y + b.height <= a.y,
        `${JSON.stringify(a)} overlaps ${JSON.stringify(b)}`
      ).toBe(true);
    }
  }
});

test('a card read twice is one history row, expanding shows both', async ({ page, request }) => {
  const { competitionId: id } = await seedCompetition(request, { controls: 4 });
  await simulateRead(request, id, CIA, CODES);
  await simulateRead(request, id, ANNA, CODES);
  await simulateRead(request, id, ANNA, CODES, { start: 11 * 3600 });
  await page.goto(`/competition/${id}/readout`);
  await expect(page.getByTestId('card-number').first()).toHaveText(String(ANNA));
  const rows = page.getByTestId('history-row');
  await expect(rows).toHaveCount(2);
  const toggle = page.getByTestId('history-group-toggle');
  await expect(toggle).toHaveText(/2 avläsningar/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const anna = rows.filter({ hasText: String(ANNA) });
  await expect(anna).toHaveCount(2);
  const cue = page.getByText('Du tittar på en äldre avläsning.');
  await expect(cue).toHaveCount(0);
  // The earlier read pins (the cue shows); the group stays open around it.
  await anna.nth(1).click();
  await expect(cue).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(anna).toHaveCount(2);
  // The newest read clears the pin.
  await anna.nth(0).click();
  await expect(cue).toHaveCount(0);
});

for (const [what, patch] of [
  ['status', { status: 'MP' }],
  ['runner', { competitor_name: 'Någon Annan' }],
] as const) {
  test(`a re-read with another ${what} for the same card is its own row`, async ({
    page,
    request,
  }) => {
    const { competitionId: id } = await seedCompetition(request, { controls: 4 });
    await simulateRead(request, id, ANNA, CODES);
    await simulateRead(request, id, ANNA, CODES, { start: 11 * 3600 });
    // The newest of the two reads carries another result.
    await page.route('**/api/competitions/*/readout', async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { history: Array<Record<string, unknown>> };
      Object.assign(body.history[0]!, patch);
      await route.fulfill({ response: res, json: body });
    });
    await page.goto(`/competition/${id}/readout`);
    await expect(page.getByTestId('history-row')).toHaveCount(2);
    await expect(page.getByTestId('history-group')).toHaveCount(0);
  });
}

test('reader status names its subject', async ({ page, request }) => {
  const { competitionId: id } = await seedCompetition(request, { controls: 4 });
  await page.goto(`/competition/${id}/readout`);
  await expect(page.getByTestId('ws-status')).toContainText(
    /Läsare: (Ansluten|Frånkopplad|Söker…)/
  );
  const side = page.locator('.station-card');
  await expect(side).toContainText(/Läsare: (Ansluten|Frånkopplad|Söker…)/);
  await expect(side).not.toContainText('BSM7-USB');
  await expect(side).not.toContainText('/dev/ttyUSB0');
  await expect(side).not.toContainText('38400');
});

test('the clock has no TID caption and the version is not in the sidebar', async ({
  page,
  request,
}) => {
  const { competitionId: id } = await seedCompetition(request, { controls: 4 });
  await page.goto(`/competition/${id}/readout`);
  await expect(page.getByLabel('Tävlingstid')).toBeVisible();
  await expect(page.locator('.topbar')).not.toContainText('TID');
  await expect(page.locator('.sidebar')).not.toContainText('v0.1.0');
  await page.goto('/installningar');
  await expect(page.getByTestId('appearance-section')).toContainText(/Version /);
});

test.describe('missing starts', () => {
  test('a failed first load shows the error with a retry', async ({ page, request }) => {
    const { competitionId: id } = await seedCompetition(request, { controls: 4 });
    const recover = await mockMissingStartsLoadError(page);
    await page.goto(`/competition/${id}/results`);
    const err = page.getByTestId('missing-starts-error');
    await expect(err).toBeVisible();
    recover();
    await err.getByRole('button', { name: 'Försök igen' }).click();
    await expect(page.getByTestId('missing-start-row')).toHaveCount(2);
    await expect(err).toHaveCount(0);
  });

  test('Sätt alla carries the count, says Sätter… while busy, then a result line', async ({
    page,
    request,
  }) => {
    const { competitionId: id } = await seedCompetition(request, { controls: 4 });
    const release = await mockMissingStarts(page, true);
    await page.goto(`/competition/${id}/results`);
    const all = page.getByTestId('missing-starts-set-all');
    await expect(all).toHaveText('Sätt alla (2)');
    await expect(page.getByTestId('missing-starts-stats')).toHaveText(
      'median 1:54, medel 2:07 (12 löpare)'
    );
    await all.click();
    await expect(all).toHaveText('Sätter…');
    release();
    await expect(page.getByTestId('missing-starts-done')).toHaveText('2 starttider satta.');
  });
});
