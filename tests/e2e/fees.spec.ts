// Authored for fartola. Not ported from upstream.
//
// SOFT TR 4.12.4, TR 4.12.6 end to end: the organiser sets the card fee and
// a class fee with a surcharge in Tävlingsinfo; the walk-up form shows what
// the runner pays (class fee + capped surcharge + card rental); the
// Hyrbrickor view shows the rental fee; the IOF ResultList carries the fees.

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

test('fees: set in Tävlingsinfo, shown at walk-up and in Hyrbrickor, exported', async ({
  page,
  request,
}) => {
  // A competition today (a walk-up, not a late entry) with H21 as senior.
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
  const created = await request.post(`${BASE}/api/competitions`, {
    data: { name: `Avgifter E2E ${Date.now()}`, date: today },
  });
  expect(created.status()).toBe(201);
  const competitionId = ((await created.json()) as { id: string }).id;
  const cd = await request.post(`${BASE}/api/competitions/${competitionId}/import`, {
    multipart: {
      file: {
        name: 'coursedata.xml',
        mimeType: 'application/xml',
        buffer: await readFile(COURSEDATA_FIXTURE),
      },
    },
  });
  expect(cd.status(), await cd.text()).toBe(201);
  const classes = (
    (await (await request.get(`${BASE}/api/competitions/${competitionId}/classes`)).json()) as {
      classes: Array<{ id: string; name: string }>;
    }
  ).classes;
  const h21 = classes.find((c) => c.name === 'H21')!;
  const kinds = await request.put(`${BASE}/api/competitions/${competitionId}/classes/kinds`, {
    data: { items: [{ class_id: h21.id, class_kind: 'senior', age_class: 21 }] },
  });
  expect(kinds.status()).toBe(200);

  // 1) Tävlingsinfo: card fee 30, H21 180 kr with a 50 % surcharge.
  await page.goto(`/competition/${competitionId}/info`);
  await expect(page.getByTestId('fees-panel')).toBeVisible();
  await page.getByTestId('fees-card-fee').fill('30');
  await page.getByTestId('fees-card-fee').blur();
  await page.getByLabel('Avgift för H21 i kronor').fill('180');
  await page.getByLabel('Avgift för H21 i kronor').blur();
  await page.getByLabel('Tillägg för H21 i procent').fill('50');
  await page.getByLabel('Tillägg för H21 i procent').blur();
  await expect
    .poll(async () => {
      const f = (await (
        await request.get(`${BASE}/api/competitions/${competitionId}/fees`)
      ).json()) as { card_fee: number; classes: Array<{ class_id: string; late_fee_pct: number }> };
      return [f.card_fee, f.classes.find((c) => c.class_id === h21.id)?.late_fee_pct];
    })
    .toEqual([30, 50]);
  // SOFT's cap for an adult age class on the competition day.
  await expect(
    page.locator(`[data-testid="fees-row"][data-class-id="${h21.id}"] [data-testid="fees-cap"]`)
  ).toHaveText('Högst 100 % på tävlingsdagen');

  // 2) Walk-up with a hired card: 180 + 90 + 30.
  await page.goto(`/competition/${competitionId}/readout?walkup=88771`);
  await page.getByTestId('walkup-name').fill('Eva Ek');
  await page.getByTestId('walkup-class').selectOption(h21.id);
  await expect(page.getByTestId('walkup-fee')).toContainText('Att betala: 270 kr');
  await page.getByTestId('walkup-hired').check();
  await page.getByTestId('walkup-hc-phone').fill('0701234567');
  await expect(page.getByTestId('walkup-fee')).toContainText('Att betala: 300 kr');
  await page.getByTestId('walkup-consent').check();
  await page.getByTestId('walkup-save').click();
  await expect(page.getByTestId('walkup-modal')).not.toBeVisible();

  // 3) Hyrbrickor shows the rental fee.
  await page.goto(`/competition/${competitionId}/hyrbrickor`);
  await expect(page.getByTestId('hyrbrickor-row-fee')).toHaveText('Brickhyra 30 kr');

  // 4) The ResultList carries the fees (after a read-out in the race, so
  // she is in it).
  await request.post(`${BASE}/api/competitions/${competitionId}/start-race`);
  const read = await request.post(`${BASE}/api/__dev/simulate-read`, {
    data: {
      competition_id: competitionId,
      card_number: 88771,
      card_type: 'SI10',
      start: { seconds_in_half_day: 10 * 3600, half_day: 0, weekday: null },
      finish: { seconds_in_half_day: 10 * 3600 + 150, half_day: 0, weekday: null },
      punches: [],
    },
  });
  expect(read.status(), await read.text()).toBe(201);
  await expect
    .poll(async () =>
      (await request.get(`${BASE}/api/competitions/${competitionId}/export?format=iof30`)).text()
    )
    .toMatch(/<Fee type="Late">[\s\S]*?<Amount currency="SEK">90<\/Amount>/);
  const xml = await (
    await request.get(`${BASE}/api/competitions/${competitionId}/export?format=iof30`)
  ).text();
  expect(xml).toMatch(/<Fee type="Normal">[\s\S]*?<Amount currency="SEK">180<\/Amount>/);
  expect(xml).toMatch(/<Service type="RentalCard">/);
});
