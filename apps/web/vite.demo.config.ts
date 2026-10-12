// Authored for fartola. Not ported from upstream.
//
// Builds the public speaker demo (src/demo) as a static page of its own:
//   pnpm --filter @fartola/web build:demo   →  docs/speaker-demo/
// The Pages workflow runs it; the output is not committed. Plain Vite with
// the Svelte plugin, no SvelteKit: the demo is one screen without routes.
//
// The demo imports the server's board calculation
// (apps/edge/src/speaker/board.ts) as it is. The guard below stops the
// build if that file, or anything it imports, starts to need Node or a
// server package: such code must not end up in a browser bundle.

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vite';

const noServerCode: Plugin = {
  name: 'fartola-no-server-code',
  enforce: 'pre',
  resolveId(id, importer) {
    const bare = !/^[./\0]/.test(id);
    if (
      id.startsWith('node:') ||
      (bare && importer?.includes('/apps/edge/') && id !== '@fartola/shared-types')
    )
      this.error(`${importer} imports ${id}: server code must not reach the demo bundle`);
  },
};

export default defineConfig({
  root: 'src/demo',
  base: './',
  plugins: [noServerCode, svelte()],
  build: { outDir: '../../../../docs/speaker-demo', emptyOutDir: true },
});
