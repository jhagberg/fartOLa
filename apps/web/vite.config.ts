// Authored for fartola. Not ported from upstream.
//
// Vite config for the SvelteKit SPA. Three responsibilities:
//   1. SvelteKit config (SvelteKit 3 reads it from the sveltekit() plugin;
//      svelte.config.js is no longer used). SPA mode via
//      @sveltejs/adapter-static with fallback: '200.html' — the edge bridge
//      (apps/edge) serves the built apps/web/build/ directory and falls back
//      to 200.html on any non-API/non-WS path so SvelteKit's client-side
//      router can take over. strict: false because dynamic-route data (e.g.
//      competition/[id]) is loaded at runtime via REST; SvelteKit's
//      prerender pass would otherwise warn on unprerendered dynamic routes.
//      Locked by .planning/phases/01-single-laptop-training-mvp/01-RESEARCH.md
//      §"svelte.config.js" + Pitfall 1.
//   2. Dev-server proxy: /api/* → http://localhost:3000 (Fastify) and
//      /ws → ws://localhost:3000 (WebSocket upgrade). Locked by
//      .planning/phases/01-single-laptop-training-mvp/01-RESEARCH.md
//      Pitfall 2 — without these, the dev experience can't reach the
//      bridge.
//   3. Vitest config inlined (test block). RESEARCH §"validation
//      architecture" allows vitest config to live inside vite.config.ts;
//      vitest.config.ts re-exports this file so the planner's
//      file-presence intent is preserved.

import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// Edge API port — defaults to the production-tarball default (3000). The
// Playwright config overrides this to 3001 so test runs never collide
// with a manually-installed fartola on :3000 (the source of the E2E test-
// data pollution we hit on 2026-05-18: reuseExistingServer made tests
// silently piggyback on the prod instance).
const FARTOLA_EDGE_PORT = process.env['FARTOLA_EDGE_PORT'] ?? '3000';

export default defineConfig({
  plugins: [
    sveltekit({
      preprocess: vitePreprocess(),
      adapter: adapter({ fallback: '200.html', strict: false }),
      prerender: { entries: [] },
    }),
  ],
  // Component tests mount Svelte components in jsdom: resolve svelte's client
  // build there (its default under Node is the server build, no mount()).
  ...(process.env['VITEST'] ? { resolve: { conditions: ['browser'] } } : {}),
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${FARTOLA_EDGE_PORT}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://localhost:${FARTOLA_EDGE_PORT}`,
        ws: true,
      },
    },
  },
  // Component tests mount Svelte in jsdom: resolve its client build, not
  // the server one (otherwise mount() throws lifecycle_function_unavailable).
  resolve: process.env['VITEST'] ? { conditions: ['browser'] } : {},
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    // 10s ceiling lets the i18n Pitfall-10 sync-bootstrap test ride out a
    // cold Vite transform without flaking (initial run can hit ~5s).
    testTimeout: 10000,
  },
});
