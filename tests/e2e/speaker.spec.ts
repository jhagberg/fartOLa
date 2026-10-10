// Authored for fartola. Not ported from upstream.
//
// Speaker view (todo 2026-10-07-speaker-view). Synthetic competition from
// helpers/speaker-seed.ts: six classes, radio controls 50 and 60.
//
//   1. Six classes at 1920×1080 split 3×2, no name is cut off, DNS/MP
//      and not-started runners are folded away, contrast and target size
//      clean in both modes.
//   2. A radio punch shows up live (WS radio_punch → refetch) in its own
//      class only.

import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { BASE } from './helpers/seed.ts';
import { SPEAKER_CLASSES, seedSpeaker } from './helpers/speaker-seed.ts';

test.describe.configure({ mode: 'serial' });

async function open(page: Page, id: string, classes: number): Promise<void> {
  const board = (await (await fetch(`${BASE}/api/competitions/${id}/speaker`)).json()) as {
    classes: Array<{ class_id: string }>;
  };
  const chosen = board.classes.slice(0, classes).map((c) => c.class_id);
  await page.addInitScript(
    ([k, v]) => localStorage.setItem(k!, v!),
    [`fartola.speaker.${id}`, JSON.stringify(chosen)]
  );
  await page.goto(`/competition/${id}/speaker`);
  await expect(page.getByTestId('spk-panel')).toHaveCount(classes);
}

test('six classes fill a 3×2 grid with whole names, the rest folded away', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const { competitionId: id } = await seedSpeaker(BASE);
  await open(page, id, 6);
  await page.getByTestId('spk-fullscreen').click();

  const grid = page.getByTestId('spk-panels');
  await expect(grid).toHaveAttribute('data-cols', '3');
  await expect(grid).toHaveAttribute('data-rows', '2');

  // Every name renders whole: wrapped if need be, never clipped.
  const cut = await page
    .getByTestId('spk-name')
    .evaluateAll((els) =>
      els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent)
    );
  expect(cut).toEqual([]);

  // Per class: four time rows (finished, two past 60, one past 50); the MP
  // runner and the one starting later are a folded count, not rows.
  const first = page.getByTestId('spk-panel').first();
  await expect(first.getByTestId('spk-row')).toHaveCount(4);
  const folded = first.getByTestId('spk-folded');
  await expect(folded.locator('summary')).toContainText('Ej startat 1');
  await expect(folded.locator('summary')).toContainText('Felstämplad 1');
  await expect(page.getByTestId('spk-event').first()).toBeVisible();

  for (const high of [false, true]) {
    if (high) {
      await page.getByTestId('spk-sun').click();
      await expect(page.locator('html')).toHaveClass(/contrast-high/);
    }
    const result = await new AxeBuilder({ page })
      .withRules(['color-contrast', 'target-size'])
      .analyze();
    const found = result.violations.flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target}`));
    expect(found, `${high ? 'sun' : 'default'}: ${found.join('\n')}`).toEqual([]);
  }
});

test('a radio punch appears live in its own class only', async ({ page }) => {
  test.setTimeout(120_000);
  const { competitionId: id, card } = await seedSpeaker(BASE);
  await open(page, id, 2);
  const [a, b] = [page.getByTestId('spk-panel').nth(0), page.getByTestId('spk-panel').nth(1)];
  await expect(a.getByTestId('spk-row')).toHaveCount(4);
  await expect(b.getByTestId('spk-row')).toHaveCount(4);

  // The first panel is the first class by name. Its runner 3 is past 50
  // only; a passing at 60 puts it on the way in.
  const board = (await (await fetch(`${BASE}/api/competitions/${id}/speaker`)).json()) as {
    classes: Array<{ class_name: string }>;
  };
  const classIndex = SPEAKER_CLASSES.indexOf(board.classes[0]!.class_name);
  const res = await fetch(`${BASE}/api/__dev/simulate-radio`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      competition_id: id,
      card_number: card(classIndex, 3),
      control_code: 60,
      time_ms: Date.now() - 60_000,
    }),
  });
  expect(res.status).toBe(201);

  await expect(a.getByTestId('spk-onway')).toHaveCount(3);
  await expect(b.getByTestId('spk-onway')).toHaveCount(2);
});
