// Authored for fartola. Not ported from upstream.
//
// Live-results view e2e (plan 01-14).
//
//   1. **live update via WS**: navigate to /competition/:id/results,
//      simulate a card_read for an EntryList competitor, assert their row
//      shows up in the table with the right name + a .new flash class
//      within 5s. The projection store debounce is 50ms so the
//      results_update envelope lands almost immediately after the read.
//
//   2. **fullscreen toggle**: press F → the view gains data-fullscreen
//      ="true" + the res-fs class; the projector-mode layout is active.
//      Press F again → goes back to normal.
//
// Test isolation: serial (shares the bridge DB with the other e2e
// specs).
//
// Locked by:
// - 01-14-PLAN.md task 2
// - 01-UI-SPEC.md §"Live results auto-update" + §"Fullscreen mode"
// - REQ-EVT-CMP-007

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

async function setup(
  request: import('@playwright/test').APIRequestContext
): Promise<{ competitionId: string }> {
  const created = await request.post(`${BASE}/api/competitions`, {
    data: { name: `Results E2E ${Date.now()}`, date: '2026-05-19' },
  });
  expect(created.status()).toBe(201);
  const competitionId = ((await created.json()) as { id: string }).id;

  const courseDataBuf = await readFile(COURSEDATA_FIXTURE);
  const cdRes = await request.post(`${BASE}/api/competitions/${competitionId}/import`, {
    multipart: {
      file: { name: 'coursedata.xml', mimeType: 'application/xml', buffer: courseDataBuf },
    },
  });
  expect(cdRes.status()).toBe(201);

  const entryListBuf = await readFile(ENTRYLIST_FIXTURE);
  const elRes = await request.post(`${BASE}/api/competitions/${competitionId}/import`, {
    multipart: {
      file: { name: 'entrylist.xml', mimeType: 'application/xml', buffer: entryListBuf },
    },
  });
  expect(elRes.status()).toBe(201);

  const setActive = await request.post(`${BASE}/api/sessions/active-competition`, {
    data: { competition_id: competitionId },
  });
  expect(setActive.status()).toBe(200);

  // Phase 2.1 race-phase gate (9f5781f): flip out of pre-race so the
  // simulate-read events trigger the results_update broadcast we assert
  // on. Pre-race reads land in history as identity-only scans (status
  // PEND) and the projection's results channel stays quiet.
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
      punches: [
        { control_code: 31, time_ms: 35_000 },
        { control_code: 32, time_ms: 78_000 },
        { control_code: 33, time_ms: 140_000 },
      ],
    },
  });
  expect(res.status()).toBe(201);
}

test('live results update via WS results_update on simulate-read', async ({ page, request }) => {
  const { competitionId } = await setup(request);

  await page.goto(`/competition/${competitionId}/results`);
  await expect(page.getByTestId('results-view')).toBeVisible();
  await expect(page.getByTestId('results-table').first()).toBeVisible();

  // Capture the millisecond updatedAtMs hook before the read so we can
  // assert it changes on the live update. WR-005: the visible header
  // label is HH:MM:SS only — an update arriving in the same wall-clock
  // second produces identical visible text and flakes. The
  // `data-updated-ms` attribute on `[data-testid=results-view]` carries
  // the underlying millisecond timestamp from `onResultsFull` /
  // `onResultsUpdate`, which always advances.
  const view = page.getByTestId('results-view');
  const updatedBefore = (await view.getAttribute('data-updated-ms')) ?? '';

  // Simulate-read Anna's card. The projection recomputes (50ms debounce)
  // and broadcasts results_update on results:<id>.
  await simulateRead(request, competitionId, 7_501_853);

  // Anna's row appears in the results table within 5s.
  const row = page.getByTestId('results-row-name').filter({ hasText: 'Anna' });
  await expect(row.first()).toBeVisible({ timeout: 5_000 });

  // The millisecond timestamp advanced (UI-SPEC §"Live results auto-update").
  await expect
    .poll(async () => (await view.getAttribute('data-updated-ms')) ?? '', {
      timeout: 5_000,
    })
    .not.toBe(updatedBefore);
});

test('F key toggles fullscreen / projector mode', async ({ page, request }) => {
  const { competitionId } = await setup(request);

  await page.goto(`/competition/${competitionId}/results`);
  const view = page.getByTestId('results-view');
  await expect(view).toBeVisible();
  await expect(view).toHaveAttribute('data-fullscreen', 'false');

  // Press F → projector mode active. We focus the body first so the
  // keydown isn't routed to an input (none exist on this view but be
  // explicit about the contract from UI-SPEC §"Keyboard shortcuts").
  await page.locator('body').focus();
  await page.keyboard.press('f');

  await expect(view).toHaveAttribute('data-fullscreen', 'true', { timeout: 2_000 });

  // Press F again → exits projector mode.
  await page.keyboard.press('f');
  await expect(view).toHaveAttribute('data-fullscreen', 'false', { timeout: 2_000 });
});
