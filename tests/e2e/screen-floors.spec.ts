// tests/e2e/screen-floors.spec.ts
// Authored for fartola. Not ported from upstream.
//
// Design lab plan 2: every screen it passes keeps ADR-0016 rule 7 —
// no text under 14 px, no target under 44 px — at laptop and tablet
// width. Each screen task appends its entry.
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { seedCompetition } from './helpers/seed.ts';
import { prepareRegistration } from './helpers/registration.ts';
import { prepareExport, prepareExportError } from './helpers/export.ts';
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
  prepareWalkupAlternatives,
  prepareWalkupCardTaken,
  prepareWalkupNetworkError,
  prepareWalkupNoMatch,
} from './helpers/walkup.ts';
import {
  prepareResultsFull,
  prepareResultsFullscreen,
  prepareResultsError,
  prepareResultsEmpty,
} from './helpers/results.ts';
import {
  prepareLottningFull,
  prepareLottningMaxTimeError,
  prepareLottningPursuitReading,
  prepareLottningEmpty,
  prepareLottningLoadError,
  prepareLottningStartChoiceConflict,
} from './helpers/lottning.ts';
import { prepareKontrollNoStart } from './helpers/prerace.ts';
import { prepareInfo, prepareInfoFeesReloadError, prepareInfoLocked } from './helpers/info.ts';
import { prepareRunnersAdd, prepareRunnersEdit, prepareRunnersList } from './helpers/runners.ts';
import {
  prepareEditReadError,
  prepareEditReadMispunch,
  prepareEditReadNeverRead,
} from './helpers/edit-runner.ts';
import {
  prepareHyrbrickorEmpty,
  prepareHyrbrickorFull,
  prepareHyrbrickorLoadError,
  prepareHyrbrickorOpen,
} from './helpers/hyrbrickor.ts';
import { smallTargets, smallText } from './helpers/floors.ts';

test.describe.configure({ mode: 'serial' });

