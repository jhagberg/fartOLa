// Authored for fartola. Not ported from upstream.
//
// ADR-0016 confirmation: an automated accessibility check. Colour
// contrast and target size must be clean on the five main screens in
// both modes; violations already known (a11y-known.json, rule + target)
// are allowed until plan 2 fixes them, and the list may only shrink.

import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { seedCompetition, simulateRead } from './helpers/seed.ts';
import { prepareRegistration } from './helpers/registration.ts';
import {
  prepareLottningFull,
  prepareLottningMaxTimeError,
  prepareLottningPursuitReading,
  prepareLottningEmpty,
  prepareLottningLoadError,
} from './helpers/lottning.ts';
import { prepareKontrollNoStart } from './helpers/prerace.ts';
import {
  prepareWalkupAlternatives,
  prepareWalkupCardTaken,
  prepareWalkupNetworkError,
  prepareWalkupNoMatch,
} from './helpers/walkup.ts';
import { prepareEventor, prepareEventorNoKey } from './helpers/eventor.ts';
import { prepareKvar, prepareKvarAsleep, prepareKvarError } from './helpers/kvar.ts';
import { prepareHome, prepareHomeError } from './helpers/home.ts';
import { prepareImport } from './helpers/import.ts';
import { prepareSettings } from './helpers/settings.ts';
import {
  prepareReadoutPinnedPrintFailed,
  prepareReadoutStatusFailed,
  prepareReadoutEmpty,
  prepareReadoutPrinted,
  prepareReadoutFrame,
} from './helpers/readout.ts';
import {
  prepareAccess,
  prepareAccessWrongCode,
  prepareAccessLoadError,
  prepareAccessEmpty,
} from './helpers/access.ts';
import {
  prepareWizardStep1,
  prepareWizardStep2,
  prepareWizardImportError,
  prepareWizardDiscard,
} from './helpers/wizard.ts';
import { prepareMissingStarts, prepareMissingStartsError } from './helpers/missing-starts.ts';
import {
  prepareResultsFull,
  prepareResultsFullscreen,
  prepareResultsError,
  prepareResultsEmpty,
} from './helpers/results.ts';
import { prepareExport, prepareExportError } from './helpers/export.ts';

// Buttons fade their colours (0.12 s): switch transitions off so axe never
// reads a mid-fade colour. (Not reducedMotion: it also drops scrim blur.)
async function noTransitions(page: Page): Promise<void> {
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important}' });
}

type Ids = { id: number; regId: number; kvId: number; imId: number; exId: number };
type Screen = [
  label: string,
  url: string,
  ready: (page: Page) => Locator,
  prepare?: (page: Page) => Promise<void>,
];

// Seeded once per worker (the dev server keeps the rows), so every screen
// below is its own short test and a failure names the screen.
let seeded: Promise<Ids> | undefined;
function seedAll(request: APIRequestContext): Promise<Ids> {
  seeded ??= (async () => {
    const { competitionId: id } = await seedCompetition(request, { controls: 12 });
    await simulateRead(request, id, 7_501_853, [31, 32, 33, 35, 34, 36, 37, 38, 39, 40, 41, 42]);
    // Registration gets its own competition: its prepared state reads cards,
    // which would replace the latest read the readout screen waits for.
    const regId = (await seedCompetition(request, { controls: 12 })).competitionId;
    const kvId = (await seedCompetition(request, { controls: 12 })).competitionId;
    const imId = (await seedCompetition(request, { controls: 12 })).competitionId;
    const exId = (await seedCompetition(request, { controls: 12 })).competitionId;
    return { id, regId, kvId, imId, exId };
  })();
  return seeded;
}

