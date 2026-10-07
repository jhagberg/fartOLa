import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin/fartola-readout.ts', 'src/bin/fartola-trainer.ts'],
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
  // outExtension (codex review #12): explicit .mjs/.cjs so package.json bin and
  // exports paths resolve to actual files on disk. Plan 05 may extend this with
  // shebang handling for the bin entry, but the extension contract is locked here.
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' };
  },
  // IN-001 (codex review 2026-05-13): the CJS bundle parses `import.meta.url`
  // (from the createRequire shim in SerialTransport.ts) but doesn't reach it at
  // runtime — the CR-001 fix guards via `typeof import.meta`. esbuild warns
  // anyway. Silence only this specific warning so genuine future warnings stay
  // visible.
  esbuildOptions(options) {
    options.logOverride = {
      ...options.logOverride,
      'empty-import-meta': 'silent',
    };
  },
});
