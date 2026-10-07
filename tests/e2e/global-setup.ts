// Authored for fartola. Not ported from upstream.
//
// Warm the Vite dev server before any spec runs. Vite compiles each route
// and optimizes dependencies on first request, and a cold machine can take
// longer than the 5s expect timeout for that. With several workers the
// first test of every worker hit it at once and timed out on `readout-view`
// (while --workers=1 survived, because only the first test paid). Loading
// each route once in a real browser makes the later specs hit a warm server.
// A real (empty) competition is created through the same proxy the specs
// use, so lazily loaded components (walk-up modal, toasts, tables) compile
// now rather than inside a 5s expect.

import { chromium, type FullConfig, type Page } from '@playwright/test';

const ROUTES = (id: string): string[] => [
  '/',
  '/installningar',
  `/competition/${id}`,
  `/competition/${id}/info`,
  `/competition/${id}/import`,
  `/competition/${id}/readout`,
  `/competition/${id}/readout?walkup=9999999`,
  `/competition/${id}/results`,
  `/competition/${id}/registration`,
  `/competition/${id}/runners`,
  `/competition/${id}/export`,
  `/competition/${id}/hyrbrickor`,
  `/competition/${id}/kvar-i-skogen`,
  `/competition/${id}/lottning`,
];

// Vite can restart its dev server (and briefly refuse connections) when it
// discovers new dependencies, so retry a refused connection instead of
// failing the whole run.
async function gotoWithRetry(page: Page, route: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(route, { timeout: 120_000 });
      return;
    } catch (err) {
      if (attempt >= 5 || !String(err).includes('ERR_CONNECTION_REFUSED')) throw err;
      await page.waitForTimeout(2_000);
    }
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL });
    const created = await page.request.post('/api/competitions', {
      data: { name: 'Warm-up', date: '2026-01-01' },
    });
    const { id } = (await created.json()) as { id: string };
    for (const route of ROUTES(id)) {
      await gotoWithRetry(page, route);
      // Vite may re-optimize deps and reload the page; wait for it to settle.
      await page.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => {});
    }
  } finally {
    await browser.close();
  }
}
