// Authored for fartola. Not ported from upstream.
//
// ADR-0016 confirmation: an automated accessibility check. Colour
// contrast and target size must be clean on the five main screens in
// both modes; violations already known (a11y-known.json, rule + target)
// are allowed until plan 2 fixes them, and the list may only shrink.

import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { seedCompetition, simulateRead } from './helpers/seed.ts';
import { prepareRegistration } from './helpers/registration.ts';
import { prepareEventor, prepareEventorNoKey } from './helpers/eventor.ts';
import { prepareKvar, prepareKvarAsleep, prepareKvarError } from './helpers/kvar.ts';
import { prepareHome, prepareHomeError } from './helpers/home.ts';
import { prepareImport } from './helpers/import.ts';
import { prepareSettings } from './helpers/settings.ts';
import {
  prepareWizardStep1,
  prepareWizardStep2,
  prepareWizardImportError,
  prepareWizardDiscard,
} from './helpers/wizard.ts';
import { prepareExport, prepareExportError } from './helpers/export.ts';

test.describe.configure({ mode: 'serial' });

// Buttons fade their colours (0.12 s): switch transitions off so axe never
// reads a mid-fade colour. (Not reducedMotion: it also drops scrim blur.)
async function noTransitions(page: Page): Promise<void> {
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important}' });
}

test('no new contrast or target-size violations', async ({ page, request }) => {
  test.setTimeout(120_000);
  const { competitionId: id } = await seedCompetition(request, { controls: 12 });
  await simulateRead(request, id, 7_501_853, [31, 32, 33, 35, 34, 36, 37, 38, 39, 40, 41, 42]);
  // Registration gets its own competition: its prepared state reads cards,
  // which would replace the latest read the readout screen waits for.
  const regId = (await seedCompetition(request, { controls: 12 })).competitionId;
  const kvId = (await seedCompetition(request, { controls: 12 })).competitionId;
  const imId = (await seedCompetition(request, { controls: 12 })).competitionId;
  const exId = (await seedCompetition(request, { controls: 12 })).competitionId;
  // Each screen is scanned only once its own content is on the page.
  const screens: Array<[string, (page: Page) => Locator, ((page: Page) => Promise<void>)?]> = [
    ['/', (p) => p.getByTestId('comp-grid'), (p) => prepareHome(p, request)],
    [
      `/competition/${id}/readout`,
      (p) => p.getByTestId('latest-read').filter({ hasText: '7501853' }),
    ],
    [`/competition/${id}/readout?walkup=7500123`, (p) => p.getByTestId('walkup-modal')],
    [`/competition/${id}/results`, (p) => p.getByTestId('results-view')],
    [`/competition/${id}/lottning`, (p) => p.getByTestId('lottning-view')],
    [`/competition/${regId}/registration`, (p) => p.getByTestId('registration-view')],
    [`/competition/${id}/info`, (p) => p.getByTestId('competition-info')],
    [`/competition/${exId}/export`, (p) => p.getByTestId('export-view'), prepareExport],
    [
      `/competition/${exId}/export`,
      (p) => p.getByTestId('export-view'),
      (p) => prepareExportError(p, 'invalid'),
    ],
    [
      `/competition/${exId}/export`,
      (p) => p.getByTestId('export-view'),
      (p) => prepareExportError(p, 'network'),
    ],
    [
      `/competition/${exId}/eventor-publish`,
      (p) => p.getByTestId('eventor-publish-view'),
      prepareEventor,
    ],
    [
      `/competition/${exId}/eventor-publish`,
      (p) => p.getByTestId('eventor-publish-view'),
      prepareEventorNoKey,
    ],
    [`/competition/${kvId}/kvar-i-skogen`, (p) => p.getByTestId('kvariskov-view'), prepareKvar],
    [
      `/competition/${kvId}/kvar-i-skogen`,
      (p) => p.getByTestId('kvariskov-view'),
      prepareKvarAsleep,
    ],
    [
      `/competition/${kvId}/kvar-i-skogen`,
      (p) => p.getByTestId('kvariskov-view'),
      prepareKvarError,
    ],
    ['/installningar', (p) => p.getByTestId('appearance-section'), (p) => prepareSettings(p, id)],
    ['/', (p) => p.getByTestId('comp-grid'), prepareHomeError],
    [`/competition/${imId}/import`, (p) => p.getByTestId('import-runners-view'), prepareImport],
    ['/competition/_new?wizard=1', (p) => p.getByTestId('wiz-name'), prepareWizardStep1],
    ['/competition/_new?wizard=1', (p) => p.getByTestId('wiz-name'), prepareWizardStep2],
    ['/competition/_new?wizard=1', (p) => p.getByTestId('wiz-name'), prepareWizardImportError],
    ['/competition/_new?wizard=1', (p) => p.getByTestId('wiz-name'), prepareWizardDiscard],
  ];
  const known = JSON.parse(
    readFileSync(new URL('./a11y-known.json', import.meta.url), 'utf8')
  ) as Array<{ rule: string; target: string }>;
  const allowed = new Set(known.map((k) => `${k.rule} ${k.target}`));
  const found: string[] = [];
  for (const high of [false, true]) {
    for (const [url, ready, prepare] of screens) {
      await page.goto(url);
      await noTransitions(page);
      await expect(ready(page)).toBeVisible();
      if (url.endsWith('/registration')) await prepareRegistration(page, regId, request);
      await prepare?.(page);
      // A prepare may reload (dropping the style tag): inject again.
      await noTransitions(page);
      if (high) {
        await page.evaluate(() => document.documentElement.classList.add('contrast-high'));
      }
      const axe = new AxeBuilder({ page }).withRules(['color-contrast', 'target-size']);
      // The walk-up modal over registration belongs to another screen pass.
      if (url.endsWith('/registration')) axe.exclude('[data-testid=walkup-modal]');
      const result = await axe.analyze();
      // Home's list filter / mocked 503 must not distort the chrome of later screens.
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      for (const v of result.violations) {
        for (const n of v.nodes) {
          const key = `${v.id} ${n.target.join(' ')}`;
          if (!allowed.has(key)) found.push(`${high ? 'sun' : 'default'} ${url}: ${key}`);
        }
      }
    }
  }
  expect(found, found.join('\n')).toEqual([]);
});
