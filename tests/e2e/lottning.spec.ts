// Authored for fartola. Not ported from upstream.
//
// Lottning e2e (Phase 2.2 M1 UI): a draw shows what it will do and what it
// did, and is undone whole from the history (ADR-0016 rules 1 and 2); a
// pursuit refused for an unconfirmed class kind is confirmed in place and
// then drawn from an uploaded day-1 ResultList; class kinds and the level
// are set on the info page.
//
// Shares the tmp DB with the other specs; every test makes its own
// competition from the synthetic IOF fixtures (H21 × 2, D21 × 1).

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { useDrawnStarts } from './helpers/seed.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../../apps/edge/test/fixtures');

test.describe.configure({ mode: 'serial' });

const BASE = 'http://localhost:5174';

async function setupCompetition(request: APIRequestContext): Promise<string> {
  const created = await request.post(`${BASE}/api/competitions`, {
    data: { name: `Lottning E2E ${Date.now()}`, date: '2026-10-08' },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  for (const file of ['iof30-coursedata-sample.xml', 'iof30-entrylist-sample.xml']) {
    const res = await request.post(`${BASE}/api/competitions/${id}/import`, {
      multipart: {
        file: {
          name: file,
          mimeType: 'application/xml',
          buffer: await readFile(path.join(FIXTURES, file)),
        },
      },
    });
    expect(res.status(), `${file}: ${await res.text()}`).toBe(201);
  }
  await useDrawnStarts(request, id);
  return id;
}

test('a draw says what it will do and did, and is undone whole from the history', async ({
  page,
  request,
}) => {
  const id = await setupCompetition(request);
  await page.goto(`/competition/${id}/lottning`);
  await expect(page.getByTestId('lottning-view')).toBeVisible();
  await page.getByTestId('lottning-class-select').selectOption({ label: 'H21' });
  await expect(page.getByTestId('lottning-preview')).toHaveText('2 löpare i H21 får ny starttid.');

  await page.getByTestId('lottning-draw-btn').click();
  await expect(page.getByTestId('lottning-done')).toHaveText(
    'Klart: 2 löpare i H21 fick starttid.'
  );
  await expect(page.getByTestId('lottning-row')).toHaveCount(2);

  const latest = page.getByTestId('history-row').first();
  await expect(latest).toContainText('Lottning');
  await expect(latest).toContainText('H21');
  await latest.getByTestId('history-undo').click();
  await expect(page.getByTestId('history-done')).toHaveText(
    'Ångrat: 2 löpare fick tillbaka sin tidigare starttid.'
  );
  await expect(page.getByTestId('lottning-empty')).toBeVisible();
  await expect(page.getByTestId('history-row').nth(1).getByTestId('history-undone')).toHaveText(
    'Ångrad'
  );
});

test('a pursuit refused for an unconfirmed class kind is confirmed in place, then drawn from day 1', async ({
  page,
  request,
}) => {
  const id = await setupCompetition(request);
  await page.goto(`/competition/${id}/lottning`);
  await page.getByTestId('lottning-class-select').selectOption({ label: 'H21' });
  await expect(page.getByTestId('lottning-class-kind')).toContainText('inte bekräftad');
  await page.getByTestId('lottning-mode-select').selectOption('Pursuit');
  await expect(page.getByTestId('pursuit-results-status')).toHaveText(
    'Ingen resultatlista från förra etappen är inläst för H21.'
  );
  await page.getByTestId('lottning-draw-btn').click();

  await expect(page.getByTestId('lottning-refusal')).toContainText(
    'Klasstypen för H21 är bara gissad från klassnamnet.'
  );
  await page.getByTestId('class-kind-confirm').click();
  await expect(page.getByTestId('lottning-done')).toHaveText(
    'Klasstypen är sparad. Tryck på Lotta igen.'
  );
  await expect(page.getByTestId('lottning-class-kind')).toHaveAttribute('data-status', 'operator');

  // Day 1 (SOFT TR 7.4.1): Anna OK, Bo mispunched, so Bo restarts.
  await page
    .getByTestId('pursuit-results-file')
    .setInputFiles(path.join(FIXTURES, 'iof30-resultlist-expected.xml'));
  await page.getByTestId('pursuit-results-upload').click();
  await expect(page.getByTestId('pursuit-results-done')).toContainText(
    'Resultat i filen: 3. Matchade löpare: 3.'
  );
  await expect(page.getByTestId('pursuit-results-status')).toHaveText(
    'Inläst för H21: 2 resultat från förra etappen, varav 1 godkända.'
  );
  await page.getByTestId('lottning-draw-btn').click();
  await expect(page.getByTestId('lottning-done')).toContainText(
    'I omstarten: 1. Utan resultat från förra etappen: 0.'
  );
});

test('class kinds and the competition level are set on the info page', async ({
  page,
  request,
}) => {
  const id = await setupCompetition(request);
  await page.goto(`/competition/${id}/info`);
  await expect(page.getByTestId('class-kinds-unconfirmed')).toContainText(
    'Klasser utan bekräftad klasstyp: 2.'
  );
  await page.getByTestId('class-kinds-confirm-all').click();
  await expect(page.getByTestId('class-kinds-all-confirmed')).toBeVisible();

  await page.getByTestId('info-level').selectOption('niva1');
  await expect(page.getByTestId('info-level-note')).toHaveText('Sparat');
  await page.reload();
  await expect(page.getByTestId('info-level')).toHaveValue('niva1');
});

test('SOFT TR 7.5.4: bibs are numbered in start order, changed by hand and shown in Anmälda', async ({
  page,
  request,
}) => {
  const id = await setupCompetition(request);
  await page.goto(`/competition/${id}/lottning`);
  await page.getByTestId('lottning-class-select').selectOption({ label: 'H21' });
  await page.getByTestId('lottning-draw-btn').click();
  await expect(page.getByTestId('lottning-row')).toHaveCount(2);

  await page.getByText('Fler val').click();
  await page.getByTestId('lottning-bib-base').fill('101');
  await page.getByTestId('lottning-bibs-assign').click();
  await expect(page.getByTestId('lottning-done')).toHaveText(
    'Klart: 2 löpare fick startnummer, 101 och uppåt.'
  );
  await expect(page.getByTestId('lottning-bib')).toHaveText(['101', '102']);

  await page.getByTestId('lottning-edit-time-btn').first().click();
  await page.getByTestId('lottning-edit-bib-input').fill('150');
  await page.getByTestId('lottning-save-time').click();
  await expect(page.getByTestId('lottning-bib')).toHaveText(['150', '102']);

  // Anmälda sorts by name, and which runner got 150 depends on the draw.
  await page.goto(`/competition/${id}/runners`);
  await expect(page.getByTestId('runners-bib')).toHaveCount(2);
  const bibs = await page.getByTestId('runners-bib').allInnerTexts();
  expect(bibs.sort()).toEqual(['Startnr 102', 'Startnr 150']);
});

async function classIds(page: Page, id: string): Promise<Record<string, string>> {
  const res = await page.request.get(`${BASE}/api/competitions/${id}/classes`);
  const { classes } = (await res.json()) as { classes: Array<{ id: string; name: string }> };
  return Object.fromEntries(classes.map((c) => [c.name, c.id]));
}

test.describe('max time per class (LO-1)', () => {
  test('the field shows the stored value for the chosen class, and clearing says so', async ({
    page,
    request,
  }) => {
    const id = await setupCompetition(request);
    await page.goto(`/competition/${id}/lottning`);
    await page.getByTestId('lottning-class-select').selectOption({ label: 'H21' });
    await page.getByTestId('lottning-max-time').fill('60:00');
    await page.getByTestId('lottning-max-time-save').click();
    await expect(page.getByText('Sparat')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('lottning-view')).toBeVisible();
    await page.getByTestId('lottning-class-select').selectOption({ label: 'D21' });
    await expect(page.getByTestId('lottning-max-time')).toHaveValue('');
    await page.getByTestId('lottning-class-select').selectOption({ label: 'H21' });
    await expect(page.getByTestId('lottning-max-time')).toHaveValue('60:00');

    await page.getByTestId('lottning-max-time').fill('');
    await page.getByTestId('lottning-max-time-save').click();
    await expect(page.getByText('Ingen avvikande maxtid')).toBeVisible();
    await page.reload();
    await page.getByTestId('lottning-class-select').selectOption({ label: 'H21' });
    await expect(page.getByTestId('lottning-max-time')).toHaveValue('');
  });

  test('a slow answer for the old class does not land in the field', async ({ page, request }) => {
    const id = await setupCompetition(request);
    const ids = await classIds(page, id);
    for (const [name, sec] of [
      ['H21', 3600],
      ['D21', 1800],
    ] as const) {
      const res = await request.patch(`${BASE}/api/competitions/${id}/classes/${ids[name]}`, {
        data: { maxTimeSec: sec },
      });
      expect(res.status()).toBe(200);
    }
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route(`**/api/competitions/${id}/lottning/${ids['D21']}`, async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto(`/competition/${id}/lottning`);
    await page.getByTestId('lottning-class-select').selectOption({ label: 'H21' });
    await expect(page.getByTestId('lottning-max-time')).toHaveValue('60:00');
    await page.getByTestId('lottning-class-select').selectOption({ label: 'D21' });
    await page.getByTestId('lottning-class-select').selectOption({ label: 'H21' });
    await expect(page.getByTestId('lottning-max-time')).toHaveValue('60:00');
    const stale = page.waitForResponse(`**/api/competitions/${id}/lottning/${ids['D21']}`);
    release();
    // Let the page process the old class's answer before looking again.
    await (await stale).finished();
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    );
    await expect(page.getByTestId('lottning-max-time')).toHaveValue('60:00');
  });

  test('a failed save says so next to the field', async ({ page, request }) => {
    const id = await setupCompetition(request);
    await page.goto(`/competition/${id}/lottning`);
    await expect(page.getByTestId('lottning-draw-btn')).toBeEnabled();
    await page.route(`**/api/competitions/${id}/classes/*`, (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 500, json: { error: 'boom' } })
        : route.continue()
    );
    await page.getByTestId('lottning-max-time').fill('45:00');
    await page.getByTestId('lottning-max-time-save').click();
    await expect(page.getByText('Maxtiden sparades inte. Försök igen.')).toBeVisible();
  });
});

for (const bad of ['abc', '60', '0:00', '1:99', '-5:00']) {
  test(`an entry that is not a max time ("${bad}") is refused and sends nothing (LO-1)`, async ({
    page,
    request,
  }) => {
    const id = await setupCompetition(request);
    await page.goto(`/competition/${id}/lottning`);
    await expect(page.getByTestId('lottning-draw-btn')).toBeEnabled();
    let patches = 0;
    await page.route(`**/api/competitions/${id}/classes/*`, (route) => {
      if (route.request().method() === 'PATCH') patches++;
      return route.continue();
    });
    await page.getByTestId('lottning-max-time').fill(bad);
    await page.getByTestId('lottning-max-time-save').click();
    await expect(page.getByTestId('lottning-max-time-error')).toHaveText(
      'Ogiltig maxtid. Skriv mm:ss, till exempel 60:00.'
    );
    await expect(page.getByTestId('lottning-max-time')).toHaveAttribute('aria-invalid', 'true');
    expect(patches).toBe(0);
    await page.getByTestId('lottning-max-time').fill('5:00');
    await expect(page.getByTestId('lottning-max-time-error')).toHaveCount(0);
  });
}

test('a max time refused after the first start says why (LO-1)', async ({ page, request }) => {
  const id = await setupCompetition(request);
  await page.goto(`/competition/${id}/lottning`);
  await expect(page.getByTestId('lottning-draw-btn')).toBeEnabled();
  await page.route(`**/api/competitions/${id}/classes/*`, (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 409, json: { error: 'max_time_locked' } })
      : route.continue()
  );
  await page.getByTestId('lottning-max-time').fill('45:00');
  await page.getByTestId('lottning-max-time-save').click();
  await expect(page.getByText('Maxtiden kan inte ändras efter första start.')).toBeVisible();
});

