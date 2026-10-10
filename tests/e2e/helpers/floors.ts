// tests/e2e/helpers/floors.ts
// Authored for fartola. Not ported from upstream.
//
// ADR-0016 rule 7 floors, measured in the browser: targets ≥ 44 × 44 px
// and no text that carries meaning below 14 px. Skips what a person
// cannot see or reach: inert subtrees (the closed drawer), aria-hidden,
// visually hidden (clipped 1 px) elements, the skip link and the
// receipt mirror (a paper preview, ESC/POS sizes).
import type { Page } from '@playwright/test';

export type FloorOpts = {
  /** CSS selector to measure inside; default the whole page. */
  root?: string;
  /** Also require 44 px width (default true). */
  width?: boolean;
  /** Measure the label row of checkboxes and radios (default false). */
  labels?: boolean;
  /** Fail when fewer elements than this were measured (default 1). */
  min?: number;
};

const nothing = (root: string | undefined, n: number, min: number): string[] =>
  n < min ? [`measured ${n} elements under ${root ?? 'body'} — nothing checked`] : [];

const HIDDEN = '[inert], [aria-hidden="true"], .skip-link, .receipt-mirror';

export async function smallTargets(page: Page, opts: FloorOpts = {}): Promise<string[]> {
  const { out, n } = await page
    .locator(opts.root ?? 'body')
    .first()
    .evaluate(
      (root, { hidden, width, labels }) => {
        const seen = (e: Element): boolean => {
          if (e.closest(hidden)) return false;
          const r = e.getBoundingClientRect();
          const s = getComputedStyle(e);
          if (r.width <= 1 || r.height <= 1 || s.visibility === 'hidden') return false;
          if (s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)') return false;
          return r.bottom > 0 && r.right > 0 && r.top < innerHeight * 3 && r.left < innerWidth;
        };
        const name = (e: Element, r: DOMRect) =>
          `${e.tagName.toLowerCase()}.${[...e.classList].join('.')} "${(e.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.width)}×${Math.round(r.height)}`;
        const out: string[] = [];
        let n = 0;
        const sel =
          'button, a[href], input:not([type=checkbox]):not([type=radio]):not([type=file]), select, [role="button"], summary';
        for (const e of root.querySelectorAll(sel)) {
          if (!seen(e)) continue;
          n++;
          // WCAG 2.5.8 inline exception: a link inside running text, i.e.
          // inline and its parent has text of its own.
          if (
            e.tagName === 'A' &&
            getComputedStyle(e).display === 'inline' &&
            [...(e.parentElement?.childNodes ?? [])].some(
              (c) => c.nodeType === Node.TEXT_NODE && (c.textContent ?? '').trim() !== ''
            )
          )
            continue;
          const r = e.getBoundingClientRect();
          if (Math.round(r.height) < 44 || (width && Math.round(r.width) < 44))
            out.push(name(e, r));
        }
        if (labels) {
          for (const i of root.querySelectorAll('input[type=checkbox], input[type=radio]')) {
            const l =
              i.closest('label') ?? (i.id ? root.querySelector(`label[for="${i.id}"]`) : null);
            if (!l || !seen(l)) continue;
            n++;
            const r = l.getBoundingClientRect();
            if (Math.round(r.height) < 44) out.push(name(l, r));
          }
        }
        return { out, n };
      },
      { hidden: HIDDEN, width: opts.width ?? true, labels: opts.labels ?? false }
    );
  return [...nothing(opts.root, n, opts.min ?? 1), ...out];
}

export async function smallText(
  page: Page,
  opts: FloorOpts & { minPx?: number } = {}
): Promise<string[]> {
  const { out, n } = await page
    .locator(opts.root ?? 'body')
    .first()
    .evaluate(
      (root, { hidden, min }) => {
        let n = 0;
        const out = [...root.querySelectorAll('*')]
          .filter((e) => {
            if (e.closest(`${hidden}, script, style`)) return false;
            const own = [...e.childNodes]
              .filter((n) => n.nodeType === Node.TEXT_NODE)
              .map((n) => n.textContent ?? '')
              .join('')
              .trim();
            if (!own) return false;
            const r = e.getBoundingClientRect();
            const s = getComputedStyle(e);
            if (r.width <= 1 || r.height <= 1 || s.visibility === 'hidden') return false;
            if (s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)') return false;
            n++;
            return parseFloat(s.fontSize) < min;
          })
          .map(
            (e) =>
              `${e.tagName.toLowerCase()}.${[...e.classList].join('.')} "${(e.textContent ?? '').trim().slice(0, 30)}" ${getComputedStyle(e).fontSize}`
          );
        return { out, n };
      },
      { hidden: HIDDEN, min: opts.minPx ?? 14 }
    );
  return [...nothing(opts.root, n, opts.min ?? 1), ...out];
}
