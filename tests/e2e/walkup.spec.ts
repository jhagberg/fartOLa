// Authored for fartola. Not ported from upstream.
//
// Walk-up modal + C-M4 consent toast e2e (plan 01-14).
//
//   1. **walk-up creates competitor (overlay on readout — C-M3 LOCKED)**:
//      Navigate to ?walkup=9999999 on the readout URL. Fill name + class.
//      Spara → URL returns to /readout (no query param) AND a new
//      competitor row exists with consent_status='explicit'.
//
//   2. **walk-up validation error**: empty name + Spara → inline error;
//      URL unchanged.
//
//   3. **walk-up cancel returns to readout**: open walkup, click Avbryt
//      → URL is /readout (no walkup param), no competitor created.
//
//   4. **C-M4 consent toast on first card_read for a pending-first-read
//      competitor**: EntryList-imported Anna (consent_status =
//      'pending_first_read'). simulate-read 7501853 → toast visible
//      containing "Anna Andersson". Bekräfta → toast unmounts AND the
//      competitor row's consent_status becomes 'confirmed_on_read'.
//      A second simulate-read of the same card does NOT re-pop the
//      toast (the row is now confirmed).
//
//   5. **C-M4 Avfärda does not flip**: EntryList-imported Cia (1428824)
//      → simulate-read → toast visible → click Avfärda → competitor's
//      consent_status STILL 'pending_first_read'. A second simulate-read
//      of the same card does NOT re-pop the toast (session-local
//      dismissedConsentForCompetitorIds suppresses).
//
//   6. **entered runner with a new card**: the unknown card's modal asks
//      "Är det någon som är anmäld?" first; the entered runner whose course
//      fits is suggested; picking shows the change before it is made; the
//      read attaches without a new read-out; undo gives the old card back.
//
// Test isolation: serial mode (mirrors readout.spec.ts + wizard.spec.ts
// pattern — the bridge's tmp SQLite DB is shared across all e2e files).
//
// Locked by:
// - 01-14-PLAN.md task 1 (walk-up overlay + consent toast tests)
// - 01-REVIEWS.md §C-M3 (walk-up is overlay on readout URL)
// - 01-REVIEWS.md §C-M4 (consent toast surfaces on first card_read)

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

interface SetupRes {
  competitionId: string;
  /** Anna Andersson (card_number=7501853, EntryList consent=pending). */
  annaId: string;
  /** Cia Carlsson (card_number=1428824, EntryList consent=pending). */
  ciaId: string;
  /** H21 class id — used as the walk-up modal's required class. */
  h21Id: string;
}

