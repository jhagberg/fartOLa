// tests/e2e/design-lab-screens.spec.ts
// Authored for fartola. Not ported from upstream.
//
// Design-lab screenshot harness, opt-in: runs only with
// DESIGN_LAB_SHOTS=<output dir>. Seeds a 22-control course with every
// punch state (miss, wrong order, extra, struck) and shoots every screen
// at laptop and tablet size, default and bright-sun.
//   DESIGN_LAB_SHOTS=~/src/fartOLa-workdirs/fartOLa-docs/design-lab-2026-10/before \
//     pnpm e2e design-lab-screens --workers=1

import { test } from '@playwright/test';
import { longCourseCodes } from './helpers/long-course.ts';
import { seedCompetition, simulateRead, voidControl } from './helpers/seed.ts';

const OUT = process.env['DESIGN_LAB_SHOTS'];
test.skip(!OUT, 'set DESIGN_LAB_SHOTS=<dir> to take design-lab screenshots');
test.describe.configure({ mode: 'serial' });

const SIZES = [
  ['laptop', { width: 1366, height: 768 }],
  ['tablet', { width: 820, height: 1180 }],
] as const;

test('design-lab screens', async ({ browser, request }) => {
  test.setTimeout(300_000);
  const { competitionId: id } = await seedCompetition(request, { controls: 22 });
  const codes = longCourseCodes(22);
  await voidControl(request, id, codes[5]!);
  // Cia (D21, short course) clean; Anna (H21) with 35/34 swapped, 99 extra.
  await simulateRead(request, id, 1_428_824, codes.slice(0, 4));
  const anna = [...codes.slice(0, 3), codes[4]!, codes[3]!, 99, ...codes.slice(5)];
  await simulateRead(request, id, 7_501_853, anna);

  const screens: Array<[string, string]> = [
    ['home', '/'],
    ['readout', `/competition/${id}/readout`],
    ['walkup', `/competition/${id}/readout?walkup=7500123`],
    ['registration', `/competition/${id}/registration`],
    ['runners', `/competition/${id}/runners`],
    ['lottning', `/competition/${id}/lottning`],
    ['results', `/competition/${id}/results`],
    ['export', `/competition/${id}/export`],
    ['eventor', `/competition/${id}/eventor-publish`],
    ['kvar-i-skogen', `/competition/${id}/kvar-i-skogen`],
    ['hyrbrickor', `/competition/${id}/hyrbrickor`],
    ['info', `/competition/${id}/info`],
    ['import', `/competition/${id}/import`],
    ['installningar', '/installningar'],
    ['access', '/access'],
  ];
  for (const [mode, high] of [
    ['default', false],
    ['sun', true],
  ] as const) {
    for (const [tag, viewport] of SIZES) {
      const page = await browser.newPage({ viewport });
      for (const [name, url] of screens) {
        await page.goto(url);
        // Some screens keep a request open (live results); don't wait forever.
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        if (high)
          await page.evaluate(() => document.documentElement.classList.add('contrast-high'));
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}/${name}-${tag}-${mode}.png`, fullPage: true });
      }
      await page.goto('/');
      await page.getByTestId('open-wizard').first().click();
      await page.getByTestId('wiz-name').waitFor();
      if (high) await page.evaluate(() => document.documentElement.classList.add('contrast-high'));
      await page.screenshot({ path: `${OUT}/wizard-${tag}-${mode}.png` });
      await page.close();
    }
  }

  // Colour-blind check of the readout (spec "Verification"): Machado 2009
  // matrices in linear RGB, plus greyscale.
  const M: Record<string, string> = {
    deut: '0.367322 0.860646 -0.227968 0 0 0.280085 0.672501 0.047413 0 0 -0.011820 0.042940 0.968881 0 0 0 0 0 1 0',
    prot: '0.152286 1.052583 -0.204868 0 0 0.114503 0.786281 0.099216 0 0 -0.003882 -0.048116 1.051998 0 0 0 0 0 1 0',
    trit: '1.255528 -0.076749 -0.178779 0 0 -0.078411 0.930809 0.147602 0 0 0.004733 0.691367 0.303900 0 0 0 0 0 1 0',
  };
  const page = await browser.newPage({ viewport: SIZES[0][1] });
  await page.goto(`/competition/${id}/readout`);
  await page.waitForLoadState('networkidle');
  for (const sim of ['deut', 'prot', 'trit', 'grey']) {
    await page.evaluate(
      ([name, values]) => {
        document.getElementById('cvd')?.remove();
        if (values) {
          document.body.insertAdjacentHTML(
            'beforeend',
            `<svg id="cvd" width="0" height="0" style="position:absolute"><filter id="f" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="${values}"/></filter></svg>`
          );
        }
        document.documentElement.style.filter = name === 'grey' ? 'grayscale(1)' : 'url(#f)';
      },
      [sim, M[sim] ?? ''] as const
    );
    await page.screenshot({ path: `${OUT}/readout-laptop-${sim}.png` });
  }
  await page.close();
});
