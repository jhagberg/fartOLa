// Authored for fartola. Not ported from upstream.
//
// Component test of SmartRunnerSearch: closing the name list keeps it
// closed. The club-filter effect must follow clubId only, not every query.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import SmartRunnerSearch from './SmartRunnerSearch.svelte';

let lookups: string[];

beforeEach(() => {
  vi.useFakeTimers();
  lookups = [];
  global.fetch = vi.fn(async (url: string | URL | Request) => {
    lookups.push(String(url));
    return new Response(
      JSON.stringify({
        suggestions: [
          {
            person_id: 1,
            family_name: 'Hagberg',
            given_name: 'Jonas',
            club_name: 'Stora Tuna OK',
            si_card: null,
            birth_year: 1980,
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SmartRunnerSearch', () => {
  it('stays closed after Escape once the debounce window has passed', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const app = mount(SmartRunnerSearch, {
      target,
      props: { value: 'Hag', id: 'srs', onValue: () => {}, onPick: () => {} },
    });
    const input = target.querySelector('input') as HTMLInputElement;
    input.value = 'Hag';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(250);
    flushSync();
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(lookups).toHaveLength(1);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    expect(input.getAttribute('aria-expanded')).toBe('false');

    await vi.advanceTimersByTimeAsync(500);
    await tick();
    expect(lookups).toHaveLength(1);
    expect(input.getAttribute('aria-expanded')).toBe('false');

    unmount(app);
    target.remove();
  });
});
