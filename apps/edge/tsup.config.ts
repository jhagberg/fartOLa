// Authored for fartola. Not ported from upstream.
//
// tsup build config for @fartola/edge. Mirrors packages/sportident/tsup.config.ts
// with two entry-point changes: src/server.ts (the Fastify factory) and
// src/bin/fartola.ts (the binary). Locked by
// .planning/phases/01-single-laptop-training-mvp/01-PATTERNS.md
// §"apps/edge/tsup.config.ts" + §"apps/edge/package.json" and extended by
// .planning/phases/01-single-laptop-training-mvp/01-18-PLAN.md task 1.
//
// outExtension is load-bearing: package.json `bin` resolves to
// ./dist/bin/fartola.cjs, which only exists when format===cjs emits .cjs.
//
// Plan 18 — `noExternal` bundles the workspace packages into the edge dist
// so the published tarball is self-contained: users running
// `npm install -g fartola-*.tgz` don't need a separate publish step for
// @fartola/sportident or @fartola/shared-types. Everything else (fastify,
// better-sqlite3 with its prebuilt native binding, drizzle-orm, ...) stays
// external and is resolved by npm from the tarball's dependencies block.

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/bin/fartola.ts'],
  format: ['esm', 'cjs'],
  // TypeScript 6 deprecates baseUrl, and tsup 8.5.1 (the last release)
  // always injects baseUrl into its dts build. Scoped to tsup only;
  // typecheck still reports deprecations.
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  sourcemap: true,
  clean: true,
  target: 'node24',
  splitting: false,
  outDir: 'dist',
  // Plan 18: bundle workspace deps so the published tarball is self-contained.
  // better-sqlite3 / fastify / drizzle stay external (resolved at npm install).
  noExternal: ['@fartola/sportident', '@fartola/shared-types'],
  // Plan 18: shim `import.meta.url` for the CJS build so xml/validate.ts and
  // server.ts (defaultStaticRoot) resolve their __dirname-equivalents under
  // the bin path `dist/bin/fartola.cjs`. Without this, esbuild leaves
  // `import_meta.url` undefined in CJS output and the bin crashes at startup
  // with `ERR_INVALID_ARG_TYPE` from `fileURLToPath(undefined)`.
  shims: true,
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' };
  },
  esbuildOptions(options) {
    options.logOverride = {
      ...options.logOverride,
      'empty-import-meta': 'silent',
    };
  },
});