// Each screen is scanned only once its own content is on the page.
function screensFor({ id, regId, kvId, imId, exId }: Ids, request: APIRequestContext): Screen[] {
  return [
    ['home', '/', (p) => p.getByTestId('comp-grid'), (p) => prepareHome(p, request)],
    [
      'readout',
      `/competition/${id}/readout`,
      (p) => p.getByTestId('latest-read').filter({ hasText: '7501853' }),
    ],
    [
      'readout pinned, print failed',
      `/competition/${id}/readout`,
      (p) => p.getByTestId('readout-view'),
      (p) => prepareReadoutPinnedPrintFailed(p, request),
    ],
    [
      'readout status save failed',
      `/competition/${id}/readout`,
      (p) => p.getByTestId('readout-view'),
      (p) => prepareReadoutStatusFailed(p, request),
    ],
    [
      'readout empty',
      `/competition/${id}/readout`,
      (p) => p.getByTestId('readout-view'),
      (p) => prepareReadoutEmpty(p, request),
    ],
    [
      'readout printed',
      `/competition/${id}/readout`,
      (p) => p.getByTestId('readout-view'),
      (p) => prepareReadoutPrinted(p, request),
    ],
    [
      'readout frame',
      `/competition/${id}/readout`,
      (p) => p.getByTestId('readout-view'),
      (p) => prepareReadoutFrame(p, request),
    ],
    [
      'results full',
      `/competition/${id}/results`,
      (p) => p.getByTestId('results-view'),
      prepareResultsFull,
    ],
    [
      'results fullscreen',
      `/competition/${id}/results`,
      (p) => p.getByTestId('results-view'),
      prepareResultsFullscreen,
    ],
    [
      'results load error',
      `/competition/${id}/results`,
      (p) => p.getByTestId('results-view'),
      prepareResultsError,
    ],
    [
      'results empty class',
      `/competition/${id}/results`,
      (p) => p.getByTestId('results-view'),
      prepareResultsEmpty,
    ],
    [
      'results missing starts',
      `/competition/${id}/results`,
      (p) => p.getByTestId('results-view'),
      prepareMissingStarts,
    ],
    [
      'results missing starts error',
      `/competition/${id}/results`,
      (p) => p.getByTestId('results-view'),
      prepareMissingStartsError,
    ],
    [
      'readout walkup',
      `/competition/${id}/readout?walkup=7500123`,
      (p) => p.getByTestId('walkup-modal'),
    ],
    [
      'walkup alternatives, error and discard',
      `/competition/${id}/readout`,
      (p) => p.getByTestId('readout-view'),
      (p) => prepareWalkupAlternatives(p, String(id)),
    ],
    [
      'walkup card taken',
      `/competition/${id}/readout`,
      (p) => p.getByTestId('readout-view'),
      (p) => prepareWalkupCardTaken(p, String(id)),
    ],
    [
      'walkup network error',
      `/competition/${id}/readout`,
      (p) => p.getByTestId('readout-view'),
      (p) => prepareWalkupNetworkError(p, String(id)),
    ],
    [
      'walkup search no match',
      `/competition/${id}/readout`,
      (p) => p.getByTestId('readout-view'),
      (p) => prepareWalkupNoMatch(p, String(id)),
    ],
    ['results', `/competition/${id}/results`, (p) => p.getByTestId('results-view')],
    [
      'lottning',
      `/competition/${id}/lottning`,
      (p) => p.getByTestId('lottning-view'),
      (p) => prepareLottningFull(p, request),
    ],
    [
      'lottning max time error',
      `/competition/${id}/lottning`,
      (p) => p.getByTestId('lottning-view'),
      (p) => prepareLottningMaxTimeError(p, request),
    ],
    [
      'lottning pursuit reading',
      `/competition/${id}/lottning`,
      (p) => p.getByTestId('lottning-view'),
      (p) => prepareLottningPursuitReading(p, request),
    ],
    [
      'kontroll classes without start times',
      `/competition/${id}/kontroll`,
      (p) => p.getByTestId('prerace-view'),
      (p) => prepareKontrollNoStart(p, request),
    ],
    [
      'lottning empty',
      `/competition/${id}/lottning`,
      (p) => p.getByTestId('lottning-view'),
      (p) => prepareLottningEmpty(p, request),
    ],
    [
      'lottning load error',
      `/competition/${id}/lottning`,
      (p) => p.getByTestId('lottning-view'),
      prepareLottningLoadError,
    ],
    [
      'registration',
      `/competition/${regId}/registration`,
      (p) => p.getByTestId('registration-view'),
    ],
    ['info', `/competition/${id}/info`, (p) => p.getByTestId('competition-info')],
    ['export', `/competition/${exId}/export`, (p) => p.getByTestId('export-view'), prepareExport],
    [
      'export invalid',
      `/competition/${exId}/export`,
      (p) => p.getByTestId('export-view'),
      (p) => prepareExportError(p, 'invalid'),
    ],
    [
      'export network',
      `/competition/${exId}/export`,
      (p) => p.getByTestId('export-view'),
      (p) => prepareExportError(p, 'network'),
    ],
    [
      'eventor publish',
      `/competition/${exId}/eventor-publish`,
      (p) => p.getByTestId('eventor-publish-view'),
      prepareEventor,
    ],
    [
      'eventor publish no key',
      `/competition/${exId}/eventor-publish`,
      (p) => p.getByTestId('eventor-publish-view'),
      prepareEventorNoKey,
    ],
    [
      'kvar i skogen',
      `/competition/${kvId}/kvar-i-skogen`,
      (p) => p.getByTestId('kvariskov-view'),
      prepareKvar,
    ],
    [
      'kvar i skogen asleep',
      `/competition/${kvId}/kvar-i-skogen`,
      (p) => p.getByTestId('kvariskov-view'),
      prepareKvarAsleep,
    ],
    [
      'kvar i skogen error',
      `/competition/${kvId}/kvar-i-skogen`,
      (p) => p.getByTestId('kvariskov-view'),
      prepareKvarError,
    ],
    [
      'settings',
      '/installningar',
      (p) => p.getByTestId('appearance-section'),
      (p) => prepareSettings(p, id),
    ],
    ['home error', '/', (p) => p.getByTestId('comp-grid'), prepareHomeError],
    [
      'import',
      `/competition/${imId}/import`,
      (p) => p.getByTestId('import-runners-view'),
      prepareImport,
    ],
    [
      'wizard step 1',
      '/competition/_new?wizard=1',
      (p) => p.getByTestId('wiz-name'),
      prepareWizardStep1,
    ],
    [
      'wizard step 2',
      '/competition/_new?wizard=1',
      (p) => p.getByTestId('wiz-name'),
      prepareWizardStep2,
    ],
    [
      'wizard import error',
      '/competition/_new?wizard=1',
      (p) => p.getByTestId('wiz-name'),
      prepareWizardImportError,
    ],
    [
      'wizard discard',
      '/competition/_new?wizard=1',
      (p) => p.getByTestId('wiz-name'),
      prepareWizardDiscard,
    ],
    ['access', '/access', (p) => p.getByTestId('access-view'), prepareAccess],
    ['access wrong code', '/access', (p) => p.getByTestId('access-view'), prepareAccessWrongCode],
    ['access load error', '/access', (p) => p.getByTestId('access-view'), prepareAccessLoadError],
    ['access empty', '/access', (p) => p.getByTestId('access-view'), prepareAccessEmpty],
  ];
}

