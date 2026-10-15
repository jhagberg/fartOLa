// Authored for fartola. Not ported from upstream.
//
// Component test for the card type in the LatestReadCard header
// ("Bricka SIAC", "Bricka SI10", "Bricka SI5"). Synthetic data only.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import LatestReadCard from './LatestReadCard.svelte';
import { ApiError } from '../api/client.ts';

type Read = NonNullable<Parameters<typeof LatestReadCard>[1]['read']>;

const read = (over: Partial<Read> = {}): Read => ({
  cardNumber: 8_123_456,
  cardType: 'SIAC',
  name: 'Anna Testsson',
  cls: 'D21',
  club: 'OK Test',
  startTime: '10:00:00',
  readTime: '11:02:03',
  elapsed: '58:12',
  status: 'OK',
  manual_status: null,
  place: null,
  untimed: false,
  unknown: false,
  competitorId: 'c1',
  missingStart: false,
  missingStartHint: null,
  startWarning: null,
  corrections: [],
  firstLast: [],
  ...over,
});

/** Text of the elements an input's aria-describedby points at. */
const describedBy = (el: Element | null): string =>
  (el?.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
    .join(' ')
    .trim();

let instance: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (instance) void unmount(instance);
  instance = null;
  document.body.innerHTML = '';
});

function html(r: Read): HTMLElement {
  instance = mount(LatestReadCard, { target: document.body, props: { read: r } });
  flushSync();
  return document.body;
}

describe('LatestReadCard header — card type', () => {
  it.each(['SIAC', 'SI10', 'SI5'])('shows "Bricka %s"', (type) => {
    const el = html(read({ cardType: type })).querySelector('[data-testid="card-type"]');
    expect(el?.textContent?.replace(/\s+/g, ' ').trim()).toBe(`Bricka ${type}`);
  });

  it('shows no card type when the read has none', () => {
    expect(html(read({ cardType: null })).querySelector('[data-testid="card-type"]')).toBeNull();
  });
});

describe('LatestReadCard header — untimed class', () => {
  it('shows "Utan tidtagning" for a class without timing', () => {
    const el = html(read({ untimed: true })).querySelector('[data-testid="untimed"]');
    expect(el?.textContent).toBe('Utan tidtagning');
  });

  it('shows nothing for a timed class', () => {
    expect(html(read()).querySelector('[data-testid="untimed"]')).toBeNull();
  });
});

describe('LatestReadCard manual-status picker', () => {
  it('saves with "Spara", not the walk-up form\'s label', () => {
    const el = html(read());
    el.querySelector<HTMLButtonElement>('[data-testid="manual-dnf-btn"]')!.click();
    flushSync();
    expect(el.querySelector('[data-testid="dnf-confirm"]')?.textContent?.trim()).toBe('Spara');
  });
});

describe('LatestReadCard failed status save', () => {
  it('says why in plain words, never the server text', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onManualStatus = vi
      .fn()
      .mockRejectedValue(
        new ApiError(500, 'SQLITE_BUSY: database is locked', { error: 'SQLITE_BUSY' }, '')
      );
    instance = mount(LatestReadCard, {
      target: document.body,
      props: { read: read(), onManualStatus },
    });
    flushSync();
    const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
    q('manual-dnf-btn').click();
    flushSync();
    q('dnf-confirm').click();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    await tick();
    flushSync();
    expect(onManualStatus).toHaveBeenCalled();
    const err = document.querySelector('.dnf-error')!.textContent!;
    expect(err).toContain('Statusen sparades inte.');
    expect(err).toContain('Något gick fel');
    expect(document.body.textContent).not.toContain('SQLITE_BUSY');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe('LatestReadCard corrections', () => {
  it('shows the corrections in force, so a read-out never hides them', () => {
    const el = html(
      read({
        corrections: [
          {
            key: 'corr.line.finish',
            vars: { time: '10:42:30', reason: 'Målenheten fungerade inte' },
          },
        ],
      })
    ).querySelector('[data-testid="corrections-line"]');
    expect(el?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Måltid för hand 10:42:30: Målenheten fungerade inte'
    );
  });

  it('shows nothing without corrections', () => {
    expect(html(read()).querySelector('[data-testid="corrections-line"]')).toBeNull();
  });
});

describe('LatestReadCard first and last punch (ADR-0019 step 2)', () => {
  it('shows the first and the last finish, the last marked as used', () => {
    const el = html(
      read({
        firstLast: [
          { kind: 'finish', first: '10:29:30', last: '10:30:00 (kod 100)', lastUsed: true },
        ],
      })
    ).querySelector('[data-testid="first-last-finish"]');
    expect(el?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Första mål 10:29:30 Sista mål 10:30:00 (kod 100) (används)'
    );
  });

  it('shows the start pair without a mark when the drawn start time counts', () => {
    const el = html(
      read({ firstLast: [{ kind: 'start', first: '10:00:10', last: '10:00:20', lastUsed: false }] })
    ).querySelector('[data-testid="first-last-start"]');
    expect(el?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Första start 10:00:10 Sista start 10:00:20'
    );
  });

  it('shows nothing when first and last are the same punch or the card has no first', () => {
    expect(html(read()).querySelector('[data-testid="first-last"]')).toBeNull();
  });
});

describe('LatestReadCard missing start', () => {
  it('the start field says it takes a time of day', () => {
    const el = html(read({ missingStart: true })).querySelector(
      '[data-testid="missing-start-input"]'
    );
    expect(describedBy(el)).toBe('Klockslag, TT:MM:SS');
  });
});
