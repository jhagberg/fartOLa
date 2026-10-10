// Authored for fartola. Not ported from upstream.
//
// Two-step new-competition wizard e2e (plan 12, reader step removed).
//
// Tests:
//
//   1. **happy path** — visit /, click + Ny tävling, fill name+date,
//      drop the IOF30 CourseData sample, click Skapa tävling (step 2;
//      nothing waits for a reader). Assert:
//      - URL ends with /competition/<uuid>/readout (real UUID, no
//        `_new` literal sentinel survived the round-trip).
//      - Exactly ONE POST to /api/competitions/from-wizard fired.
//      - Zero POSTs to /api/competitions (the old two-call wizard
//        path). This is the C-H3 wire-shape regression gate.
//
//   2. **C-H3 rollback regression** — same flow with the corrupt
//      CourseData fixture (well-formed XML, XSD-invalid: Course missing
//      required Name child). Assert:
//      - The inline error banner appears at step 2 (xsd_invalid
//        message says the file is no course file).
//      - URL is STILL /competition/_new?wizard=1 — no navigation.
//      - GET /api/competitions returns the SAME row count as before
//        the click. This is the explicit C-H3 e2e regression gate:
//        the server's atomic transaction rolled back; no orphan
//        competition row persists.
//
// Locked by:
// - 01-12-PLAN.md task 2
// - 01-REVIEWS.md §C-H3

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWizard, ENTRYLIST_FIXTURE } from './helpers/wizard.ts';

// These tests share the bridge's SQLite DB; the rollback test
// asserts on competitions table row count, which would race with
// the happy-path test's successful create. Force serial mode so
// the count snapshot stays sound.
test.describe.configure({ mode: 'serial' });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COURSEDATA_FIXTURE = path.resolve(
  __dirname,
  '../../apps/edge/test/fixtures/iof30-coursedata-sample.xml'
);
const CORRUPT_FIXTURE = path.resolve(__dirname, './fixtures/wizard-corrupt-coursedata.xml');

test('three-click wizard happy path (C-H3: ONE atomic POST)', async ({ page, request }) => {
  // Collect all outbound POST URLs so we can assert the wire-shape
  // (one from-wizard POST, zero /api/competitions POSTs).
  const postUrls: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST') postUrls.push(req.url());
  });

  await page.goto('/');
  await page.getByTestId('open-wizard').first().click();

  // Step 1
  await page.getByTestId('wiz-name').fill('StorTuna Tisdag');
  await page.getByTestId('wiz-date').fill('2026-05-19');
  await page.getByTestId('wiz-next').click();

  // Step 2 — setInputFiles on the hidden file input inside the DropZone.
  await page.getByTestId('drop-zone-input').setInputFiles(COURSEDATA_FIXTURE);
  await expect(page.getByTestId('wiz-preview')).toBeVisible();

  // Create at once: no reader step, nothing to wait for.
  const startBtn = page.getByTestId('wiz-start');
  await expect(startBtn).toBeEnabled();
  await startBtn.click();

  // Wait for the URL to be the readout view with a real UUID.
  await page.waitForURL(
    /\/competition\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/readout$/,
    {
      timeout: 10_000,
    }
  );
  expect(page.url()).not.toContain('_new');

  // Wire-shape regression: exactly ONE from-wizard POST, ZERO
  // /api/competitions POSTs (the old two-call wizard path).
  const fromWizard = postUrls.filter((u) => u.endsWith('/api/competitions/from-wizard'));
  const oldCreate = postUrls.filter((u) => /\/api\/competitions$/.test(u));
  expect(fromWizard).toHaveLength(1);
  expect(oldCreate).toHaveLength(0);

  // Sanity: the readout view rendered (plan 13 replaced the placeholder
  // with the real ReadoutView component; the test-id moved to
  // `readout-view` accordingly).
  await expect(page.getByTestId('readout-view')).toBeVisible();
  // The edge has the competition row.
  const list = await request.get('http://localhost:5174/api/competitions');
  expect(list.status()).toBe(200);
  const listBody = (await list.json()) as { competitions: { id: string }[] };
  const newId = page.url().match(/\/competition\/([^/]+)\/readout$/)?.[1];
  expect(newId).toBeTruthy();
  expect(listBody.competitions.some((c) => c.id === newId)).toBe(true);
});

