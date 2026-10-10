// Authored for fartola. Not ported from upstream.
//
// Export view e2e (plan 16). Two tests:
//
//   1. **preview validation green** — Setup: create competition + import
//      CourseData + EntryList + simulate three reads. Navigate to
//      /competition/<id>/export. Assert the green validation box appears
//      within 5s and the download button is enabled.
//
//   2. **download streams XML** — Same setup. Click the download button
//      and assert (a) Playwright observes a browser download event,
//      (b) the saved filename matches `*-resultlist.xml`, (c) the body
//      starts with `<?xml` and contains `<ResultList`.
//
// Test isolation: shares the tmp DB with wizard.spec.ts + readout.spec.ts.
// Serial mode mirrors those files' workaround.
//
// Locked by:
// - 01-16-PLAN.md task 2

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COURSEDATA_FIXTURE = path.resolve(
  __dirname,
  '../../apps/edge/test/fixtures/iof30-coursedata-sample.xml'
);
const ENTRYLIST_FIXTURE = path.resolve(
  __dirname,
  '../../apps/edge/test/fixtures/iof30-entrylist-sample.xml'
);

test.describe.configure({ mode: 'serial' });

const BASE = 'http://localhost:5174';

async function setupCompetition(
  request: import('@playwright/test').APIRequestContext
): Promise<{ competitionId: string }> {
  const created = await request.post(`${BASE}/api/competitions`, {
    data: { name: `Export E2E ${Date.now()}`, date: '2026-05-19' },
  });
  expect(created.status()).toBe(201);
  const { id: competitionId } = (await created.json()) as { id: string };

  const courseDataBuf = await readFile(COURSEDATA_FIXTURE);
  const cdRes = await request.post(`${BASE}/api/competitions/${competitionId}/import`, {
    multipart: {
      file: { name: 'coursedata.xml', mimeType: 'application/xml', buffer: courseDataBuf },
    },
  });
  expect(cdRes.status(), `coursedata: ${await cdRes.text()}`).toBe(201);

  const entryListBuf = await readFile(ENTRYLIST_FIXTURE);
  const elRes = await request.post(`${BASE}/api/competitions/${competitionId}/import`, {
    multipart: {
      file: { name: 'entrylist.xml', mimeType: 'application/xml', buffer: entryListBuf },
    },
  });
  expect(elRes.status(), `entrylist: ${await elRes.text()}`).toBe(201);

  const setActive = await request.post(`${BASE}/api/sessions/active-competition`, {
    data: { competition_id: competitionId },
  });
  expect(setActive.status()).toBe(200);

  return { competitionId };
}

async function simulateRead(
  request: import('@playwright/test').APIRequestContext,
  competitionId: string,
  cardNumber: number,
  withPunches: boolean
): Promise<void> {
  const punches = withPunches
    ? [
        { control_code: 31, time_ms: 35_000 },
        { control_code: 32, time_ms: 78_000 },
        { control_code: 33, time_ms: 140_000 },
      ]
    : [];
  const res = await request.post(`${BASE}/api/__dev/simulate-read`, {
    data: {
      competition_id: competitionId,
      card_number: cardNumber,
      card_type: 'SI10',
      punches,
    },
  });
  expect(res.status(), `simulate-read body: ${await res.text()}`).toBe(201);
}

test('export preview validation is green and download button enabled', async ({
  page,
  request,
}) => {
  const { competitionId } = await setupCompetition(request);

  // Three reads: one OK (full punch set), one MP (no punches), one DNF
  // (we'll only send a start-style read with no finish — simulate-read
  // always sets a finish if punches are present, so for DNF we just send
  // a known card with empty punches and treat it as MP for the export
  // count — the spec test asserts on the green check, not exact counts).
  await simulateRead(request, competitionId, 7_501_853, true);
  await simulateRead(request, competitionId, 1_428_824, false);

  await page.goto(`/competition/${competitionId}/export`);
  await expect(page.getByTestId('export-view')).toBeVisible();
  // Green validation box appears within 5s.
  await expect(page.getByTestId('export-valid')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('export-valid')).toContainText('Filen är giltig');

  // Download button is enabled (not disabled-class, not aria-disabled).
  const downloadBtn = page.getByTestId('export-download');
  await expect(downloadBtn).toBeVisible();
  await expect(downloadBtn).toHaveAttribute('aria-disabled', 'false');
});

test('export download streams an IOF XML 3.0 ResultList', async ({ page, request }) => {
  const { competitionId } = await setupCompetition(request);
  await simulateRead(request, competitionId, 7_501_853, true);

  await page.goto(`/competition/${competitionId}/export`);
  await expect(page.getByTestId('export-valid')).toBeVisible({ timeout: 5_000 });

  // Trigger the download. Playwright's `page.waitForEvent('download')`
  // resolves when the browser handles a Content-Disposition: attachment
  // response.
  const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
  await page.getByTestId('export-download').click();
  const download = await downloadPromise;

  // Filename matches the slug pattern.
  expect(download.suggestedFilename()).toMatch(/-resultlist\.xml$/);

  // Read the downloaded body via Playwright's stream API and verify the
  // shape (no need to re-validate XSD here — the route-test suite
  // already does that; this test guards the wire-shape).
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  expect(body.startsWith('<?xml')).toBe(true);
  expect(body).toContain('<ResultList');
  expect(body).toContain('iofVersion="3.0"');
});

