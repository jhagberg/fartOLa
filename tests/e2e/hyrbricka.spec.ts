// Authored for fartola. Not ported from upstream.
//
// Plan 02-05 — Hyrbricka end-to-end. Covers the walkup → readout →
// Markera återlämnad happy path that ties Plan 02-02 (walk-up hired_card writer)
// to Plan 02-05 (finish-readout toast + Markera återlämnad button + admin view).
//
// Flow (single test — the 9 steps live as one continuous Playwright
// spec because they depend on each other's state):
//
//   1. POST /api/competitions → competition_id.
//   2. POST /api/competitions/:id/import (coursedata) → classes + courses.
//   3. POST /api/sessions/active-competition → bridge routes here.
//   4. Open the walk-up modal via ?walkup=88888 on the readout URL.
//   5. Fill the form (name + class + Hyrbricka + phone). Save.
//   6. Assert the GET /hired-cards now lists 88888 as open.
//   7. Trigger card_read for 88888 via POST /api/__dev/simulate-read.
//   8. Assert [data-testid="hyrbricka-return"] is visible AND contains
//      the contact phone.
//   9. Click Markera återlämnad → toast disappears AND GET /hired-cards shows
//      88888 with returned_at_ms set.
//   10. Trigger ANOTHER simulate-read for 88888 → toast does NOT
//       re-pop (the Set-based dismissal honors the prior Markera återlämnad).
//   11. Navigate to /competition/:id/hyrbrickor → 88888 visible in the
//       Returned section.
//
// data-testid attributes consumed here:
//   - walkup-modal / walkup-name / walkup-class / walkup-card /
//     walkup-consent / walkup-hired / walkup-hc-phone / walkup-save
//     (Phase 1 + Plan 02-02)
//   - hyrbricka-toast / hyrbricka-return / hyrbricka-dismiss /
//     hyrbricka-contact-phone (Plan 02-05 Task 2)
//   - hyrbrickor-view / hyrbrickor-returned-row (Plan 02-05 Task 3)
//
// Locked by:
// - .planning/phases/02-4-klubbs-mvp/02-05-PLAN.md task 4
// - .planning/phases/02-4-klubbs-mvp/02-RESEARCH.md §"Hyrbricka E2E"

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

interface SetupRes {
  competitionId: string;
  h21Id: string;
}

async function setup(request: import('@playwright/test').APIRequestContext): Promise<SetupRes> {
  // 1) Create competition.
  const created = await request.post(`${BASE}/api/competitions`, {
    data: { name: `Hyrbricka E2E ${Date.now()}`, date: '2026-05-20' },
  });
  expect(created.status()).toBe(201);
  const comp = (await created.json()) as { id: string };
  const competitionId = comp.id;

  // 2) Import CourseData so the modal's class-picker has options.
  const buf = await readFile(COURSEDATA_FIXTURE);
  const cdRes = await request.post(`${BASE}/api/competitions/${competitionId}/import`, {
    multipart: {
      file: { name: 'coursedata.xml', mimeType: 'application/xml', buffer: buf },
    },
  });
  expect(cdRes.status(), `coursedata: ${await cdRes.text()}`).toBe(201);

  // 3) Set active competition.
  const setActive = await request.post(`${BASE}/api/sessions/active-competition`, {
    data: { competition_id: competitionId },
  });
  expect(setActive.status()).toBe(200);

  // 3b) Phase 2.1 race-phase gate (9f5781f): start the race so the
  // hyrbricka finish-readout toast can fire on a simulate-read instead
  // of the read landing as a quiet pre-race identity scan.
  const startRace = await request.post(`${BASE}/api/competitions/${competitionId}/start-race`);
  expect([200, 201]).toContain(startRace.status());

  // 4) Look up H21's class id.
  const classesRes = await request.get(`${BASE}/api/competitions/${competitionId}/classes`);
  const classes = (await classesRes.json()) as { classes: Array<{ id: string; name: string }> };
  const h21 = classes.classes.find((c) => c.name === 'H21') ?? classes.classes[0];
  expect(h21, 'at least one class present').toBeTruthy();
  return { competitionId, h21Id: h21!.id };
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
      // Provide start + finish so the projection lands in OK/MP, not DNF.
      // The Hyrbricka toast itself fires regardless of status.
      start: { seconds_in_half_day: 10 * 3600, half_day: 0, weekday: null },
      finish: { seconds_in_half_day: 10 * 3600 + 150, half_day: 0, weekday: null },
      punches: [
        { control_code: 31, time_ms: 35_000 },
        { control_code: 32, time_ms: 78_000 },
        { control_code: 33, time_ms: 140_000 },
      ],
    },
  });
  expect(res.status(), `simulate-read: ${await res.text()}`).toBe(201);
}

