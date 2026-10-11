// tests/e2e/readout-card.spec.ts
// Authored for fartola. Not ported from upstream.
//
// Design lab plan 3, task 2: the readout card and its actions. Print
// feedback (RO-1), safe keyboard shortcuts (RO-2), the status change with a
// real result (RO-6), the cue bar for a pinned older read (RO-9) and the
// dev-only simulate button (RO-4). Synthetic data only.
import { test, expect, type Page } from '@playwright/test';
import { seedCompetition, simulateRead } from './helpers/seed.ts';

const ANNA = 7_501_853;
const CIA = 1_428_824;
const PRINT = '**/api/competitions/*/print-receipt';

async function readout(page: Page, id: string): Promise<void> {
  await page.goto(`/competition/${id}/readout`);
  await expect(page.getByTestId('readout-view')).toBeVisible();
}

/** Mock the print endpoint and record the template of every request. */
async function recordPrints(page: Page): Promise<string[]> {
  const templates: string[] = [];
  await page.route(PRINT, async (route) => {
    templates.push((route.request().postDataJSON() as { template: string }).template);
    await route.fulfill({ status: 201, json: { queued: true, queue_position: 0 } });
  });
  return templates;
}

test.describe('print feedback', () => {
  test('shows Skriver ut… and then Kvittot skrivs ut', async ({ page, request }) => {
    const { competitionId: id } = await seedCompetition(request, { controls: 4 });
    await simulateRead(request, id, ANNA, [31, 32, 33, 34]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route(PRINT, async (route) => {
      await gate;
      await route.fulfill({ status: 201, json: { queued: true, queue_position: 0 } });
    });
    await readout(page, id);
    await expect(page.getByTestId('runner-name')).toHaveText('Anna Andersson');
    const head = page.locator('.receipt-mirror .head h3');
    await expect(head).toHaveText('Kvitto');

    await page.getByTestId('print-btn').click();
    await expect(page.getByText('Skriver ut…')).toBeVisible();
    release();
    await expect(page.getByText('Kvittot skrivs ut')).toBeVisible();
    await expect(page.getByText('Skriver ut…')).toHaveCount(0);
    await expect(head).toHaveText('Kvitto utskrivet');
  });

  test('a failed print says so, offers a retry and claims nothing printed', async ({
    page,
    request,
  }) => {
    const { competitionId: id } = await seedCompetition(request, { controls: 4 });
    await simulateRead(request, id, ANNA, [31, 32, 33, 34]);
    await page.route(PRINT, (route) =>
      route.fulfill({ status: 503, json: { error: 'printer_offline' } })
    );
    await readout(page, id);
    await expect(page.getByTestId('runner-name')).toHaveText('Anna Andersson');

    await page.getByTestId('print-btn').click();
    await expect(page.getByText('Utskriften misslyckades')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Försök igen' })).toBeVisible();
    await expect(page.getByText('Kvitto utskrivet')).toHaveCount(0);
    await expect(page.getByText('Kvittot skrivs ut')).toHaveCount(0);

    await page.unroute(PRINT);
    await recordPrints(page);
    await page.getByRole('button', { name: 'Försök igen' }).click();
    await expect(page.getByText('Kvittot skrivs ut')).toBeVisible();
  });

  test('with no read the print button is disabled and says why', async ({ page, request }) => {
    const { competitionId: id } = await seedCompetition(request, { controls: 4 });
    await readout(page, id);
    const btn = page.getByTestId('print-btn');
    await expect(btn).toBeDisabled();
    await expect(btn).toHaveText('Skriv ut kvitto');
    await expect(page.getByText('Ingen avläsning att skriva ut')).toBeVisible();
  });
});

test.describe('P shortcut', () => {
  /** Run `block` (keys that must not print), then one real P with another
   * template selected, so the only request that may arrive is that one. */
  async function expectNoPrint(
    page: Page,
    id: string,
    block: () => Promise<void>,
    unblock: () => Promise<void> = async () => {}
  ): Promise<void> {
    const templates = await recordPrints(page);
    await readout(page, id);
    await expect(page.getByTestId('runner-name')).toHaveText('Anna Andersson');
    await block();
    await unblock();
    await page.getByTestId('tpl-tab-minimal').click();
    await page.locator('body').press('p');
    await expect.poll(() => templates.includes('minimal')).toBe(true);
    expect(templates).toEqual(['minimal']);
  }

  test('does not print in a focused select', async ({ page, request }) => {
    const { competitionId: id } = await seedCompetition(request, { controls: 4 });
    await simulateRead(request, id, ANNA, [31, 32, 33, 34]);
    await expectNoPrint(page, id, async () => {
      await page.evaluate(() => {
        const s = document.createElement('select');
        s.id = 'probe-select';
        s.innerHTML = '<option>a</option>';
        document.body.append(s);
        s.focus();
      });
      await page.keyboard.press('p');
      await page.evaluate(() => document.getElementById('probe-select')?.remove());
    });
  });

  test('does not print with Ctrl or Meta', async ({ page, request }) => {
    const { competitionId: id } = await seedCompetition(request, { controls: 4 });
    await simulateRead(request, id, ANNA, [31, 32, 33, 34]);
    await expectNoPrint(page, id, async () => {
      await page.keyboard.press('Control+p');
      await page.keyboard.press('Meta+p');
    });
  });

  test('does not print while a dialog is open, focus left outside it', async ({
    page,
    request,
  }) => {
    const { competitionId: id } = await seedCompetition(request, { controls: 4 });
    await simulateRead(request, id, ANNA, [31, 32, 33, 34]);
    await expectNoPrint(
      page,
      id,
      async () => {
        await page.getByTestId('edit-competitor-btn').click();
        await expect(page.locator('[aria-modal="true"]')).toBeVisible();
        await page.keyboard.press('p');
      },
      async () => {
        await page.keyboard.press('Escape');
        await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
      }
    );
  });
});

test.describe('status change', () => {
  test('is called Ändra status… and offers six statuses', async ({ page, request }) => {
    const { competitionId: id } = await seedCompetition(request, { controls: 4 });
    await simulateRead(request, id, ANNA, [31, 32, 33, 34]);
    await readout(page, id);
    await expect(page.getByTestId('manual-dnf-btn')).toHaveText('Ändra status…');
    await page.getByTestId('manual-dnf-btn').click();
    await expect(page.locator('[data-testid^="status-pick-"]')).toHaveCount(6);
  });

  test('a saved status closes the popover and the toast names it', async ({ page, request }) => {
    const { competitionId: id } = await seedCompetition(request, { controls: 4 });
    await simulateRead(request, id, ANNA, [31, 32, 33, 34]);
    await readout(page, id);
    await expect(page.getByTestId('runner-name')).toHaveText('Anna Andersson');
    await page.getByTestId('manual-dnf-btn').click();
    await page.getByTestId('status-pick-DQ').click();
    await page.getByTestId('dnf-confirm').click();
    await expect(page.getByTestId('toast')).toHaveText('Anna Andersson: Diskad');
    await expect(page.getByTestId('dnf-reason-input')).toHaveCount(0);
  });

  test('a failed save keeps the popover, the choice and says why', async ({ page, request }) => {
    const { competitionId: id } = await seedCompetition(request, { controls: 4 });
    await simulateRead(request, id, ANNA, [31, 32, 33, 34]);
    await page.route('**/competitors/*/status', (route) =>
      route.fulfill({ status: 500, json: { error: 'disk_full' } })
    );
    await readout(page, id);
    await expect(page.getByTestId('runner-name')).toHaveText('Anna Andersson');
    await page.getByTestId('manual-dnf-btn').click();
    await page.getByTestId('status-pick-DQ').click();
    await page.getByTestId('dnf-reason-input').fill('Hjälpte annan löpare');
    await page.getByTestId('dnf-confirm').click();

    await expect(page.getByRole('alert').filter({ hasText: 'disk_full' })).toBeVisible();
    await expect(page.getByTestId('dnf-reason-input')).toHaveValue('Hjälpte annan löpare');
    await expect(page.getByTestId('status-pick-DQ')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('toast')).toHaveCount(0);
  });
});

test.describe('a pinned older read', () => {
  test('shows a cue bar, keeps the pinned read on a new read, and returns on request', async ({
    page,
    request,
  }) => {
    const { competitionId: id } = await seedCompetition(request, { controls: 4 });
    await simulateRead(request, id, CIA, [31, 32, 33, 34]);
    await simulateRead(request, id, ANNA, [31, 32, 33, 34]);
    await readout(page, id);
    await expect(page.getByTestId('card-number').first()).toHaveText(String(ANNA));
    await expect(page.getByText('Du tittar på en äldre avläsning.')).toHaveCount(0);

    await page
      .getByTestId('history-row')
      .filter({ hasText: String(CIA) })
      .first()
      .click();
    await expect(page.getByTestId('card-number').first()).toHaveText(String(CIA));
    await expect(page.getByText('Du tittar på en äldre avläsning.')).toBeVisible();

    // A new read arrives: the pinned read stays and the bar stays.
    await simulateRead(request, id, ANNA, [31, 32, 33, 34]);
    await expect(page.getByTestId('history-row')).toHaveCount(3);
    await expect(page.getByTestId('card-number').first()).toHaveText(String(CIA));
    await page.getByRole('button', { name: 'Visa senaste' }).click();
    await expect(page.getByTestId('card-number').first()).toHaveText(String(ANNA));
    await expect(page.getByText('Du tittar på en äldre avläsning.')).toHaveCount(0);
  });
});

test.describe('simulate button', () => {
  const status = (dev: boolean) => ({
    state: 'ready',
    ageDays: 1,
    competitorCount: 1,
    fartola_dev: dev,
  });

  test('is not rendered unless the edge reports dev mode', async ({ page, request }) => {
    const { competitionId: id } = await seedCompetition(request, { controls: 4 });
    await page.route('**/api/eventor/status', (route) =>
      route.fulfill({ status: 200, json: status(false) })
    );
    await readout(page, id);
    await expect(page.getByTestId('latest-read')).toBeVisible();
    await expect(page.getByTestId('simulate-btn')).toHaveCount(0);
  });

  test('is rendered when the edge reports dev mode', async ({ page, request }) => {
    const { competitionId: id } = await seedCompetition(request, { controls: 4 });
    await page.route('**/api/eventor/status', (route) =>
      route.fulfill({ status: 200, json: status(true) })
    );
    await readout(page, id);
    await expect(page.getByTestId('simulate-btn')).toBeVisible();
  });
});
