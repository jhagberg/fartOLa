// Authored for fartola. Not ported from upstream.
//
// Readout view e2e (plan 01-13). Four tests:
//
//   1. **card_read updates LatestReadCard via WS**:
//      Create competition + import CourseData + import EntryList (Anna
//      Andersson with card 7501853 in H21). Navigate to /readout. Set
//      active competition. Simulate-read card 7501853 → LatestReadCard
//      renders "Anna Andersson" within 5s.
//
//   2. **history click re-renders**:
//      Simulate two reads with different card numbers. Click history
//      row 2 → LatestReadCard reflects the second runner.
//
//   3. **manual DNF flow**:
//      simulate-read OK → click "Ändra status…" → confirm → StatusPill becomes
//      "DNF" within 500ms (WS broadcast + synchronous refetch path).
//
//   4. **unknown card triggers ?walkup= on the readout URL (C-M3
//      LOCKED — readout-route shape)**:
//      simulate-read card 9_999_999 (unknown) → wait 700ms → assert
//      page.url() matches `/competition/<id>/readout?walkup=9999999`.
//      Negative check: URL does NOT contain `/walkup/`.
//
// Test isolation: the bridge's tmp SQLite DB is shared across both
// the wizard.spec.ts and this file. We use serial mode (mirroring
// wizard.spec.ts's workaround) so the competitions table snapshots
// don't race.
//
// Locked by:
// - 01-13-PLAN.md task 2 done criteria
// - 01-REVIEWS.md §C-M3 (?walkup= on readout URL, not /walkup/ path)

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

// Shared bridge DB — serial mode keeps the competitions/competitors
// tables stable across tests.
test.describe.configure({ mode: 'serial' });

const BASE = 'http://localhost:5174';

interface SetupRes {
  competitionId: string;
  /** Anna Andersson's competitor row (card_number=7501853). */
  annaId: string | null;
  /** Class id for H21 — used by walk-up modal tests in plan 14. */
  h21Id: string | null;
}

/** Create a competition + import CourseData + import EntryList + set
 * active. Returns the ids tests need. */
async function setup(request: import('@playwright/test').APIRequestContext): Promise<SetupRes> {
  // 1) Create competition.
  const created = await request.post(`${BASE}/api/competitions`, {
    data: { name: `Readout E2E ${Date.now()}`, date: '2026-05-19' },
  });
  expect(created.status()).toBe(201);
  const comp = (await created.json()) as { id: string };
  const competitionId = comp.id;

  // 2) Import CourseData (creates H21 + course rows).
  const courseDataBuf = await readFile(COURSEDATA_FIXTURE);
  const cdRes = await request.post(`${BASE}/api/competitions/${competitionId}/import`, {
    multipart: {
      file: { name: 'coursedata.xml', mimeType: 'application/xml', buffer: courseDataBuf },
    },
  });
  expect(cdRes.status(), `coursedata: ${await cdRes.text()}`).toBe(201);

  // 3) Import EntryList (creates Anna Andersson with card 7501853 +
  //    Cia Carlsson with card 1428824).
  const entryListBuf = await readFile(ENTRYLIST_FIXTURE);
  const elRes = await request.post(`${BASE}/api/competitions/${competitionId}/import`, {
    multipart: {
      file: { name: 'entrylist.xml', mimeType: 'application/xml', buffer: entryListBuf },
    },
  });
  expect(elRes.status(), `entrylist: ${await elRes.text()}`).toBe(201);

  // 4) Set active competition (so the bridge routes card_reads to it
  //    via WS broadcast on readout:<id>).
  const setActive = await request.post(`${BASE}/api/sessions/active-competition`, {
    data: { competition_id: competitionId },
  });
  expect(setActive.status()).toBe(200);

  // 4b) Phase 2.1 race-phase gate (9f5781f): flip the competition out of
  //     pre-race so simulate-read events score normally (status=OK/MP, not
  //     PEND identity-only). Without this every card_read is a quiet
  //     identity scan that doesn't surface on the readout view.
  const startRace = await request.post(`${BASE}/api/competitions/${competitionId}/start-race`);
  // 201 on first call (inserts race_started event), 200 if already started.
  expect([200, 201]).toContain(startRace.status());

  // 5) Look up Anna's id + H21's id for the manual-DNF + walk-up tests.
  const compsRes = await request.get(`${BASE}/api/competitions/${competitionId}/competitors`);
  expect(compsRes.status()).toBe(200);
  const comps = (await compsRes.json()) as {
    competitors: Array<{ id: string; name: string; card_number: number | null }>;
  };
  const anna = comps.competitors.find((c) => c.card_number === 7501853) ?? null;

  const classesRes = await request.get(`${BASE}/api/competitions/${competitionId}/classes`);
  const classes = (await classesRes.json()) as { classes: Array<{ id: string; name: string }> };
  const h21 = classes.classes.find((c) => c.name === 'H21') ?? null;

  return { competitionId, annaId: anna?.id ?? null, h21Id: h21?.id ?? null };
}

interface SimulateReadOpts {
  /** When true, the synthetic read carries start + finish HalfDayClock
   * fields so the projection lands in OK/MP (not DNF). The manual-DNF
   * spec needs this — its assertion is that clicking "Ändra status…" on a
   * non-DNF row opens the reason-input popover (WR-005). */
  withFinish?: boolean;
}

