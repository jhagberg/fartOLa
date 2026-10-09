// Authored for fartola. Not ported from upstream.
//
// Gate: no emoji or pictographic symbols used as icons in the web UI
// (todo 2026-10-06, ui-ux-pro-max no-emoji-icons). Icons come from
// <Icon> (Lucide). Comments are ignored; arrows in prose (→ ←) are allowed.
// Receipt templates print plain text and are excluded.
// Run: node scripts/check-icons.mjs   (part of `pnpm lint`).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'apps/web/src');
const BANNED = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}↳⇄▢▶▾●△]/u;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'receipt-templates') yield* files(p);
    } else if (
      (name.endsWith('.svelte') ||
        name.endsWith('.ts') ||
        (p.includes(`${path.sep}i18n${path.sep}`) && name.endsWith('.json'))) &&
      !name.includes('.test.')
    ) {
      yield p;
    }
  }
}

export function stripComments(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '');
}

const errors = [];
for (const file of files(SRC)) {
  stripComments(readFileSync(file, 'utf8'))
    .split('\n')
    .forEach((line, i) => {
      const m = line.match(BANNED);
      if (m) errors.push(`${path.relative(ROOT, file)}:${i + 1}: "${m[0]}" — use <Icon> instead`);
    });
}
if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`\n${errors.length} icon-like symbol(s) found.`);
  process.exit(1);
}
console.log('check-icons: ok');
