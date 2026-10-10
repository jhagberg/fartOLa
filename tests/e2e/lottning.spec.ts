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

import { test, expect, type APIRequestContext } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

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
  await page.getByTestId('info-save').click();
  await expect(page.getByTestId('info-saved-toast')).toBeVisible();
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

  await page.goto(`/competition/${id}/runners`);
  await expect(page.getByTestId('runners-bib')).toHaveText(['Startnr 150', 'Startnr 102'], {
    useInnerText: true,
  });
});
