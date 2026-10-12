// Authored for fartola. Not ported from upstream.
//
// The demo's playback bar in jsdom: it shows the clock and the controls,
// and a new speed changes how fast the clock runs.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PlaybackBar from './PlaybackBar.svelte';
import { createClock } from './playback.ts';

const START = Date.parse('2031-06-07T08:00:00Z'); // 10:00:00 on a +120 clock
const END = START + 3 * 3_600_000;

describe('PlaybackBar', () => {
  let component: ReturnType<typeof mount> | null = null;
  let now = 0;
  const q = (id: string): HTMLElement => document.querySelector(`[data-testid="${id}"]`)!;
  const clockText = (): string => q('demo-clock').textContent!.trim();
  /** Real time passes, and the bar's five-times-a-second tick runs. */
  function pass(ms: number): void {
    now += ms;
    vi.advanceTimersByTime(ms);
    flushSync();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
    const clock = createClock(START, END, () => now);
    component = mount(PlaybackBar, {
      target: document.body,
      props: {
        clock,
        time: START,
        offsetMin: 120,
        density: [0, 3, 9, 1],
        outages: [[START + 3_600_000, START + 5_400_000]],
      },
    });
    flushSync();
  });

  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('shows play, the clock, three speeds, the timeline and the radio outage', () => {
    expect(q('demo-play').textContent).toContain('Spela');
    expect(clockText()).toBe('10:00:00');
    const speeds = [...document.querySelectorAll('[data-testid="demo-speed"]')];
    expect(speeds.map((b) => b.textContent!.trim())).toEqual(['1×', '10×', '60×']);
    expect(speeds.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    expect((q('demo-seek') as HTMLInputElement).getAttribute('aria-valuetext')).toBe('10:00:00');
    expect(q('demo-outage').textContent).toContain('Radioavbrott 11:00–11:30');
    // The outage covers the second sixth of the three hours.
    expect(q('demo-outage-mark').getAttribute('style')).toMatch(
      /left: 33\.3\d*%; width: 16\.6\d*%/
    );
    expect(document.querySelectorAll('.d')).toHaveLength(4);
  });

  it('changing speed changes how fast the clock runs', () => {
    q('demo-play').click();
    flushSync();
    expect(q('demo-play').textContent).toContain('Pausa');
    pass(2000);
    expect(clockText()).toBe('10:00:02');
    [...document.querySelectorAll<HTMLElement>('[data-testid="demo-speed"]')][2]!.click();
    flushSync();
    pass(2000);
    expect(clockText()).toBe('10:02:02');
    q('demo-play').click();
    pass(2000);
    expect(clockText()).toBe('10:02:02');
  });

  it('the timeline and the outage button jump in time', () => {
    const seek = q('demo-seek') as HTMLInputElement;
    seek.value = String(START + 90 * 60_000);
    seek.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(clockText()).toBe('11:30:00');
    q('demo-outage').click();
    flushSync();
    expect(clockText()).toBe('10:59:00');
  });
});