type Screen = {
  name: string;
  url: (id: string) => string;
  ready: (p: Page) => Locator;
  /** Measure only inside this selector (a dialog over another track's screen). */
  root?: string;
  /** Bring the screen into a state with its conditional parts showing. */
  prepare?: (page: Page, id: string, request: APIRequestContext) => Promise<void>;
};
const SCREENS: Screen[] = [
  {
    name: 'Tävlingar',
    url: () => '/',
    ready: (p) => p.getByTestId('comp-grid'),
    prepare: async (page, _id, request) => prepareHome(page, request),
  },
  {
    name: 'Tävlingar med laddningsfel',
    url: () => '/',
    ready: (p) => p.getByTestId('comp-grid'),
    prepare: async (page) => prepareHomeError(page),
  },
  {
    name: 'Registrering',
    url: (id) => `/competition/${id}/registration`,
    ready: (p) => p.getByTestId('registration-view'),
  },
  {
    name: 'Registrering med kö',
    url: (id) => `/competition/${id}/registration`,
    ready: (p) => p.getByTestId('registration-view'),
    root: '[data-testid=registration-view]',
    prepare: async (page, id, request) => {
      await prepareRegistration(page, id, request);
      // The walk-up modal belongs to another track: leave it out.
      await page.getByTestId('walkup-modal').evaluate((e) => e.setAttribute('inert', ''));
    },
  },
  {
    name: 'Direktanmälan med förslag, fel och avbrytsfråga',
    url: (id) => `/competition/${id}/readout`,
    ready: (p) => p.getByTestId('readout-view'),
    root: '[data-testid=walkup-modal]',
    prepare: async (page, id) => prepareWalkupAlternatives(page, id),
  },
  {
    name: 'Direktanmälan med använd bricka',
    url: (id) => `/competition/${id}/readout`,
    ready: (p) => p.getByTestId('readout-view'),
    root: '[data-testid=walkup-modal]',
    prepare: async (page, id) => prepareWalkupCardTaken(page, id),
  },
  {
    name: 'Direktanmälan med nätverksfel',
    url: (id) => `/competition/${id}/readout`,
    ready: (p) => p.getByTestId('readout-view'),
    root: '[data-testid=walkup-modal]',
    prepare: async (page, id) => prepareWalkupNetworkError(page, id),
  },
  {
    name: 'Direktanmälan med namnsökning utan träff',
    url: (id) => `/competition/${id}/readout`,
    ready: (p) => p.getByTestId('readout-view'),
    root: '[data-testid=walkup-modal]',
    prepare: async (page, id) => prepareWalkupNoMatch(page, id),
  },
  {
    name: 'Export',
    url: (id) => `/competition/${id}/export`,
    ready: (p) => p.getByTestId('export-view'),
    prepare: async (page) => prepareExport(page),
  },
  {
    name: 'Export med ogiltig fil',
    url: (id) => `/competition/${id}/export`,
    ready: (p) => p.getByTestId('export-view'),
    prepare: async (page) => prepareExportError(page, 'invalid'),
  },
  {
    name: 'Export med fel',
    url: (id) => `/competition/${id}/export`,
    ready: (p) => p.getByTestId('export-view'),
    prepare: async (page) => prepareExportError(page, 'network'),
  },
  {
    name: 'Eventor',
    url: (id) => `/competition/${id}/eventor-publish`,
    ready: (p) => p.getByTestId('eventor-publish-view'),
    prepare: async (page) => prepareEventor(page),
  },
  {
    name: 'Eventor utan nyckel',
    url: (id) => `/competition/${id}/eventor-publish`,
    ready: (p) => p.getByTestId('eventor-publish-view'),
    prepare: async (page) => prepareEventorNoKey(page),
  },
  {
    name: 'Kvar i skogen',
    url: (id) => `/competition/${id}/kvar-i-skogen`,
    ready: (p) => p.getByTestId('kvariskov-view'),
    prepare: async (page) => prepareKvar(page),
  },
  {
    name: 'Kvar i skogen, dosan sover',
    url: (id) => `/competition/${id}/kvar-i-skogen`,
    ready: (p) => p.getByTestId('kvariskov-view'),
    prepare: async (page) => prepareKvarAsleep(page),
  },
  {
    name: 'Kvar i skogen med fel',
    url: (id) => `/competition/${id}/kvar-i-skogen`,
    ready: (p) => p.getByTestId('kvariskov-view'),
    prepare: async (page) => prepareKvarError(page),
  },
  {
    name: 'Ny tävling',
    url: () => '/competition/_new?wizard=1',
    ready: (p) => p.getByTestId('wiz-name'),
    prepare: async (page) => prepareWizardStep1(page),
  },
  {
    name: 'Ny tävling, steg 2',
    url: () => '/competition/_new?wizard=1',
    ready: (p) => p.getByTestId('wiz-name'),
    prepare: async (page) => prepareWizardStep2(page),
  },
  {
    name: 'Ny tävling med importfel',
    url: () => '/competition/_new?wizard=1',
    ready: (p) => p.getByTestId('wiz-name'),
    prepare: async (page) => prepareWizardImportError(page),
  },
  {
    name: 'Ny tävling med avbrytsfråga',
    url: () => '/competition/_new?wizard=1',
    ready: (p) => p.getByTestId('wiz-name'),
    prepare: async (page) => prepareWizardDiscard(page),
  },
  {
    name: 'Importera löpare',
    url: (id) => `/competition/${id}/import`,
    ready: (p) => p.getByTestId('import-runners-view'),
    root: '[role="dialog"]',
    prepare: async (page) => prepareImport(page),
  },
  {
    name: 'Inställningar',
    url: () => '/installningar',
    ready: (p) => p.getByTestId('settings-view'),
    prepare: async (page, id) => prepareSettings(page, id),
  },
  {
    name: 'Hjälparinloggning',
    url: () => '/access',
    ready: (p) => p.getByTestId('access-view'),
    prepare: async (page) => prepareAccess(page),
  },
  {
    name: 'Hjälparinloggning med fel kod',
    url: () => '/access',
    ready: (p) => p.getByTestId('access-view'),
    prepare: async (page) => prepareAccessWrongCode(page),
  },
  {
    name: 'Hjälparinloggning med laddningsfel',
    url: () => '/access',
    ready: (p) => p.getByTestId('access-view'),
    prepare: async (page) => prepareAccessLoadError(page),
  },
  {
    name: 'Hjälparinloggning utan tävlingar',
    url: () => '/access',
    ready: (p) => p.getByTestId('access-view'),
    prepare: async (page) => prepareAccessEmpty(page),
  },
  {
    name: 'Avläsning, äldre avläsning och misslyckad utskrift',
    url: (id) => `/competition/${id}/readout`,
    ready: (p) => p.getByTestId('readout-view'),
    root: '[data-testid=latest-read]',
    prepare: async (page, _id, request) => prepareReadoutPinnedPrintFailed(page, request),
  },
  {
    name: 'Avläsning, statusval som inte sparades',
    url: (id) => `/competition/${id}/readout`,
    ready: (p) => p.getByTestId('readout-view'),
    root: '[data-testid=latest-read]',
    prepare: async (page, _id, request) => prepareReadoutStatusFailed(page, request),
  },
  {
    name: 'Avläsning utan avläsning',
    url: (id) => `/competition/${id}/readout`,
    ready: (p) => p.getByTestId('readout-view'),
    root: '[data-testid=latest-read]',
    prepare: async (page, _id, request) => prepareReadoutEmpty(page, request),
  },
  {
    name: 'Avläsning, kvittohuvud',
    url: (id) => `/competition/${id}/readout`,
    ready: (p) => p.getByTestId('readout-view'),
    root: '.receipt-mirror .head',
    prepare: async (page, _id, request) => prepareReadoutPrinted(page, request),
  },
  {
    name: 'Avläsning, hela sidan med grupperade avläsningar och två notiser',
    url: (id) => `/competition/${id}/readout`,
    ready: (p) => p.getByTestId('readout-view'),
    prepare: async (page, _id, request) => prepareReadoutFrame(page, request),
  },
  {
    name: 'Resultat, hela sidan',
    url: (id) => `/competition/${id}/results`,
    ready: (p) => p.getByTestId('results-view'),
    prepare: async (page) => prepareResultsFull(page),
  },
  {
    name: 'Resultat, helskärm',
    url: (id) => `/competition/${id}/results`,
    ready: (p) => p.getByTestId('results-view'),
    prepare: async (page) => prepareResultsFullscreen(page),
  },
  {
    name: 'Resultat, laddningsfel',
    url: (id) => `/competition/${id}/results`,
    ready: (p) => p.getByTestId('results-view'),
    prepare: async (page) => prepareResultsError(page),
  },
  {
    name: 'Resultat, tom klass',
    url: (id) => `/competition/${id}/results`,
    ready: (p) => p.getByTestId('results-view'),
    prepare: async (page) => prepareResultsEmpty(page),
  },
  {
    name: 'Resultat, saknade starttider',
    url: (id) => `/competition/${id}/results`,
    ready: (p) => p.getByTestId('results-view'),
    root: '[data-testid=missing-starts]',
    prepare: async (page) => prepareMissingStarts(page),
  },
  {
    name: 'Resultat, saknade starttider med laddningsfel',
    url: (id) => `/competition/${id}/results`,
    ready: (p) => p.getByTestId('results-view'),
    root: '[data-testid=missing-starts-error]',
    prepare: async (page) => prepareMissingStartsError(page),
  },
  {
    name: 'Lottning, utlottad klass med omlottning, fler val och sparad maxtid',
    url: (id) => `/competition/${id}/lottning`,
    ready: (p) => p.getByTestId('lottning-view'),
    prepare: async (page, _id, request) => prepareLottningFull(page, request),
  },
  {
    name: 'Lottning, maxtid som inte sparades',
    url: (id) => `/competition/${id}/lottning`,
    ready: (p) => p.getByTestId('lottning-view'),
    prepare: async (page, _id, request) => prepareLottningMaxTimeError(page, request),
  },
  {
    name: 'Lottning, startval som strider mot reglerna och Lotta som väntar',
    url: (id) => `/competition/${id}/lottning`,
    ready: (p) => p.getByTestId('lottning-view'),
    prepare: async (page, _id, request) => prepareLottningStartChoiceConflict(page, request),
  },
  {
    name: 'Lottning, jaktstart med fil som läses in',
    url: (id) => `/competition/${id}/lottning`,
    ready: (p) => p.getByTestId('lottning-view'),
    prepare: async (page, _id, request) => prepareLottningPursuitReading(page, request),
  },
  {
    name: 'Kontroll, klasser utan starttid med länk till Lottning',
    url: (id) => `/competition/${id}/kontroll`,
    ready: (p) => p.getByTestId('prerace-view'),
    prepare: async (page, _id, request) => prepareKontrollNoStart(page, request),
  },
  {
    name: 'Lottning, klass utan starttider',
    url: (id) => `/competition/${id}/lottning`,
    ready: (p) => p.getByTestId('lottning-view'),
    prepare: async (page, _id, request) => prepareLottningEmpty(page, request),
  },
  {
    name: 'Tävlingsinfo före start, struken kontroll, regeltext, fel och sparat',
    url: (id) => `/competition/${id}/info`,
    ready: (p) => p.getByTestId('competition-info'),
    prepare: async (page, _id, request) => prepareInfo(page, request),
  },
  {
    name: 'Tävlingsinfo efter start med låst maxtid',
    url: (id) => `/competition/${id}/info`,
    ready: (p) => p.getByTestId('competition-info'),
    prepare: async (page) => prepareInfoLocked(page),
  },
  {
    name: 'Tävlingsinfo, avgifter låsta när de inte gick att läsa igen',
    url: (id) => `/competition/${id}/info`,
    ready: (p) => p.getByTestId('competition-info'),
    prepare: async (page, _id, request) => prepareInfoFeesReloadError(page, request),
  },
  {
    name: 'Anmälda, lista med återbud, bricka, hyrbricka, starttid och filtrerat antal',
    url: (id) => `/competition/${id}/runners`,
    ready: (p) => p.getByTestId('runners-view'),
    prepare: async (page, _id, request) => prepareRunnersList(page, request),
  },
  {
    name: 'Anmälda, ändra med fel vid fälten',
    url: (id) => `/competition/${id}/runners`,
    ready: (p) => p.getByTestId('runners-view'),
    root: '[role="dialog"]',
    prepare: async (page, _id, request) => prepareRunnersEdit(page, request),
  },
  {
    name: 'Anmälda, ändra med start, stämplingar, sträcktider och sen start',
    url: (id) => `/competition/${id}/runners`,
    ready: (p) => p.getByTestId('runners-view'),
    root: '[role="dialog"]',
    prepare: async (page, _id, request) => prepareEditReadMispunch(page, request),
  },
  {
    name: 'Anmälda, ändra när stämplingarna inte kunde hämtas',
    url: (id) => `/competition/${id}/runners`,
    ready: (p) => p.getByTestId('runners-view'),
    root: '[role="dialog"]',
    prepare: async (page, _id, request) => prepareEditReadError(page, request),
  },
  {
    name: 'Anmälda, ändra en aldrig avläst med tid för hand',
    url: (id) => `/competition/${id}/runners`,
    ready: (p) => p.getByTestId('runners-view'),
    root: '[role="dialog"]',
    prepare: async (page, _id, request) => prepareEditReadNeverRead(page, request),
  },
  {
    name: 'Anmälda, lägg till',
    url: (id) => `/competition/${id}/runners`,
    ready: (p) => p.getByTestId('runners-view'),
    root: '[role="dialog"]',
    prepare: async (page, _id, request) => prepareRunnersAdd(page, request),
  },
  {
    name: 'Lottning, laddningsfel',
    url: (id) => `/competition/${id}/lottning`,
    ready: (p) => p.getByTestId('lottning-view'),
    prepare: async (page) => prepareLottningLoadError(page),
  },
  {
    name: 'Hyrbrickor, öppen bricka med märke och kontakt',
    url: (id) => `/competition/${id}/hyrbrickor`,
    ready: (p) => p.getByTestId('hyrbrickor-view'),
    prepare: async (page) => prepareHyrbrickorOpen(page),
  },
  {
    name: 'Hyrbrickor, återlämnad, resultat, radfel och listfel vid omhämtning',
    url: (id) => `/competition/${id}/hyrbrickor`,
    ready: (p) => p.getByTestId('hyrbrickor-view'),
    prepare: async (page) => prepareHyrbrickorFull(page),
  },
  {
    name: 'Hyrbrickor, laddningsfel',
    url: (id) => `/competition/${id}/hyrbrickor`,
    ready: (p) => p.getByTestId('hyrbrickor-view'),
    prepare: async (page) => prepareHyrbrickorLoadError(page),
  },
  {
    name: 'Hyrbrickor, tomt',
    url: (id) => `/competition/${id}/hyrbrickor`,
    ready: (p) => p.getByTestId('hyrbrickor-view'),
    prepare: async (page) => prepareHyrbrickorEmpty(page),
  },
];