test('Lotta om draws at once, the history offers Ångra and undo restores the old times (LO-2)', async ({
  page,
  request,
}) => {
  const id = await setupCompetition(request);
  await page.goto(`/competition/${id}/lottning`);
  await page.getByTestId('lottning-class-select').selectOption({ label: 'H21' });
  await page.getByTestId('lottning-first-start').fill('10:00');
  await page.getByTestId('lottning-draw-btn').click();
  await expect(page.getByTestId('lottning-row')).toHaveCount(2);
  const times = async () => page.locator('[data-testid=lottning-row] .col-start').allInnerTexts();
  const before = await times();

  await page.getByTestId('lottning-first-start').fill('11:00');
  await expect(page.getByTestId('lottning-draw-btn')).toHaveText('Lotta om');
  await page.getByTestId('lottning-draw-btn').click();
  await expect(page.getByText('Lottat. Ångra i historiken nedan.')).toBeVisible();
  expect(await page.locator('.redraw-confirm').count()).toBe(0);
  // The line shows before the list and the history reload: wait for both,
  // or the read sees the old times and the undo hits the first draw.
  await expect(page.locator('[data-testid=lottning-row] .col-start')).toHaveText([/^11:/, /^11:/]);
  await expect(page.locator('[data-testid=history-row][data-cause=draw]')).toHaveCount(2);

  await page.getByRole('link', { name: 'Ångra i historiken nedan.' }).click();
  await page.getByTestId('history-row').first().getByTestId('history-undo').click();
  await expect(page.getByTestId('history-done')).toBeVisible();
  await expect.poll(times).toEqual(before);
});