test('the set button carries the count and is disabled at 0; undo is secondary', async ({
  page,
  request,
}) => {
  const { competitionId } = await setupCompetition(request);
  await page.goto(`/competition/${competitionId}/export`);
  const pending = page.getByTestId('export-pending');
  await expect(pending).toBeVisible({ timeout: 5_000 });
  // A warning, not an error: amber, not red.
  await expect(pending).toHaveClass(/\bwarn\b/);
  const n = Number((await pending.innerText()).match(/(\d+) löpare/)?.[1]);
  expect(n).toBeGreaterThan(0);
  const set = page.getByTestId('export-unread-dns');
  await expect(set).toHaveText(`Sätt ${n} ej utlästa till Ej start`);
  await expect(page.getByTestId('export-unread-dns-undo')).toHaveClass(/variant-secondary/);
  await set.click();
  await expect(page.getByTestId('export-unread-message')).toBeVisible();
  await expect(set).toBeDisabled();
  await expect(set).toHaveText('Sätt 0 ej utlästa till Ej start');
});

test('no stale download: disabled while a new preview loads, one request on load', async ({
  page,
  request,
}) => {
  const { competitionId } = await setupCompetition(request);
  let previews = 0;
  page.on('request', (r) => {
    if (r.url().includes('/export/preview')) previews += 1;
  });
  await page.goto(`/competition/${competitionId}/export`);
  await expect(page.getByTestId('export-valid')).toBeVisible({ timeout: 5_000 });
  expect(previews).toBe(1);
  const link = page.getByTestId('export-download');
  await expect(link).toHaveAttribute('aria-disabled', 'false');

  await page.route('**/export/preview**', async (route) => {
    await new Promise((r) => setTimeout(r, 1_000));
    await route.continue();
  });
  await page.getByTestId('export-status-provisional').check();
  await expect(link).toHaveAttribute('aria-disabled', 'true');
  await expect(link).not.toHaveAttribute('href', /.*/);
  await expect(page.getByTestId('export-valid')).toBeVisible({ timeout: 5_000 });
  await expect(link).toHaveAttribute('aria-disabled', 'false');
  await expect(link).toHaveAttribute('href', /status=Provisional/);
});

test('an older preview response changes nothing', async ({ page, request }) => {
  const { competitionId } = await setupCompetition(request);
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  let answered: () => void = () => {};
  const staleSent = new Promise<void>((r) => (answered = r));
  let finals = 0;
  await page.route('**/export/preview**', async (route) => {
    if (route.request().url().includes('status=Final')) {
      finals += 1;
      // Hold the first Final, then answer it with something visibly wrong.
      if (finals === 1) {
        await held;
        await route.fulfill({
          json: { valid: false, errors: [{ line: 1, column: 1, message: 'stale' }] },
        });
        answered();
        return;
      }
    }
    await route.continue();
  });
  await page.goto(`/competition/${competitionId}/export`);
  await page.getByTestId('export-status-provisional').check();
  await expect(page.getByTestId('export-valid')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('export-status-final').check();
  const link = page.getByTestId('export-download');
  await expect(link).toHaveAttribute('aria-disabled', 'false');
  await expect(link).toHaveAttribute('href', /status=Final/);
  release();
  await staleSent;
  // Let the page react to the stale answer, if it wrongly applies it.
  await page.waitForTimeout(300);
  await expect(page.getByTestId('export-valid')).toBeVisible();
  await expect(page.getByTestId('export-invalid')).toHaveCount(0);
  await expect(link).toHaveAttribute('aria-disabled', 'false');
  await expect(link).toHaveAttribute('href', /status=Final/);
  await expect(page.getByTestId('export-loading')).toHaveCount(0);
});

test('after a download the next step links to Eventor publishing', async ({ page, request }) => {
  const { competitionId } = await setupCompetition(request);
  await simulateRead(request, competitionId, 7_501_853, true);
  await page.goto(`/competition/${competitionId}/export`);
  await expect(page.getByTestId('export-valid')).toBeVisible({ timeout: 5_000 });
  const download = page.waitForEvent('download');
  await page.getByTestId('export-download').click();
  await download;
  const next = page.getByTestId('export-next');
  await expect(next).toContainText('Hämtningen har startat.');
  await expect(next.getByRole('link', { name: 'publicera till Eventor' })).toHaveAttribute(
    'href',
    `/competition/${competitionId}/eventor-publish`
  );
});
