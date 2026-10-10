// Authored for fartola. Not ported from upstream.
//
// Registration-desk queue + auto-advance e2e (plan 02-02b).
//
//   1. **empty mount**: navigate to /competition/:id/registration;
//      assert the "Inga brickor i kö" empty state.
//   2. **first card opens modal**: simulate-read card #9999991;
//      assert WalkupModal mounts; assert queue badge is HIDDEN
//      (queue empty — the card is the "current" one, not queued).
//   3. **second card while modal open → queue + badge**: simulate-read
//      card #9999992; assert WalkupModal STILL shows card #9999991
//      (NOT auto-advanced — we only auto-advance on close); assert
//      badge reads "1 i kö".
//   4. **Save closes modal AND auto-opens for queued card**: fill
//      name + class in the modal; click Spara; wait for the modal
//      to re-render with cardNumber=9999992; assert badge is now
//      HIDDEN (queue empty again).
//   5. **dedupe toast for repeated card**: with modal open for
//      #9999992, simulate-read #9999992 again; assert dedupe toast
//      visible matching t('registration.dedupeToast'); assert queue
//      badge STILL hidden.
//   6. **late finish punch is queued like any unknown card**: with
//      modal still open for #9999992, simulate-read #1234567 (different
//      card); assert badge reads "1 i kö"; click Spara on #9999992;
//      assert modal re-opens for #1234567.
//
// Test isolation: serial mode (mirrors walkup.spec.ts pattern — the
// bridge's tmp SQLite DB is shared across all e2e files).
//
// Locked by:
// - 02-02b-PLAN.md task 5

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COURSEDATA_FIXTURE = path.resolve(
  __dirname,
  '../../apps/edge/test/fixtures/iof30-coursedata-sample.xml'
);

test.describe.configure({ mode: 'serial' });

const BASE = 'http://localhost:5174';

async function setup(
  request: import('@playwright/test').APIRequestContext
): Promise<{ competitionId: string }> {
  // 1) Create competition.
  const created = await request.post(`${BASE}/api/competitions`, {
    data: { name: `Registration E2E ${Date.now()}`, date: '2026-05-19' },
  });
  expect(created.status()).toBe(201);
  const comp = (await created.json()) as { id: string };
  const competitionId = comp.id;

  // 2) Import CourseData so WalkupModal has classes to pick from.
  //    We use the existing iof30-coursedata-sample.xml fixture (same
  //    one walkup.spec.ts uses — H21 + other classes). The exact
  //    class list doesn't matter for the queue logic; we just need
  //    at least one selectable option.
  const courseDataBuf = await readFile(COURSEDATA_FIXTURE);
  const cdRes = await request.post(`${BASE}/api/competitions/${competitionId}/import`, {
    multipart: {
      file: { name: 'coursedata.xml', mimeType: 'application/xml', buffer: courseDataBuf },
    },
  });
  expect(cdRes.status(), `coursedata: ${await cdRes.text()}`).toBe(201);

  // 3) Set active competition so the bridge routes card_reads here.
  await request.post(`${BASE}/api/sessions/active-competition`, {
    data: { competition_id: competitionId },
  });

  // 3b) Phase 2.1 race-phase gate (9f5781f): without start-race, simulate-
  // read events are identity-only scans that don't surface in the readout
  // history → the unknown-card walkup redirect never fires.
  const startRace = await request.post(`${BASE}/api/competitions/${competitionId}/start-race`);
  expect([200, 201]).toContain(startRace.status());

  return { competitionId };
}

async function simulateRead(
  request: import('@playwright/test').APIRequestContext,
  competitionId: string,
  cardNumber: number
): Promise<void> {
  const res = await request.post(`${BASE}/api/__dev/simulate-read`, {
    data: {
      competition_id: competitionId,
      card_number: cardNumber,
      card_type: 'SI10',
      punches: [{ control_code: 31, time_ms: 35_000 }],
    },
  });
  expect(res.status(), `simulate-read body: ${await res.text()}`).toBe(201);
}

test('registration-desk: queue + auto-advance + dedupe', async ({ page, request }) => {
  const { competitionId } = await setup(request);

  // 1) Mount the registration page; empty state is visible.
  await page.goto(`${BASE}/competition/${competitionId}/registration`);
  await expect(page.getByTestId('registration-view')).toBeVisible();
  await expect(page.getByTestId('reg-empty')).toBeVisible();
  await expect(page.getByTestId('reg-queue-badge')).toBeHidden();

  // 2) First card_read → modal opens for #9999991; queue badge hidden
  //    (the card is "current", not queued).
  await simulateRead(request, competitionId, 9_999_991);
  await expect(page.getByTestId('walkup-modal')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('walkup-card')).toHaveValue('9999991');
  await expect(page.getByTestId('reg-queue-badge')).toBeHidden();

  // 3) Second card_read while modal open → queue grows to 1; modal
  //    still shows card #9999991 (we only advance on close).
  await simulateRead(request, competitionId, 9_999_992);
  // Give the WS round-trip a moment to land.
  await expect(page.getByTestId('reg-queue-badge')).toBeVisible({ timeout: 3_000 });
  await expect(page.getByTestId('reg-queue-badge')).toContainText('1');
  await expect(page.getByTestId('walkup-card')).toHaveValue('9999991');

  // 4) Fill modal #1, Save → modal auto-advances to card #9999992.
  await page.getByTestId('walkup-name').fill('Test Runner One');
  // Select the first available class (any class works — we just need
  // a valid id so the POST validates).
  const classSelect = page.getByTestId('walkup-class');
  await classSelect.selectOption({ index: 1 });
  // Consent starts unticked (audit WA-2, 2026-10-10).
  await page.getByTestId('walkup-consent').check();
  await page.getByTestId('walkup-save').click();
  // Wait for the modal to re-render with the next card.
  await expect(page.getByTestId('walkup-card')).toHaveValue('9999992', { timeout: 5_000 });
  await expect(page.getByTestId('reg-queue-badge')).toBeHidden();

  // 5) Dedupe toast: same card_number arrives again while it is the
  //    currently-open card → toast appears, queue still empty.
  await simulateRead(request, competitionId, 9_999_992);
  await expect(page.getByTestId('reg-toast')).toBeVisible({ timeout: 3_000 });
  await expect(page.getByTestId('reg-toast')).toContainText('9999992');
  await expect(page.getByTestId('reg-queue-badge')).toBeHidden();

  // 6) Late finish punch (different card) → queued; Save on #9999992
  //    → modal advances to #1234567 (the "late punch").
  await simulateRead(request, competitionId, 1_234_567);
  await expect(page.getByTestId('reg-queue-badge')).toBeVisible({ timeout: 3_000 });
  await expect(page.getByTestId('reg-queue-badge')).toContainText('1');

  await page.getByTestId('walkup-name').fill('Test Runner Two');
  await classSelect.selectOption({ index: 1 });
  await page.getByTestId('walkup-consent').check();
  await page.getByTestId('walkup-save').click();

  await expect(page.getByTestId('walkup-card')).toHaveValue('1234567', { timeout: 5_000 });
  await expect(page.getByTestId('reg-queue-badge')).toBeHidden();
});