const known = JSON.parse(
  readFileSync(new URL('./a11y-known.json', import.meta.url), 'utf8')
) as Array<{
  rule: string;
  target: string;
}>;
const allowed = new Set(known.map((k) => `${k.rule} ${k.target}`));

// Labels only; the table needs ids, so names come from a throwaway build.
const labels = screensFor(
  { id: 0, regId: 0, kvId: 0, imId: 0, exId: 0 },
  undefined as unknown as APIRequestContext
).map((s) => s[0]);

for (const high of [false, true]) {
  test.describe(high ? 'sun' : 'default', () => {
    labels.forEach((label, i) => {
      test(`no new contrast or target-size violations: ${label}`, async ({ page, request }) => {
        test.setTimeout(60_000);
        const ids = await seedAll(request);
        const [, url, ready, prepare] = screensFor(ids, request)[i];
        await page.goto(url);
        await noTransitions(page);
        await expect(ready(page)).toBeVisible();
        if (url.endsWith('/registration')) await prepareRegistration(page, ids.regId, request);
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
        const found: string[] = [];
        for (const v of result.violations) {
          for (const n of v.nodes) {
            const key = `${v.id} ${n.target.join(' ')}`;
            if (!allowed.has(key)) found.push(`${url}: ${key}`);
          }
        }
        expect(found, found.join('\n')).toEqual([]);
      });
    });
  });
}