test('the class and mode are locked while the file is read, and Lotta stays disabled after a failed read (LO-4)', async ({
  page,
  request,
}) => {
  const id = await setupCompetition(request);
  await page.goto(`/competition/${id}/lottning`);
  await page.getByTestId('lottning-class-select').selectOption({ label: 'H21' });
  await page.getByTestId('lottning-mode-select').selectOption('Pursuit');
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route('**/import/previous-results', async (route) => {
    await gate;
    await route.fulfill({ status: 400, json: { error: 'parse_failed' } });
  });
  await page
    .getByTestId('pursuit-results-file')
    .setInputFiles(path.join(FIXTURES, 'iof30-resultlist-expected.xml'));
  await page.getByTestId('pursuit-results-upload').click();
  await expect(page.getByTestId('lottning-mode-select')).toBeDisabled();
  await expect(page.getByTestId('lottning-class-select')).toBeDisabled();
  release();
  await expect(page.getByTestId('pursuit-results-error')).toBeVisible();
  await expect(page.getByTestId('lottning-mode-select')).toBeEnabled();
  await expect(page.getByTestId('lottning-draw-btn')).toBeDisabled();
  await expect(page.getByText('Resultatlistan kunde inte läsas in', { exact: true })).toBeVisible();
});

test('a chosen pursuit file keeps Lotta disabled until it is read in (LO-4)', async ({
  page,
  request,
}) => {
  const id = await setupCompetition(request);
  await page.goto(`/competition/${id}/lottning`);
  await page.getByTestId('lottning-class-select').selectOption({ label: 'H21' });
  await page.getByTestId('lottning-mode-select').selectOption('Pursuit');
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route('**/import/previous-results', async (route) => {
    await gate;
    await route.continue();
  });
  await page
    .getByTestId('pursuit-results-file')
    .setInputFiles(path.join(FIXTURES, 'iof30-resultlist-expected.xml'));
  await expect(page.getByTestId('lottning-draw-btn')).toBeDisabled();
  await expect(page.getByText('Resultatlistan läses in', { exact: true })).toBeVisible();

  await page.getByTestId('pursuit-results-upload').click();
  await expect(page.getByTestId('pursuit-results-upload')).toHaveText('Läser in filen…');
  release();
  await expect(page.getByTestId('pursuit-results-done')).toBeVisible();
  await expect(page.getByTestId('lottning-draw-btn')).toBeEnabled();
  await expect(page.getByText('Resultatlistan läses in', { exact: true })).toHaveCount(0);
});

