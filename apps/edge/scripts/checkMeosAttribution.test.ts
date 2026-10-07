// Authored for fartola. Not ported from upstream.
//
// ADR-0001 (2026-10-06): scripts/check-meos-attribution.sh keeps MeOS-ported
// code out of the MIT/shared packages and listed in apps/edge/NOTICE.md.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '../../..');
const SCRIPT = path.join(REPO, 'scripts/check-meos-attribution.sh');
// Built from parts so this test file itself never carries the header.
const HEADER = `// Ported ${'from'} MeOS code/oEventDraw.cpp (melinsoftware/meos, GPL-3.0-or-later).\n`;

function run(root: string): { status: number | null; out: string } {
  const r = spawnSync('bash', [SCRIPT, root], { encoding: 'utf-8' });
  return { status: r.status, out: r.stdout + r.stderr };
}

/** A throwaway repo tree: files maps relative path → content. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'meos-attr-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  return root;
}

describe('check-meos-attribution.sh (ADR-0001)', () => {
  test('a ported file listed in NOTICE.md passes', () => {
    const root = tree({
      'apps/edge/src/draw/pursuit.ts': HEADER + 'export {};\n',
      'apps/edge/NOTICE.md': '- `apps/edge/src/draw/pursuit.ts`\n',
    });
    try {
      const r = run(root);
      assert.equal(r.status, 0, r.out);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a ported file missing from NOTICE.md fails and is named', () => {
    const root = tree({
      'apps/web/src/lib/x.ts': HEADER,
      'apps/edge/NOTICE.md': '# NOTICE\n',
    });
    try {
      const r = run(root);
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, /apps\/web\/src\/lib\/x\.ts/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a ported header under packages/sportident or packages/shared-types fails', () => {
    for (const pkg of ['packages/sportident/src/a.ts', 'packages/shared-types/src/b.ts']) {
      const root = tree({ [pkg]: HEADER, 'apps/edge/NOTICE.md': `- \`${pkg}\`\n` });
      try {
        const r = run(root);
        assert.equal(r.status, 1, `${pkg}: ${r.out}`);
        assert.match(r.out, new RegExp(pkg.replace(/[/.]/g, '\\$&')));
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test('the phrase outside the first 10 lines or outside a comment is not a header', () => {
    const root = tree({
      'apps/edge/src/doc.ts': '\n'.repeat(12) + HEADER,
      'apps/edge/src/str.ts': `const s = '${HEADER.trim()}';\n`,
      'apps/edge/NOTICE.md': '',
    });
    try {
      assert.equal(run(root).status, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a file name with spaces is read whole; any package under packages/ is refused', () => {
    const root = tree({
      'apps/edge/src/a b.ts': HEADER,
      'apps/edge/NOTICE.md': '- `apps/edge/src/a b.ts`\n',
      'packages/other/src/c.ts': HEADER,
    });
    try {
      const r = run(root);
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, /packages\/other\/src\/c\.ts/);
      assert.doesNotMatch(r.out, /a b\.ts/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a long first line does not hide the header (no SIGPIPE skip)', () => {
    const root = tree({
      'apps/edge/src/long.ts': HEADER + 'x'.repeat(200_000) + '\n',
      'apps/edge/NOTICE.md': '',
    });
    try {
      const r = run(root);
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, /long\.ts/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a header without the file path is still a header', () => {
    const root = tree({
      'apps/edge/src/loose.ts': `// Ported ${'from'} MeOS oEventDraw.cpp\n`,
      'apps/edge/NOTICE.md': '',
    });
    try {
      assert.equal(run(root).status, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('this repository passes', () => {
    const r = run(REPO);
    assert.equal(r.status, 0, r.out);
  });
});