test('hyrbricka full flow: walkup → readout toast → Markera återlämnad → no re-pop → admin view', async ({
  page,
  request,
}) => {
  const { competitionId, h21Id } = await setup(request);

  // ------------------------------------------------------------------------
  // Step 4-5: walk-up flow with Hyrbricka checked + phone filled.
  // ------------------------------------------------------------------------
  await page.goto(`/competition/${competitionId}/readout?walkup=88888`);
  await expect(page.getByTestId('walkup-modal')).toBeVisible({ timeout: 5_000 });

  // Fill the basic form.
  await page.getByTestId('walkup-name').fill('Hyr Runner');
  await page.getByTestId('walkup-class').selectOption(h21Id);

  // Consent: required by D-PRIV-001.
  await page.getByTestId('walkup-consent').check();

  // Check Hyrbricka — the contact fieldset appears.
  await page.getByTestId('walkup-hired').check();
  await expect(page.getByTestId('walkup-hired-fields')).toBeVisible();
  await page.getByTestId('walkup-hc-phone').fill('0701234567');

  // Save; modal closes.
  await page.getByTestId('walkup-save').click();
  await page.waitForURL(new RegExp(`/competition/[^/]+/readout$`), { timeout: 5_000 });
  await expect(page.getByTestId('walkup-modal')).not.toBeVisible();

  // ------------------------------------------------------------------------
  // Step 6: confirm GET /hired-cards shows 88888 as open with phone.
  // ------------------------------------------------------------------------
  const open1 = await request.get(`${BASE}/api/competitions/${competitionId}/hired-cards`);
  expect(open1.status()).toBe(200);
  const list1 = (await open1.json()) as {
    open: Array<{
      card_number: number;
      contact_phone: string | null;
      returned_at_ms: number | null;
    }>;
    returned: Array<{ card_number: number }>;
  };
  const row1 = list1.open.find((r) => r.card_number === 88888);
  expect(row1, 'open hired_cards row for 88888').toBeTruthy();
  expect(row1?.contact_phone).toBe('0701234567');
  expect(row1?.returned_at_ms).toBeNull();

  // ------------------------------------------------------------------------
  // Step 7-8: simulate-read 88888 → HyrbrickaToast appears with phone.
  // ------------------------------------------------------------------------
  await simulateRead(request, competitionId, 88888);
  await expect(page.getByTestId('hyrbricka-toast')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('hyrbricka-contact-phone')).toHaveText(/0701234567/);
  await expect(page.getByTestId('hyrbricka-return')).toBeVisible();

  // ------------------------------------------------------------------------
  // Step 9: click Markera återlämnad → toast disappears AND server has returned_at_ms.
  // ------------------------------------------------------------------------
  await page.getByTestId('hyrbricka-return').click();
  await expect(page.getByTestId('hyrbricka-toast')).not.toBeVisible({ timeout: 5_000 });

  await expect
    .poll(
      async () => {
        const r = await request.get(`${BASE}/api/competitions/${competitionId}/hired-cards`);
        const body = (await r.json()) as {
          open: Array<{ card_number: number }>;
          returned: Array<{ card_number: number; returned_at_ms: number | null }>;
        };
        return body.returned.find((row) => row.card_number === 88888)?.returned_at_ms ?? null;
      },
      { timeout: 5_000 }
    )
    .not.toBeNull();

  // ------------------------------------------------------------------------
  // Step 10: another simulate-read MUST NOT re-pop the toast (Set-based
  // dismissal). Give the WS broadcast time to land; we explicitly check
  // for absence over a short window via poll-style negative assertion.
  // ------------------------------------------------------------------------
  await simulateRead(request, competitionId, 88888);
  // Wait long enough for the readout-refetch + WS dispatch to fire.
  // The toast surface is suppressed by returnedHiredCardNumbers, so it
  // should remain absent. Use a short hard wait (the WS round-trip is
  // <500ms in dev), then assert.
  await page.waitForTimeout(1_000);
  await expect(page.getByTestId('hyrbricka-toast')).not.toBeVisible();

  // ------------------------------------------------------------------------
  // Step 11: admin view shows the card in the Returned section.
  // ------------------------------------------------------------------------
  await page.goto(`/competition/${competitionId}/hyrbrickor`);
  await expect(page.getByTestId('hyrbrickor-view')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('hyrbrickor-returned-row').first()).toBeVisible({
    timeout: 5_000,
  });
  // 88888 is the card we returned; verify its number is on a returned row.
  const returnedRowText = await page.getByTestId('hyrbrickor-returned-row').first().textContent();
  expect(returnedRowText).toContain('88888');
});
