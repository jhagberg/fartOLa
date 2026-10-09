// Authored for fartola. Not ported from upstream.
//
// Component-level test: the mounted RadioStatusPanel ignores a late answer for
// the competition the operator has switched away from.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import RadioStatusPanel from './RadioStatusPanel.svelte';
import { panelProps } from './RadioStatusPanel.testprops.svelte.ts';

function status(code: number, state: 'ok' | 'few' | 'silent' = 'ok') {
  return {
    settings: {
      enabled: true,
      roc_competition_id: '2380',
      start_id: 1,
      last_id: 2,
      radio_controls: [],
      start_codes: [],
      check_codes: [],
      finish_codes: [],
      heard_codes: [],
    },
    poll: null,
    now_ms: 1_000_000,
    clock_offset_min: 120,
    window_min: 20,
    silence_min: 10,
    coverage_threshold: 0.8,
    controls: [
      {
        role: 'control',
        unknown_unit: false,
        control_code: code,
        state,
        last_heard_ms: 900_000,
        median_delay_ms: 1000,
        listed: false,
        received: 3,
        window_card_punches: 0,
        window_matched: 0,
        coverage: null,
        siac_card_punches: 0,
        siac_matched: 0,
        other_card_punches: 0,
        other_matched: 0,
        siac_problem: false,
        date_mismatch_count: 0,
      },
    ],
  };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await tick();
  }
  flushSync();
};

describe('RadioStatusPanel', () => {
  let component: ReturnType<typeof mount> | null = null;
  let answers: Record<string, (body: unknown) => void>;

  beforeEach(() => {
    answers = {};
    global.fetch = vi.fn(
      (input: string | URL | Request) =>
        new Promise<Response>((resolve) => {
          const id = /competitions\/([^/]+)\/radio/.exec(String(input))![1]!;
          answers[id] = (body) =>
            resolve(
              new Response(JSON.stringify(body), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              })
            );
        })
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('a late response for the previous competition does not replace the current one', async () => {
    panelProps.competitionId = 'A';
    component = mount(RadioStatusPanel, { target: document.body, props: panelProps });
    await settle();
    panelProps.competitionId = 'B';
    await settle();

    answers['B']!(status(200));
    await settle();
    const codes = () =>
      [...document.querySelectorAll('[data-testid="radio-control"]')].map((e) =>
        e.getAttribute('data-code')
      );
    expect(codes()).toEqual(['200']);

    answers['A']!(status(100));
    await settle();
    expect(codes()).toEqual(['200']);
  });

  it.each([
    ['ok', 'OK', 'lucide-check'],
    ['few', 'Få stämplingar', 'lucide-triangle-alert'],
    ['silent', 'Tyst', 'lucide-x'],
  ] as const)(
    'shows state %s as a Lucide icon plus the word, no symbol glyph',
    async (state, word, icon) => {
      panelProps.competitionId = 'A';
      component = mount(RadioStatusPanel, { target: document.body, props: panelProps });
      await settle();
      answers['A']!(status(100, state));
      await settle();
      const stateEl = document.querySelector('[data-testid="radio-control"] .state')!;
      expect(stateEl.textContent?.trim()).toBe(word);
      const svg = stateEl.querySelector('svg');
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.getAttribute('class')).toContain(icon);
    }
  );
});