async function setup(request: import('@playwright/test').APIRequestContext): Promise<SetupRes> {
  // 1) Create competition.
  const created = await request.post(`${BASE}/api/competitions`, {
    data: { name: `Walkup E2E ${Date.now()}`, date: '2026-05-19' },
  });
  expect(created.status()).toBe(201);
  const comp = (await created.json()) as { id: string };
  const competitionId = comp.id;

  // 2) Import CourseData (classes + courses).
  const courseDataBuf = await readFile(COURSEDATA_FIXTURE);
  const cdRes = await request.post(`${BASE}/api/competitions/${competitionId}/import`, {
    multipart: {
      file: { name: 'coursedata.xml', mimeType: 'application/xml', buffer: courseDataBuf },
    },
  });
  expect(cdRes.status(), `coursedata: ${await cdRes.text()}`).toBe(201);

  // 3) Import EntryList (Anna 7501853 + Cia 1428824, both pending consent).
  const entryListBuf = await readFile(ENTRYLIST_FIXTURE);
  const elRes = await request.post(`${BASE}/api/competitions/${competitionId}/import`, {
    multipart: {
      file: { name: 'entrylist.xml', mimeType: 'application/xml', buffer: entryListBuf },
    },
  });
  expect(elRes.status(), `entrylist: ${await elRes.text()}`).toBe(201);

  // 4) Set active competition (bridge routes card_reads here).
  const setActive = await request.post(`${BASE}/api/sessions/active-competition`, {
    data: { competition_id: competitionId },
  });
  expect(setActive.status()).toBe(200);

  // 4b) Phase 2.1 race-phase gate (9f5781f): start the race so simulate-
  // reads surface in the readout history → the consent toast logic in
  // ReadoutView only fires when top.competitor_id is set on the latest
  // history row.
  const startRace = await request.post(`${BASE}/api/competitions/${competitionId}/start-race`);
  expect([200, 201]).toContain(startRace.status());

  // 5) Look up ids.
  const compsRes = await request.get(`${BASE}/api/competitions/${competitionId}/competitors`);
  const comps = (await compsRes.json()) as {
    competitors: Array<{
      id: string;
      name: string;
      card_number: number | null;
      consent_status: string;
    }>;
  };
  const anna = comps.competitors.find((c) => c.card_number === 7501853);
  const cia = comps.competitors.find((c) => c.card_number === 1428824);
  expect(anna, 'Anna seeded with consent_status=pending_first_read').toBeTruthy();
  expect(anna?.consent_status).toBe('pending_first_read');
  expect(cia, 'Cia seeded with consent_status=pending_first_read').toBeTruthy();
  expect(cia?.consent_status).toBe('pending_first_read');

  const classesRes = await request.get(`${BASE}/api/competitions/${competitionId}/classes`);
  const classes = (await classesRes.json()) as { classes: Array<{ id: string; name: string }> };
  const h21 = classes.classes.find((c) => c.name === 'H21');
  expect(h21, 'H21 class seeded from CourseData').toBeTruthy();

  return {
    competitionId,
    annaId: anna!.id,
    ciaId: cia!.id,
    h21Id: h21!.id,
  };
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
  expect(res.status(), `simulate-read body: ${await res.text()}`).toBe(201);
}

async function fetchCompetitor(
  request: import('@playwright/test').APIRequestContext,
  competitionId: string,
  competitorId: string
): Promise<{ id: string; consent_status: string; consent_at_ms: number | null }> {
  const res = await request.get(
    `${BASE}/api/competitions/${competitionId}/competitors/${competitorId}`
  );
  expect(res.status()).toBe(200);
  return (await res.json()) as {
    id: string;
    consent_status: string;
    consent_at_ms: number | null;
  };
}

test('walk-up creates competitor (overlay on readout — C-M3 LOCKED)', async ({ page, request }) => {
  const { competitionId, h21Id } = await setup(request);

  // Navigate directly to the readout URL with the walkup query param.
  // This mirrors the production trigger (ReadoutView's WS handler appends
  // ?walkup=<n> on an unknown card_read).
  await page.goto(`/competition/${competitionId}/readout?walkup=9999999`);

  // Modal is visible AS AN OVERLAY on the readout route.
  await expect(page.getByTestId('walkup-modal')).toBeVisible({ timeout: 5_000 });

  // Negative check: URL stays on /readout (no /walkup/ route).
  const startUrl = page.url();
  expect(startUrl).toMatch(/\/competition\/[^/]+\/readout\?walkup=9999999$/);
  expect(startUrl).not.toContain('/walkup/');

  // First "Är det någon som är anmäld?" — Erik is not entered.
  await expect(page.getByTestId('entered-step')).toBeVisible();
  await page.getByTestId('walkup-not-entered').click();
  await expect(page.getByRole('heading', { name: 'Direktanmälan' })).toBeVisible();

  await page.getByTestId('walkup-name').fill('Erik Eriksson');
  // Klubb is optional; leave blank to also cover the null path.
  await page.getByTestId('walkup-class').selectOption(h21Id);
  // Bricka pre-filled from ?walkup=9999999; no edit needed.
  // Consent starts unticked (audit WA-2, 2026-10-10).
  await page.getByTestId('walkup-consent').check();

  await page.getByTestId('walkup-save').click();

  // URL returns to /readout (no walkup query param).
  await page.waitForURL(new RegExp(`/competition/[^/]+/readout$`), { timeout: 5_000 });

  // Modal unmounts.
  await expect(page.getByTestId('walkup-modal')).not.toBeVisible();

  // Server-side: a new competitor with consent_status='explicit' exists.
  const listRes = await request.get(`${BASE}/api/competitions/${competitionId}/competitors`);
  const list = (await listRes.json()) as {
    competitors: Array<{ name: string; card_number: number | null; consent_status: string }>;
  };
  const erik = list.competitors.find((c) => c.card_number === 9999999);
  expect(erik, 'Erik created via walk-up').toBeTruthy();
  expect(erik?.name).toBe('Erik Eriksson');
  expect(erik?.consent_status).toBe('explicit');
});

