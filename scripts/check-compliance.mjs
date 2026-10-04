#!/usr/bin/env node
// Authored for fartola. Not ported from upstream.
//
// Gate for the rule-compliance matrices in .planning/compliance/*regelverk*.md (one per
// rulebook, e.g. SOFT Regelverk för OL 20260701_2). Fails when
//   - a rule row has no status, or one that is not in the allowed set;
//   - an UPPFYLLD row names no test;
//   - a named test (`file.test.ts` › `test name`) does not exist: the file is
//     missing or does not contain the test name;
//   - the summary table's counts do not match the rows.
// Run: node scripts/check-compliance.mjs   (part of `pnpm lint`).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, '.planning', 'compliance');
const STATUS = /^(UPPFYLLD|DELVIS|SAKNAS|EJ TILLÄMPLIG|PLANERAD \(.+\))$/;
const TEST_REF = /`([^`]+\.test\.ts)` › `([^`]+)`/g;

/** Test paths are relative to apps/edge/src unless they name a package or app. */
const resolveTest = (file) =>
  path.join(ROOT, /^(packages|apps)\//.test(file) ? file : path.join('apps/edge/src', file));

const cells = (line) =>
  line
    .slice(1, line.endsWith('|') ? -1 : undefined)
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());

export function check(markdown, name) {
  const errors = [];
  const counts = new Map();
  let summary = null;
  for (const [i, line] of markdown.split('\n').entries()) {
    const where = `${name}:${i + 1}`;
    if (/^\| (TR|TA) /.test(line)) {
      const [id, , , status = '', evidence = ''] = cells(line);
      if (!STATUS.test(status)) {
        errors.push(`${where} ${id}: okänd eller saknad status "${status}"`);
        continue;
      }
      const key = status.startsWith('PLANERAD') ? 'PLANERAD' : status;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const refs = [...evidence.matchAll(TEST_REF)];
      if (status === 'UPPFYLLD' && refs.length === 0)
        errors.push(`${where} ${id}: UPPFYLLD utan namngivet test`);
      for (const [, file, test] of refs) {
        const full = resolveTest(file);
        if (!existsSync(full)) errors.push(`${where} ${id}: testfilen ${file} finns inte`);
        else if (!readFileSync(full, 'utf-8').includes(test))
          errors.push(`${where} ${id}: testet "${test}" finns inte i ${file}`);
      }
    } else if (/^## Sammanfattning/.test(line)) summary = new Map();
    else if (summary && /^\| (UPPFYLLD|DELVIS|SAKNAS|EJ TILLÄMPLIG|PLANERAD)/.test(line)) {
      const [label, n] = cells(line);
      summary.set(label.split(' ')[0] === 'EJ' ? 'EJ TILLÄMPLIG' : label.split(' ')[0], Number(n));
    } else if (summary && /^## /.test(line)) summary = summary.size ? summary : null;
  }
  if (summary)
    for (const [label, n] of summary)
      if ((counts.get(label) ?? 0) !== n)
        errors.push(
          `${name}: sammanfattningen säger ${label} ${n}, tabellen har ${counts.get(label) ?? 0}`
        );
  return { errors, counts };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Only the rulebook matrices; other notes here (e.g. meos-jamforelse.md) have
  // other columns.
  const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => /regelverk.*\.md$/.test(f)) : [];
  let failed = false;
  for (const f of files) {
    const { errors, counts } = check(readFileSync(path.join(DIR, f), 'utf-8'), f);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    console.log(`${f}: ${total} regler — ${[...counts].map(([k, v]) => `${k} ${v}`).join(', ')}`);
    for (const e of errors) console.error(`  ✖ ${e}`);
    failed ||= errors.length > 0;
  }
  process.exit(failed ? 1 : 0);
}