test.describe('row edit (LO-6)', () => {
  test('Enter saves, Escape cancels and an error shows in the row', async ({ page, request }) => {
    const id = await setupCompetition(request);
    await page.goto(`/competition/${id}/lottning`);
    await page.getByTestId('lottning-class-select').selectOption({ label: 'H21' });
    await page.getByTestId('lottning-draw-btn').click();
    await expect(page.getByTestId('lottning-row')).toHaveCount(2);

    const first = page.getByTestId('lottning-row').first();
    await first.getByTestId('lottning-edit-time-btn').click();
    await page.getByTestId('lottning-edit-time-input').press('Escape');
    await expect(page.getByTestId('lottning-edit-time-input')).toHaveCount(0);

    await first.getByTestId('lottning-edit-time-btn').click();
    await page.getByTestId('lottning-edit-time-input').fill('xx:yy');
    await page.getByTestId('lottning-edit-time-input').press('Enter');
    await expect(page.getByTestId('lottning-row-error')).toHaveText(
      'Ogiltigt tidsformat. Använd HH:MM eller HH:MM:SS.'
    );
    await expect(page.getByTestId('lottning-edit-time-input')).toBeVisible();

    await page.getByTestId('lottning-edit-time-input').fill('12:34:56');
    await page.getByTestId('lottning-edit-time-input').press('Enter');
    await expect(page.getByTestId('lottning-edit-time-input')).toHaveCount(0);
    await expect(
      page.locator('[data-testid=lottning-row] .col-start').filter({ hasText: '12:34:56' })
    ).toHaveCount(1);
  });
});

