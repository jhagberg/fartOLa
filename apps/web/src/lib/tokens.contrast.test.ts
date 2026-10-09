/**
 * @vitest-environment node
 */
// Authored for fartola. Not ported from upstream.
//
// ADR-0016 rule 7: the text/background pairs the design-lab spec lists
// meet their contrast floor, in the default palette and in bright-sun
// mode (.contrast-high = :root + its overrides). WCAG 2.x relative
// luminance; oklch → linear sRGB per CSS Color 4.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Comments removed first: a comment that mentions a token ("--mp-soft:")
// would otherwise swallow the next declaration.
const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
);

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no "${selector} {" block in tokens.css`);
  const body = css.slice(start, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

function linear(color: string): [number, number, number] {
  const ok = color.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (ok) {
    const [L, C, h] = [Number(ok[1]), Number(ok[2]), (Number(ok[3]) * Math.PI) / 180];
    const a = C * Math.cos(h);
    const b = C * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    return [
      clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    ];
  }
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) throw new Error(`unsupported colour "${color}"`);
  const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join('') : hex[1]!;
  const ch = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [ch(0), ch(2), ch(4)];
}

const lum = (c: string) => {
  const [r, g, b] = linear(c);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** [foreground, background, floor]: token names or literal colours. */
const PAIRS: Array<[string, string, number]> = [
  ['--fg', '--bg', 7],
  ['--fg-muted', '--bg', 7],
  ['--fg-muted', '--bg-sunken', 7],
  ['--fg-muted', '--pend-soft', 7],
  ['--fg-faint', '--bg', 4.5],
  ['--accent-fg', '--accent', 4.5],
  ['--ok', '--ok-soft', 4.5],
  ['--mp-fg', '--mp-soft', 4.5],
  ['--dnf', '--dnf-soft', 4.5],
  ['--dns', '--dns-soft', 4.5],
  ['--dq', '--dq-soft', 4.5],
  ['--cancel', '--cancel-soft', 4.5],
  ['--max', '--max-soft', 4.5],
  ['--fg', '--punch-ok-fill', 4.5],
  ['--fg-muted', '--punch-ok-fill', 4.5],
  ['--punch-ok-line', '--punch-ok-fill', 4.5],
  ['--punch-miss-fg', '--punch-miss-fill', 4.5],
  ['--fg', '--punch-order-fill', 4.5],
  ['--fg-muted', '--punch-order-fill', 4.5],
  ['--punch-order-line', '--punch-order-fill', 4.5],
  // non-text: control borders, the focus ring on the page
  ['--border-strong', '--bg-elev', 3],
  ['--border-strong', '--bg-sunken', 3],
  ['--fg', '--bg-elev', 3],
];

const root = block(':root');
const MODES: Record<string, Record<string, string>> = {
  default: root,
  'bright-sun': { ...root, ...block('.contrast-high') },
};

function resolve(tokens: Record<string, string>, v: string): string {
  if (!v.startsWith('--')) return v;
  const value = tokens[v];
  if (value === undefined) throw new Error(`token ${v} missing`);
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  return ref ? resolve(tokens, ref[1]!) : value;
}

describe.each(Object.entries(MODES))('tokens.css contrast — %s', (_mode, tokens) => {
  it.each(PAIRS)('%s on %s ≥ %d:1', (fg, bg, floor) => {
    const r = ratio(resolve(tokens, fg), resolve(tokens, bg));
    // PRINT_CONTRAST=1 prints the table for docs/design-lab/README.md.
    if (process.env['PRINT_CONTRAST'])
      console.log(`| ${_mode} | \`${fg}\` | \`${bg}\` | ${r.toFixed(2)} | ${floor} |`);
    expect(r).toBeGreaterThanOrEqual(floor);
  });
});

describe('accent variants keep button text readable', () => {
  it.each(['blue', 'magenta', 'charcoal'])('%s', (accent) => {
    const tokens = { ...root, ...block(`[data-accent='${accent}']`) };
    expect(
      ratio(resolve(tokens, '--accent-fg'), resolve(tokens, '--accent'))
    ).toBeGreaterThanOrEqual(4.5);
  });
});