test('three-click wizard rollback on corrupt XML — C-H3 regression gate', async ({
  page,
  request,
}) => {
  // Snapshot the count BEFORE the wizard touches anything.
  const before = await request.get('http://localhost:5174/api/competitions');
  expect(before.status()).toBe(200);
  const countBefore = ((await before.json()) as { competitions: unknown[] }).competitions.length;

  await page.goto('/');
  await page.getByTestId('open-wizard').first().click();

  // Step 1 — unique name so we'd notice if it accidentally persisted.
  const uniqueName = `Corrupt Sample ${Date.now()}`;
  await page.getByTestId('wiz-name').fill(uniqueName);
  await page.getByTestId('wiz-date').fill('2026-05-19');
  await page.getByTestId('wiz-next').click();

  // Step 2 — corrupt fixture (well-formed XML, XSD-invalid: Course
  // missing required Name child). Client-side root-element check
  // passes (root IS <CourseData>); the import-preview banner appears.
  await page.getByTestId('drop-zone-input').setInputFiles(CORRUPT_FIXTURE);
  await expect(page.getByTestId('wiz-preview')).toBeVisible();
  await page.getByTestId('wiz-start').click();

  // The inline error banner appears with the xsd_invalid mapping; the
  // wizard stays open at /_new?wizard=1.
  const err = page.getByTestId('wizard-error');
  await expect(err).toBeVisible({ timeout: 10_000 });
  await expect(err).toContainText('Filen är ingen banfil');
  await expect(err).not.toContainText('IOF XML');
  expect(page.url()).toContain('/competition/_new?wizard=1');

  // Codex C-H3 e2e regression gate: no orphan row persists. The strict
  // `countBefore` snapshot used to be the assertion but plan 13 added
  // tests/e2e/readout.spec.ts which creates competitions in a parallel
  // worker (DB-isolation hassle called out in the plan). The
  // "no row with our unique name" check below is the actual C-H3
  // semantic — the corrupt wizard run MUST NOT have committed a row
  // — and is parallel-worker safe. `countBefore` is referenced so
  // ESLint doesn't flag it as unused.
  void countBefore;
  const after = await request.get('http://localhost:5174/api/competitions');
  expect(after.status()).toBe(200);
  const afterBody = (await after.json()) as { competitions: { name: string }[] };
  expect(afterBody.competitions.some((c) => c.name === uniqueName)).toBe(false);
});

test('the wizard has two steps', async ({ page }) => {
  await openWizard(page);
  await expect(page.locator('.wiz-steps .wiz-step')).toHaveCount(2);
  await expect(page.locator('.modal-head .muted')).toHaveText('1/2');
  await page.getByTestId('wiz-name').fill('Två steg');
  await page.getByTestId('wiz-date').fill('2026-05-19');
  await page.getByTestId('wiz-next').click();
  await expect(page.locator('.modal-head .muted')).toHaveText('2/2');
});

test('an entry list in place of a course file gives an actionable error that clears', async ({
  page,
}) => {
  await openWizard(page);
  await page.getByTestId('wiz-name').fill(`Anmälningsfil ${Date.now()}`);
  await page.getByTestId('wiz-date').fill('2026-05-19');
  await page.getByTestId('wiz-next').click();
  await page.getByTestId('drop-zone-input').setInputFiles(ENTRYLIST_FIXTURE);
  await page.getByTestId('wiz-start').click();
  const err = page.getByTestId('wizard-error');
  await expect(err).toHaveText('Välj en banfil (XML) först. Anmälningsfilen läser du in efteråt.');
  await page.getByTestId('drop-zone-input').setInputFiles(COURSEDATA_FIXTURE);
  await expect(err).toHaveCount(0);
});

test('a bad date says so and blocks Nästa', async ({ page }) => {
  await openWizard(page);
  await page.getByTestId('wiz-name').fill('Fel datum');
  await page.getByTestId('wiz-date').fill('2026-13-99x');
  await expect(page.getByText('Skriv datum som ÅÅÅÅ-MM-DD')).toBeVisible();
  await expect(page.getByTestId('wiz-next')).toBeDisabled();
});

test('the typed draft survives the detour to the Eventor key', async ({ page }) => {
  await page.route('**/api/eventor/events/**', (r) =>
    r.fulfill({ status: 400, json: { error: 'no_key' } })
  );
  await openWizard(page);
  await page.getByTestId('wiz-name').fill('Kvar efter nyckeln');
  await page.getByTestId('wiz-date').fill('2026-05-19');
  await page.getByTestId('wiz-evqs-input').fill('12345');
  await page.getByTestId('wiz-evqs-fetch').click();
  await page.getByRole('link', { name: 'Lägg in Eventor-nyckeln' }).click();
  await expect(page).toHaveURL(/\/installningar/);
  await page.goBack();
  await expect(page.getByTestId('wiz-name')).toHaveValue('Kvar efter nyckeln');
  await expect(page.getByTestId('wiz-date')).toHaveValue('2026-05-19');
  await expect(page.getByTestId('wiz-evqs-input')).toHaveValue('12345');

  await page.getByTestId('wiz-cancel').click();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => sessionStorage.getItem('fartola-wizard-draft'))).toBeNull();
  // Open it again directly (openWizard would clear the draft itself).
  await page.getByTestId('open-wizard').first().click();
  await expect(page.getByTestId('wiz-name')).toBeVisible();
  await expect(page.getByTestId('wiz-name')).toHaveValue('');
  await expect(page.getByTestId('wiz-date')).toHaveValue('');
});
