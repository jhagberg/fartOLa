// Authored for fartola. Not ported from upstream.
//
// Component-level test of the ROC section of SettingsView: the real component
// is mounted in jsdom with a routed fake fetch.
//   - Save is off while the settings load or a competition switch is pending,
//     so the defaults can never be saved over the real settings.
//   - A late response for the competition the operator left is ignored.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

import SettingsView from './SettingsView.svelte';
import { activeCompetition } from '#lib/stores/activeCompetition.svelte.ts';

function status(id: string, rocId: string, enabled: boolean) {
  return {
    settings: {
      enabled,
      roc_competition_id: rocId,
      start_id: null,
      last_id: null,
      radio_controls: [],
      start_codes: [],
      check_codes: [],
      finish_codes: [],
      heard_codes: [],
    },
    poll: null,
    now_ms: 0,
    clock_offset_min: 120,
    window_min: 20,
    silence_min: 10,
    coverage_threshold: 0.8,
    controls: [],
    _id: id,
  };
}

interface Pending {
  resolve: (body: unknown) => void;
}

let radioGets: Record<string, Pending>;
let patches: Array<{ url: string; body: unknown }>;

function installFetch(): void {
  radioGets = {};
  patches = [];
  global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const m = /\/api\/competitions\/([^/]+)\/radio\/(status|settings)/.exec(url);
    if (m) {
      if (init?.method === 'PATCH') {
        patches.push({ url, body: JSON.parse(String(init.body)) });
        return json(status(m[1]!, '999', true));
      }
      return new Promise<Response>((resolve) => {
        radioGets[m[1]!] = { resolve: (b) => resolve(json(b)) };
      });
    }
    if (/\/api\/competitions$/.test(url)) return json({ competitions: [] });
    if (url.includes('/liveresultat/')) return json({ liveresultat_id: null, has_password: false });
    if (url.includes('/event-codes')) return json({ codes: [] });
    if (url.includes('/settings/integrations')) return json({ integrations: [] });
    if (url.includes('/settings/meos')) return json({});
    return json({});
  }) as unknown as typeof fetch;
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await tick();
  }
  flushSync();
};

const saveButton = (): HTMLButtonElement =>
  document.querySelector('[data-testid="radio-save"]') as HTMLButtonElement;
const idInput = (): HTMLInputElement =>
  document.querySelector('[data-testid="radio-id"]') as HTMLInputElement;

describe('SettingsView — ROC section', () => {
  let component: ReturnType<typeof mount> | null = null;

  beforeEach(async () => {
    installFetch();
    await activeCompetition.set('A');
  });
  afterEach(() => {
    if (component) void unmount(component);
    component = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps Save off while loading, and a late response for the old competition is ignored', async () => {
    component = mount(SettingsView, { target: document.body });
    await settle();
    // A's settings are still loading.
    expect(saveButton().disabled).toBe(true);
    saveButton().click();
    await settle();
    expect(patches).toHaveLength(0);

    // The operator switches to B before A answers.
    await activeCompetition.set('B');
    await settle();
    expect(saveButton().disabled).toBe(true);

    // B answers first, then A answers late.
    radioGets['B']!.resolve(status('B', '555', true));
    await settle();
    expect(idInput().value).toBe('555');
    expect(saveButton().disabled).toBe(false);
    radioGets['A']!.resolve(status('A', '111', false));
    await settle();
    expect(idInput().value).toBe('555');

    // Saving now writes B's values, to B.
    saveButton().click();
    await settle();
    expect(patches).toHaveLength(1);
    expect(patches[0]!.url).toContain('/competitions/B/radio/settings');
    expect((patches[0]!.body as { roc_competition_id: string }).roc_competition_id).toBe('555');
  });

  it('Save stays off when the settings could not be loaded', async () => {
    component = mount(SettingsView, { target: document.body });
    await settle();
    (radioGets['A'] as Pending).resolve(undefined);
    // An undefined body is not a status: the load fails or yields nothing usable.
    await settle();
    expect(saveButton().disabled).toBe(true);
  });
});
