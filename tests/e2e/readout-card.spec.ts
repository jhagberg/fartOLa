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

    await expect(
      page.getByRole('alert').filter({ hasText: 'Statusen sparades inte.' })
    ).toBeVisible();
    await page.getByText('Visa orsak').click();
    await expect(page.getByText('disk_full')).toBeVisible();
    await expect(page.getByTestId('dnf-reason-input')).toHaveValue('Hjälpte annan löpare');
    await expect(page.getByTestId('status-pick-DQ')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('toast')).toHaveCount(0);
  });
});

test.describe('a pinned older read', () => {
  test('shows a cue bar and returns to the latest on request', async ({ page, request }) => {
    const { competitionId: id } = await seedCompetition(request, { controls: 4 });
    await simulateRead(request, id, CIA, [31, 32, 33, 34]);
    await simulateRead(request, id, ANNA, [31, 32, 33, 34]);
    await readout(page, id);
    await expect(page.getByTestId('card-number').first()).toHaveText(String(ANNA));
    await expect(page.getByText('Du tittar på en äldre avläsning.')).toHaveCount(0);
    // The newest row is the latest read, not an older one.
    await page
      .getByTestId('history-row')
      .filter({ hasText: String(ANNA) })
      .first()
      .click();
    await expect(page.getByText('Du tittar på en äldre avläsning.')).toHaveCount(0);

    await page
      .getByTestId('history-row')
      .filter({ hasText: String(CIA) })
      .first()
      .click();
    await expect(page.getByTestId('card-number').first()).toHaveText(String(CIA));
    await expect(page.getByText('Du tittar på en äldre avläsning.')).toBeVisible();
    await page.getByRole('button', { name: 'Visa senaste' }).click();
    await expect(page.getByTestId('card-number').first()).toHaveText(String(ANNA));
    await expect(page.getByText('Du tittar på en äldre avläsning.')).toHaveCount(0);
  });

  test('a new read takes over and a notice says the pinned read is in the history', async ({
    page,
    request,
  }) => {
    const { competitionId: id } = await seedCompetition(request, { controls: 4 });
    await simulateRead(request, id, CIA, [31, 32, 33, 34]);
    await simulateRead(request, id, ANNA, [31, 32, 33, 34]);
    await readout(page, id);
    await expect(page.getByTestId('card-number').first()).toHaveText(String(ANNA));
    await page
      .getByTestId('history-row')
      .filter({ hasText: String(CIA) })
      .first()
      .click();
    await expect(page.getByTestId('card-number').first()).toHaveText(String(CIA));

    await simulateRead(request, id, ANNA, [31, 32, 33, 34]);
    await expect(page.getByTestId('card-number').first()).toHaveText(String(ANNA));
    await expect(page.getByTestId('toast')).toHaveText(
      'Ny avläsning: Anna Andersson. Den valda avläsningen finns i historiken.'
    );
    await expect(page.getByText('Du tittar på en äldre avläsning.')).toHaveCount(0);
  });
});

test.describe('overlapping prints and the status popover', () => {
  test('a late print result never overwrites another read, and keeps its own failure', async ({
    page,
    request,
  }) => {
    const { competitionId: id } = await seedCompetition(request, { controls: 4 });
    await simulateRead(request, id, CIA, [31, 32, 33, 34]);
    await simulateRead(request, id, ANNA, [31, 32, 33, 34]);
    const gates: Array<(r: { status: number; json: unknown }) => void> = [];
    await page.route(PRINT, async (route) => {
      const res = await new Promise<{ status: number; json: unknown }>((r) => gates.push(r));
      await route.fulfill(res);
    });
    await readout(page, id);
    await expect(page.getByTestId('card-number').first()).toHaveText(String(ANNA));
    await page.getByTestId('print-btn').click(); // print A (Anna), pending
    await page
      .getByTestId('history-row')
      .filter({ hasText: String(CIA) })
      .first()
      .click();
    await page.getByTestId('print-btn').click(); // print B (Cia), pending
    await expect.poll(() => gates.length).toBe(2);
    await expect(page.getByText('Skriver ut…')).toBeVisible();

    gates[0]!({ status: 503, json: { error: 'printer_offline' } }); // A fails late
    await expect(page.getByText('Skriver ut…')).toBeVisible(); // still B's state
    await expect(page.getByText('Utskriften misslyckades')).toHaveCount(0);

    gates[1]!({ status: 201, json: { queued: true, queue_position: 0 } });
    await expect(page.getByText('Kvittot skrivs ut')).toBeVisible();
    await page.getByRole('button', { name: 'Visa senaste' }).click();
    await expect(page.getByText('Utskriften misslyckades')).toBeVisible();
  });

  test('a new read closes an open status popover', async ({ page, request }) => {
    const { competitionId: id } = await seedCompetition(request, { controls: 4 });
    await simulateRead(request, id, CIA, [31, 32, 33, 34]);
    await readout(page, id);
    await expect(page.getByTestId('card-number').first()).toHaveText(String(CIA));
    await page.getByTestId('manual-dnf-btn').click();
    await expect(page.getByTestId('dnf-reason-input')).toBeVisible();
    await simulateRead(request, id, ANNA, [31, 32, 33, 34]);
    await expect(page.getByTestId('card-number').first()).toHaveText(String(ANNA));
    await expect(page.getByTestId('dnf-reason-input')).toHaveCount(0);
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
