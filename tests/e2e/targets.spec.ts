// tests/e2e/targets.spec.ts
// Authored for fartola. Not ported from upstream.
//
// ADR-0016 rule 7: touch targets at least 44 px. Measures every visible
// button, link, input and select on the frame and the readout, including
// the opened manual-status picker and the start-race confirmation.
// Visually hidden elements (the skip link until focused) are not targets.

import { test, expect, type Page } from '@playwright/test';
import { seedCompetition, simulateRead, BASE } from './helpers/seed.ts';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { longCourseXml } from './helpers/long-course.ts';

test.describe.configure({ mode: 'serial' });

async function smallTargets(page: Page): Promise<string[]> {
  return page.$$eval(
    'button, a[href], input:not([type=checkbox]):not([type=radio]), select, [role="button"]',
    (els) =>
      els
        .filter((e) => {
          const r = e.getBoundingClientRect();
          const style = getComputedStyle(e);
          const shown = r.width > 0 && r.height > 0 && style.visibility !== 'hidden';
          const onScreen =
            r.bottom > 0 && r.right > 0 && r.top < innerHeight * 3 && r.left < innerWidth;
          return shown && onScreen && !e.closest('.skip-link') && Math.round(r.height) < 44;
        })
        .map(
          (e) =>
            `${e.tagName.toLowerCase()} "${(e.textContent ?? '').trim().slice(0, 30)}" ${Math.round(e.getBoundingClientRect().height)}px`
        )
  );
}

test('frame and readout targets are at least 44 px', async ({ page, request }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const { competitionId } = await seedCompetition(request, { controls: 8 });
  await page.goto(`/competition/${competitionId}/readout`);
  await simulateRead(request, competitionId, 7_501_853, [31, 32, 33, 34, 35, 36, 37, 38]);
  await expect(page.getByTestId('print-btn')).toBeVisible({ timeout: 5_000 });
  expect(await smallTargets(page)).toEqual([]);

  await page.getByTestId('manual-dnf-btn').click();
  await expect(page.getByTestId('dnf-reason-input')).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);
});

test('start-race confirmation targets are at least 44 px', async ({ page, request }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const created = await request.post(`${BASE}/api/competitions`, {
    data: { name: `Designlabb ${Date.now()}`, date: '2026-10-09' },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const entrylist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../apps/edge/test/fixtures/iof30-entrylist-sample.xml'
  );
  for (const [name, buffer] of [
    ['coursedata.xml', Buffer.from(longCourseXml(8))],
    ['entrylist.xml', await readFile(entrylist)],
  ] as const) {
    const res = await request.post(`${BASE}/api/competitions/${id}/import`, {
      multipart: { file: { name, mimeType: 'application/xml', buffer } },
    });
    expect(res.status(), await res.text()).toBe(201);
  }
  const active = await request.post(`${BASE}/api/sessions/active-competition`, {
    data: { competition_id: id },
  });
  expect(active.status()).toBe(200);

  await page.goto(`/competition/${id}/readout`);
  await page.getByTestId('start-race-btn').click();
  await expect(page.getByTestId('start-race-cancel')).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);
});
