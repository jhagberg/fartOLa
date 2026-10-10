// Authored for fartola. Not ported from upstream.
//
// Component test for the card type in the LatestReadCard header
// ("Bricka SIAC", "Bricka SI10", "Bricka SI5"). Synthetic data only.

import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import LatestReadCard from './LatestReadCard.svelte';

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
  ...over,
});

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
