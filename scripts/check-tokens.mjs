// Authored for fartola. Not ported from upstream.
//
// Gate: every CSS custom property a Svelte file reads with var(--x) is
// declared in apps/web/src/lib/tokens.css or in that file (a local
// --x: …). An undefined token silently drops the style: in the audit
// --err/--warn left error boxes unstyled (EX-1, EV-1, KV-5).
// Run: node scripts/check-tokens.mjs   (part of `pnpm lint`).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'apps/web/src');
const TOKENS = readFileSync(path.join(SRC, 'lib/tokens.css'), 'utf8');

// Known exceptions as "<file> <token>"; the list may only shrink. Empty
// since m2-fees replaced --bg-soft (main 5bde523).
const KNOWN = new Set([]);

// Comments are blanked first (newlines kept, so line numbers hold): a
// comment that mentions "--mp-soft:" must not count as a declaration.
const strip = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
const declared = (text) => new Set([...text.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
const global = declared(strip(TOKENS));

function* svelteFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* svelteFiles(p);
    else if (name.endsWith('.svelte')) yield p;
  }
}

const errors = [];
for (const file of svelteFiles(SRC)) {
  const text = strip(readFileSync(file, 'utf8'));
  const local = declared(text);
  const rel = path.relative(ROOT, file);
  for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) {
    const name = m[1];
    if (global.has(name) || local.has(name) || KNOWN.has(`${rel} ${name}`)) continue;
    const line = text.slice(0, m.index).split('\n').length;
    errors.push(`${rel}:${line}: ${name} is not defined in tokens.css`);
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`\n${errors.length} undefined token(s).`);
  process.exit(1);
}
console.log('check-tokens: ok');
