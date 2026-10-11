// tests/e2e/helpers/edit-runner.ts
// Authored for fartola. Not ported from upstream.
//
// The edit dialog's "Start och stämplingar" block: seeded reads and the
// floor/a11y states. Synthetic data only. Competition clock is CEST (+2 h),
// so a drawn start of 09:57:00 local is 07:57Z.
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { BASE, seedCompetition, simulateRead } from './seed.ts';
import { openRunners, seedRunners } from './runners.ts';

/** The latest 10:00:00 on the +2 h competition clock the edge would place a
 * start punch on for a read made now (not after the read, 1 h of skew). */
function startPunchEpoch(): number {
  const day = 86_400_000;
  const off = 2 * 3_600_000;
  const ref = Date.now() + 3_600_000;
  const p = Math.floor((ref + off) / day) * day + 10 * 3_600_000 - off;
  return p > ref ? p - day : p;
}

/** Anna (H21, 31–36) read with 35 missing: start punch 10:00:00, finish
 * 10:10:00. She is drawn `lateSec` seconds before the start punch (180 gives
 * 09:57:00), or has no drawn start when null. */
export async function seedAnnaMispunch(
  request: APIRequestContext,
  lateSec: number | null
): Promise<{ id: string; annaId: string }> {
  const { competitionId: id } = await seedCompetition(request, { controls: 6 });
  const list = (await (await request.get(`${BASE}/api/competitions/${id}/competitors`)).json()) as {
    competitors: Array<{ id: string; name: string }>;
  };
  const annaId = list.competitors.find((c) => c.name.startsWith('Anna'))!.id;
  if (lateSec !== null) {
    const patch = await request.patch(
      `${BASE}/api/competitions/${id}/competitors/${annaId}/start-time`,
      { data: { start_time_ms: startPunchEpoch() - lateSec * 1000 } }
    );
    expect(patch.status(), await patch.text()).toBeLessThan(300);
  }
  await simulateRead(request, id, 7_501_853, [31, 32, 33, 34, 36], { finish: 10 * 3600 + 600 });
  return { id, annaId };
}

export async function openEditFor(page: Page, id: string, name: string): Promise<void> {
  await openRunners(page, id);
  await page.getByTestId('runners-row').filter({ hasText: name }).click();
  await expect(page.getByTestId('edit-read')).toBeVisible();
}

/** The block with a mispunch (35 saknas), the splits, a drawn start with a
 * start punch, "Sen start" and the finish and read lines. */
export async function prepareEditReadMispunch(
  page: Page,
  request: APIRequestContext
): Promise<void> {
  const { id } = await seedAnnaMispunch(request, 180);
  await openEditFor(page, id, 'Anna');
  const block = page.getByTestId('edit-read');
  await expect(block.locator('[data-testid=punch-grid] [data-state=miss]')).toContainText(
    'saknas',
    {
      timeout: 20_000,
    }
  );
  await expect(block.getByTestId('splits-table')).toBeVisible();
  await expect(block.getByTestId('edit-read-start')).toContainText('Lottad starttid 09:57:00');
  await expect(block.getByTestId('edit-read-start')).toContainText('Startstämpling 10:00:00');
  await expect(block.getByTestId('edit-read-from')).toBeVisible();
  await expect(block.getByTestId('edit-read-late')).toContainText('Sen start +3:00');
  await expect(block.getByTestId('edit-read-finish')).toHaveText('10:10:00');
  await expect(block.getByTestId('edit-read-readat')).toBeVisible();
  await expect(block.getByTestId('edit-read-status')).toContainText('Felstämplad');
}

/** The block when the fetch failed (only the block's own request): the
 * message with its retry, the card and the rental line. */
export async function prepareEditReadError(page: Page, request: APIRequestContext): Promise<void> {
  const { id } = await seedRunners(request);
  let failed = false;
  await page.route('**/corrections', async (route) => {
    if (failed) return route.continue();
    failed = true;
    await route.fulfill({ status: 500, json: { error: 'boom' } });
  });
  await openEditFor(page, id, 'Hyra');
  const block = page.getByTestId('edit-read');
  await expect(block.getByTestId('edit-read-error')).toContainText(
    'Kunde inte hämta stämplingarna',
    {
      timeout: 20_000,
    }
  );
  await expect(block.getByRole('button', { name: 'Försök igen' })).toBeVisible();
  await expect(block.getByTestId('edit-read-card')).toContainText('88001');
  await expect(block.getByTestId('edit-read-hire')).toContainText('Hyrbricka');
}