test.describe('start method next to the class (Task 7)', () => {
  async function setKind(
    request: APIRequestContext,
    id: string,
    classId: string,
    kind: string
  ): Promise<void> {
    const res = await request.put(`${BASE}/api/competitions/${id}/classes/kinds`, {
      data: { items: [{ class_id: classId, class_kind: kind, age_class: null }] },
    });
    expect(res.status(), await res.text()).toBeLessThan(300);
  }

  test('it is the first control after the class select, before the draw mode', async ({
    page,
    request,
  }) => {
    const id = await setupCompetition(request);
    await page.goto(`/competition/${id}/lottning`);
    await page.getByTestId('lottning-class-select').selectOption({ label: 'H21' });
    const order = await page
      .getByTestId('lottning-settings')
      .locator('select, input, textarea, button')
      .evaluateAll((els) => els.slice(0, 5).map((e) => e.getAttribute('data-testid')));
    expect(order).toEqual([
      'lottning-class-select',
      'lottning-start-start_time',
      'lottning-start-start_punch',
      'lottning-start-free_start',
      'lottning-mode-select',
    ]);
  });

  test('an open class at nivå 1 must be free start, an age class cannot be', async ({
    page,
    request,
  }) => {
    const id = await setupCompetition(request);
    const ids = await classIds(page, id);
    await setKind(request, id, ids['D21']!, 'oppen');
    await setKind(request, id, ids['H21']!, 'senior');
    const lvl = await request.patch(`${BASE}/api/competitions/${id}`, { data: { level: 'niva1' } });
    expect(lvl.status()).toBe(200);
    await page.goto(`/competition/${id}/lottning`);
    const rule = page.getByTestId('lottning-start-method-rule');
    await page.getByTestId('lottning-class-select').selectOption({ label: 'D21' });
    await expect(rule).toHaveText('Öppen klass ska ha fri starttid på nivå 1–3 (TR 7.4.3).');
    await expect(page.getByTestId('lottning-start-start_time')).toBeDisabled();
    await expect(page.getByTestId('lottning-start-free_start')).toBeEnabled();
    await page.getByTestId('lottning-class-select').selectOption({ label: 'H21' });
    await expect(rule).toHaveText(
      'Fri start är inte tillåten i åldersklass på nivå 1–3 (TR 7.4.2).'
    );
    await expect(page.getByTestId('lottning-start-free_start')).toBeDisabled();
    await expect(page.getByTestId('lottning-start-start_time')).toBeEnabled();
  });

  test('changing it says Sparat, and the choice is stored', async ({ page, request }) => {
    const id = await setupCompetition(request);
    await page.goto(`/competition/${id}/lottning`);
    await page.getByTestId('lottning-class-select').selectOption({ label: 'H21' });
    await page.getByTestId('lottning-start-start_time').check();
    await expect(page.getByTestId('lottning-start-method-note')).toContainText('Sparat');
    const ids = await classIds(page, id);
    const res = await request.get(`${BASE}/api/competitions/${id}/classes`);
    const { classes } = (await res.json()) as {
      classes: Array<{ id: string; start_method: string }>;
    };
    expect(classes.find((c) => c.id === ids['H21'])?.start_method).toBe('start_time');
  });

  test('a failed save shows the error at the field, never Sparat, and the stored value again', async ({
    page,
    request,
  }) => {
    const id = await setupCompetition(request);
    await page.goto(`/competition/${id}/lottning`);
    await page.getByTestId('lottning-class-select').selectOption({ label: 'H21' });
    await expect(page.getByTestId('lottning-draw-btn')).toBeEnabled();
    await page.route(`**/api/competitions/${id}/classes/*`, (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 500, json: { error: 'boom' } })
        : route.continue()
    );
    // The seed stores H21 as start_punch (no level): choosing another fails.
    await expect(page.getByTestId('lottning-start-start_punch')).toBeChecked();
    await page.getByTestId('lottning-start-start_time').click();
    const note = page.getByTestId('lottning-start-method-note');
    await expect(note).toContainText('Valet sparades inte. Försök igen.');
    await expect(note).not.toContainText('Sparat');
    await expect(page.getByTestId('lottning-start-start_punch')).toBeChecked();
  });

  test('a failed no-timing save is still shown, in plain words', async ({ page, request }) => {
    const id = await setupCompetition(request);
    await page.goto(`/competition/${id}/lottning`);
    await page.getByTestId('lottning-class-select').selectOption({ label: 'H21' });
    await expect(page.getByTestId('lottning-draw-btn')).toBeEnabled();
    await page.route(`**/api/competitions/${id}/classes/*`, (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 500, json: { error: 'boom' } })
        : route.continue()
    );
    // The failed save unticks the box again, so click rather than check().
    await page.getByTestId('lottning-no-timing').click();
    await expect(page.getByTestId('lottning-no-timing-note')).toHaveText(
      'Valet sparades inte. Försök igen.'
    );
    await expect(page.getByTestId('lottning-no-timing')).not.toBeChecked();
    await expect(page.getByText('boom')).toHaveCount(0);
  });
});