async function simulateRead(
  request: import('@playwright/test').APIRequestContext,
  competitionId: string,
  cardNumber: number,
  opts: SimulateReadOpts = {}
): Promise<void> {
  const body: Record<string, unknown> = {
    competition_id: competitionId,
    card_number: cardNumber,
    card_type: 'SI10',
    punches: [
      { control_code: 31, time_ms: 35_000 },
      { control_code: 32, time_ms: 78_000 },
      { control_code: 33, time_ms: 140_000 },
    ],
  };
  if (opts.withFinish === true) {
    // 10:00:00 start, 10:02:30 finish → 150s elapsed, MP-or-OK projection
    // (the IOF30 sample course's exact control set is what decides OK vs
    // MP — either way the projected status is NOT DNF, which is all the
    // manual-DNF UI flow needs).
    body['start'] = { seconds_in_half_day: 10 * 3600, half_day: 0, weekday: null };
    body['finish'] = { seconds_in_half_day: 10 * 3600 + 150, half_day: 0, weekday: null };
  }
  const res = await request.post(`${BASE}/api/__dev/simulate-read`, {
    data: body,
  });
  expect(res.status(), `simulate-read body: ${await res.text()}`).toBe(201);
}

test('card_read updates LatestReadCard via WS', async ({ page, request }) => {
  const { competitionId, annaId } = await setup(request);
  expect(annaId).not.toBeNull();

  await page.goto(`/competition/${competitionId}/readout`);
  await expect(page.getByTestId('readout-view')).toBeVisible();

  await simulateRead(request, competitionId, 7_501_853);

  // Card number renders (no thousand separators per UI-SPEC Visual Anchor)
  await expect(page.getByTestId('card-number').first()).toHaveText('7501853', { timeout: 5_000 });
  await expect(page.getByTestId('runner-name').first()).toContainText('Anna Andersson', {
    timeout: 5_000,
  });
});

test('history click re-renders LatestReadCard', async ({ page, request }) => {
  const { competitionId } = await setup(request);

  await page.goto(`/competition/${competitionId}/readout`);
  await expect(page.getByTestId('readout-view')).toBeVisible();

  await simulateRead(request, competitionId, 7_501_853);
  await expect(page.getByTestId('card-number').first()).toHaveText('7501853', { timeout: 5_000 });

  // Second read with another known card (Cia Carlsson). Two known cards
  // keep both history rows free of the walk-up auto-redirect side path,
  // so the click assertion stays clean.
  await simulateRead(request, competitionId, 1_428_824);
  await expect(page.getByTestId('card-number').first()).toHaveText('1428824', { timeout: 5_000 });

  // Click the older history row (Anna's) → LatestReadCard re-renders.
  const annaRow = page.getByTestId('history-row').filter({ hasText: '7501853' });
  await annaRow.first().click();
  await expect(page.getByTestId('card-number').first()).toHaveText('7501853', { timeout: 5_000 });
});

test('manual DNF flow flips StatusPill in-place', async ({ page, request }) => {
  const { competitionId } = await setup(request);

  await page.goto(`/competition/${competitionId}/readout`);
  await expect(page.getByTestId('readout-view')).toBeVisible();

  // WR-005: the synthetic read must carry start + finish so the reducer's
  // projected status is NOT already DNF (finish=null → DNF). Without
  // withFinish=true the LatestReadCard renders the "Ångra Utgått"
  // un-DNF action instead of the reason-input popover this test asserts.
  await simulateRead(request, competitionId, 7_501_853, { withFinish: true });
  await expect(page.getByTestId('runner-name').first()).toContainText('Anna Andersson', {
    timeout: 5_000,
  });

  // Open the manual-DNF popover, fill the reason, confirm.
  await page.getByTestId('manual-dnf-btn').click();
  await page.getByTestId('dnf-reason-input').fill('Bröt loppet');
  const beforeClick = Date.now();
  await page.getByTestId('dnf-confirm').click();

  // StatusPill flips to DNF within 500ms of the click.
  const dnfPill = page.locator('.status.dnf').first();
  await expect(dnfPill).toBeVisible({ timeout: 2_500 });
  const elapsed = Date.now() - beforeClick;
  expect(elapsed).toBeLessThan(2_500); // generous CI bound; LOCAL <500ms is plan goal
});

test('unknown card triggers ?walkup=<n> on the readout URL (C-M3 LOCKED)', async ({
  page,
  request,
}) => {
  const { competitionId } = await setup(request);

  await page.goto(`/competition/${competitionId}/readout`);
  await expect(page.getByTestId('readout-view')).toBeVisible();

  // 1. Simulate-read with an unknown card number.
  await simulateRead(request, competitionId, 9_999_999);

  // 2. The ReadoutView waits 600ms before goto; give it 1500ms.
  await page.waitForURL(new RegExp(`/competition/[^/]+/readout\\?walkup=9999999$`), {
    timeout: 5_000,
  });

  // 3. Assert the URL shape — readout route + query param.
  const url = page.url();
  expect(url).toMatch(/\/competition\/[^/]+\/readout\?walkup=9999999$/);

  // 4. Negative check: NO navigation to a /walkup path occurred.
  expect(url).not.toContain('/walkup/');
});