test('walk-up with empty name shows inline error and stays open', async ({ page, request }) => {
  const { competitionId, h21Id } = await setup(request);
  await page.goto(`/competition/${competitionId}/readout?walkup=9999991`);
  await expect(page.getByTestId('walkup-modal')).toBeVisible();
  await page.getByTestId('walkup-not-entered').click();

  // Class selected but name empty → Save click surfaces inline error.
  await page.getByTestId('walkup-class').selectOption(h21Id);
  await page.getByTestId('walkup-save').click();

  // Modal stays open; error is visible.
  await expect(page.getByTestId('walkup-modal')).toBeVisible();
  await expect(page.getByTestId('walkup-error')).toBeVisible();
  // URL unchanged.
  expect(page.url()).toMatch(/\?walkup=9999991$/);
});

test('walk-up Avbryt closes overlay without POST', async ({ page, request }) => {
  const { competitionId } = await setup(request);
  await page.goto(`/competition/${competitionId}/readout?walkup=9999992`);
  await expect(page.getByTestId('walkup-modal')).toBeVisible();

  await page.getByTestId('walkup-cancel').click();

  await page.waitForURL(new RegExp(`/competition/[^/]+/readout$`), { timeout: 5_000 });
  await expect(page.getByTestId('walkup-modal')).not.toBeVisible();

  // No competitor created for card 9999992.
  const listRes = await request.get(`${BASE}/api/competitions/${competitionId}/competitors`);
  const list = (await listRes.json()) as {
    competitors: Array<{ card_number: number | null }>;
  };
  expect(list.competitors.find((c) => c.card_number === 9999992)).toBeUndefined();
});

test('entered runner with a new card: pick, card replaced, result attached; undo restores the old card', async ({
  page,
  request,
}) => {
  const { competitionId, annaId } = await setup(request);
  const countBefore = (
    (await (await request.get(`${BASE}/api/competitions/${competitionId}/competitors`)).json()) as {
      competitors: unknown[];
    }
  ).competitors.length;

  // Anna (entered with 7501853) runs Bana 1 with card 8800001.
  const read = await request.post(`${BASE}/api/__dev/simulate-read`, {
    data: {
      competition_id: competitionId,
      card_number: 8_800_001,
      card_type: 'SI10',
      punches: [31, 32, 33, 34].map((c, i) => ({
        control_code: c,
        time_ms: 36_000_000 + 60_000 * (i + 1),
      })),
      start: { half_day: 0, seconds_in_half_day: 36_000, weekday: null },
      finish: { half_day: 0, seconds_in_half_day: 37_800, weekday: null },
    },
  });
  expect(read.status(), await read.text()).toBe(201);

  await page.goto(`/competition/${competitionId}/readout?walkup=8800001`);
  await expect(page.getByTestId('walkup-modal')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('heading', { name: 'Är det någon som är anmäld?' })).toBeVisible();
  const first = page.getByTestId('entered-suggestion').first();
  await expect(first).toContainText('Anna');
  await first.click();
  await expect(page.getByTestId('entered-confirm')).toContainText('7501853 → 8800001');
  await page.getByTestId('entered-save').click();

  await page.waitForURL(new RegExp(`/competition/[^/]+/readout$`), { timeout: 5_000 });
  await expect(page.getByTestId('card-rebind-notice')).toContainText(
    'Bricka bytt för Anna Andersson: 7501853 → 8800001'
  );

  // One competitor (no duplicate); the read is Anna's without a new read-out.
  const after = (await (
    await request.get(`${BASE}/api/competitions/${competitionId}/competitors`)
  ).json()) as { competitors: Array<{ id: string; card_number: number | null }> };
  expect(after.competitors.length).toBe(countBefore);
  expect(after.competitors.find((c) => c.id === annaId)?.card_number).toBe(8_800_001);
  await expect
    .poll(async () => {
      const r = (await (
        await request.get(`${BASE}/api/competitions/${competitionId}/readout`)
      ).json()) as {
        history: Array<{ card_number: number; competitor_id: string | null; status: string }>;
        pending_unknown_cards: number[];
      };
      const row = r.history.find((h) => h.card_number === 8_800_001);
      return [row?.competitor_id, row?.status, r.pending_unknown_cards.includes(8_800_001)];
    })
    .toEqual([annaId, 'OK', false]);

  // Undo: Anna has 7501853 again and the read is an unknown card again.
  await page.getByTestId('card-rebind-undo').click();
  await expect(page.getByTestId('card-rebind-notice')).toContainText('Bytet ångrat');
  const undone = await fetchCompetitor(request, competitionId, annaId);
  expect((undone as unknown as { card_number: number }).card_number).toBe(7_501_853);
  await expect
    .poll(async () => {
      const r = (await (
        await request.get(`${BASE}/api/competitions/${competitionId}/readout`)
      ).json()) as { pending_unknown_cards: number[] };
      return r.pending_unknown_cards.includes(8_800_001);
    })
    .toBe(true);
});