test('a class without a list says so plainly, and the kind is two short lines (LO-5, LO-10)', async ({
  page,
  request,
}) => {
  const id = await setupCompetition(request);
  await page.goto(`/competition/${id}/lottning`);
  await page.getByTestId('lottning-class-select').selectOption({ label: 'H21' });
  await expect(page.getByTestId('lottning-empty')).toHaveText(
    'Inga starttider ännu. Välj klass och tryck Lotta.'
  );
  const kind = page.getByTestId('lottning-class-kind');
  await expect(kind).toContainText('Klasstyp:');
  await expect(kind).toContainText('Förslag från klassnamnet, inte bekräftad ·');
  await expect(kind.getByRole('link')).toHaveText('Bekräfta på Tävlingsinfo');
  expect(await kind.innerText()).not.toMatch(/\(.*\(/);
});

test('a failed load says so and can be retried (LO-5)', async ({ page, request }) => {
  const id = await setupCompetition(request);
  const ids = await classIds(page, id);
  let fail = true;
  await page.route(`**/api/competitions/${id}/lottning/${ids['H21']}`, (route) =>
    fail ? route.fulfill({ status: 500, json: { error: 'boom' } }) : route.continue()
  );
  await page.goto(`/competition/${id}/lottning`);
  await page.getByTestId('lottning-class-select').selectOption({ label: 'H21' });
  const alert = page.getByRole('alert').filter({ hasText: 'Kunde inte hämta lottningen.' });
  await expect(alert).toBeVisible();
  await expect(page.getByTestId('lottning-empty')).toHaveCount(0);
  fail = false;
  await alert.getByRole('button', { name: 'Försök igen' }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.getByTestId('lottning-empty')).toBeVisible();
});

test.describe('?klass= preselect (Task 8)', () => {
  test('?klass= opens that class, an unknown id falls back, a pick updates the URL', async ({
    page,
    request,
  }) => {
    const id = await setupCompetition(request);
    const ids = await classIds(page, id);
    const select = page.getByTestId('lottning-class-select');

    await page.goto(`/competition/${id}/lottning?klass=${ids['H21']}`);
    await expect(select).toHaveValue(ids['H21']!, { timeout: 20_000 });
    await expect(page.getByTestId('lottning-draw-btn')).toBeEnabled();

    await page.goto(`/competition/${id}/lottning?klass=finns-inte`);
    await expect(select).not.toHaveValue('finns-inte', { timeout: 20_000 });
    await expect(page.getByTestId('lottning-draw-btn')).toBeEnabled();

    await select.selectOption({ label: 'D21' });
    await expect(page).toHaveURL(new RegExp(`klass=${ids['D21']}`));
    await expect(select).toHaveValue(ids['D21']!);
  });
});