test.describe('floor helpers', () => {
  const lone = '<ul><li><a href="#" style="font-size:16px">x</a></li></ul>';
  test('report small text and small targets, skip inert, fail on zero', async ({ page }) => {
    await page.setContent(
      `<span class="tiny" style="font-size:12px">tiny</span>
       <button class="btn" style="font-size:16px;width:36px;height:36px">b</button>
       <p>text with <a href="#" style="display:inline">an inline link</a> inside</p>
       <div inert><span style="font-size:12px">hidden tiny</span></div>
       ${lone}
       <details><summary style="font-size:16px;line-height:23px">s</summary></details>`
    );
    expect(await smallText(page)).toEqual(['span.tiny "tiny" 12px']);
    const t = await smallTargets(page);
    expect(t).toHaveLength(3);
    expect(t[0]).toContain('button.btn "b" 36×36');
    expect(t[1]).toContain('a. "x"');
    expect(t[2]).toMatch(/^summary\. "s" \d+×23$/);

    await page.setContent(
      `<section class="receipt-mirror"><header><span class="meta" style="font-size:12px">head</span></header>
       <div class="receipt-wrap"><div class="paper"><span style="font-size:10px">printed</span></div></div></section>`
    );
    expect(await smallText(page)).toEqual(['span.meta "head" 12px']);

    await page.setContent(
      '<div inert><span style="font-size:12px">a</span><button>b</button></div>'
    );
    expect(await smallText(page)).toEqual(['measured 0 elements under body — nothing checked']);
    expect(await smallTargets(page)).toEqual(['measured 0 elements under body — nothing checked']);
  });
});

test.describe('screens', () => {
  test.describe.configure({ mode: 'serial' });
  let id = '';
  test.beforeAll(async ({ request }) => {
    id = (await seedCompetition(request, { controls: 8 })).competitionId;
  });

  for (const s of SCREENS) {
    for (const [w, h] of [
      [1366, 768],
      [820, 1180],
    ] as const) {
      test(`${s.name} ${w}×${h}: text ≥ 14 px and targets ≥ 44 px`, async ({ page, request }) => {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(s.url(id));
        await expect(s.ready(page)).toBeVisible();
        await s.prepare?.(page, id, request);
        expect(await smallText(page, { root: s.root })).toEqual([]);
        expect(await smallTargets(page, { root: s.root, labels: true })).toEqual([]);
      });
    }
  }
});