test('C-M4 consent toast on first card_read for pending competitor', async ({ page, request }) => {
  const { competitionId, annaId } = await setup(request);

  await page.goto(`/competition/${competitionId}/readout`);
  await expect(page.getByTestId('readout-view')).toBeVisible();

  await simulateRead(request, competitionId, 7_501_853);

  // Toast surfaces within 2s (WS round-trip + refetch).
  const toast = page.getByTestId('consent-confirmation-toast');
  await expect(toast).toBeVisible({ timeout: 5_000 });
  await expect(toast).toContainText('Anna Andersson');

  // Confirm → toast unmounts within ~500ms.
  await page.getByTestId('consent-toast-confirm').click();
  await expect(toast).not.toBeVisible({ timeout: 2_000 });

  // Server-side: consent_status flipped to 'confirmed_on_read'.
  const after = await fetchCompetitor(request, competitionId, annaId);
  expect(after.consent_status).toBe('confirmed_on_read');
  expect(after.consent_at_ms).not.toBeNull();

  // Second simulate-read for the SAME card does not re-pop the toast.
  await simulateRead(request, competitionId, 7_501_853);
  // Negative-timeout assertion: give the toast 1s to (incorrectly) appear.
  await page.waitForTimeout(1_000);
  await expect(toast).not.toBeVisible();
});

test('C-M4 Avfärda does not flip consent_status; toast does not re-pop in same session', async ({
  page,
  request,
}) => {
  const { competitionId, ciaId } = await setup(request);

  await page.goto(`/competition/${competitionId}/readout`);
  await expect(page.getByTestId('readout-view')).toBeVisible();

  await simulateRead(request, competitionId, 1_428_824);

  const toast = page.getByTestId('consent-confirmation-toast');
  await expect(toast).toBeVisible({ timeout: 5_000 });
  await expect(toast).toContainText('Cia');

  await page.getByTestId('consent-toast-dismiss').click();
  await expect(toast).not.toBeVisible({ timeout: 2_000 });

  // Server-side: consent_status STILL 'pending_first_read'.
  const after = await fetchCompetitor(request, competitionId, ciaId);
  expect(after.consent_status).toBe('pending_first_read');

  // Second simulate-read of the SAME card does not re-pop the toast
  // (session-local dismissedConsentForCompetitorIds suppresses).
  await simulateRead(request, competitionId, 1_428_824);
  await page.waitForTimeout(1_000);
  await expect(toast).not.toBeVisible();
});
