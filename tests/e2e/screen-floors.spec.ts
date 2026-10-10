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
];

test.describe('floor helpers', () => {
  const lone = '<ul><li><a href="#" style="font-size:16px">x</a></li></ul>';
  test('report small text and small targets, skip inert, fail on zero', async ({ page }) => {
    await page.setContent(
      `<span class="tiny" style="font-size:12px">tiny</span>
       <button class="btn" style="font-size:16px;width:36px;height:36px">b</button>
       <p>text with <a href="#" style="display:inline">an inline link</a> inside</p>
       <div inert><span style="font-size:12px">hidden tiny</span></div>
       ${lone}`
    );
    expect(await smallText(page)).toEqual(['span.tiny "tiny" 12px']);
    const t = await smallTargets(page);
    expect(t).toHaveLength(2);
    expect(t[0]).toContain('button.btn "b" 36×36');
    expect(t[1]).toContain('a. "x"');

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
