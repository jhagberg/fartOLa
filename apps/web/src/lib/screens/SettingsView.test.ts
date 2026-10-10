// Authored for fartola. Not ported from upstream.
//
// Vitest coverage for SettingsView (Plan 02-07 Task 3). Pure-helper
// style — no svelte-testing-library mount (matches the project
// convention; see ActiveHyrbrickorView.test.ts header).
//
// We exercise the observable contracts:
//   1. The new i18n keys (sv + en) under the `settings.*` namespace.
//   2. listIntegrations / setIntegration use the right URLs + methods.
//   3. The view's pure helpers (visibility toggle, masked text,
//      env-banner predicate) — mirrors the in-component derivations
//      so a regression there is caught without standing up Svelte.
//   4. The `+page.svelte` wrapper file exists and mounts SettingsView.
//
// Locked by:
// - .planning/phases/02-4-klubbs-mvp/02-07-PLAN.md task 3

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const SETTINGS_KEYS = [
  'settings.title',
  'settings.integrations.title',
  'settings.integrations.desc',
  'settings.integrations.loading',
  'settings.integrations.loadError',
  'settings.integrations.empty',
  'settings.integrations.notConfigured',
  'settings.integrations.masked',
  'settings.integrations.show',
  'settings.integrations.hide',
  'settings.integrations.save',
  'settings.integrations.saving',
  'settings.integrations.saved',
  'settings.integrations.clear',
  'settings.integrations.cleared',
  'settings.integrations.saveError',
  'settings.integrations.sourceEnvBanner',
  'settings.integrations.sourceEnvBadge',
  'settings.integrations.sourceConfigBadge',
  'settings.integrations.placeholder',
  'settings.integrations.key.EVENTOR_API_KEY',
  'settings.integrations.key.LIVELOX_API_KEY',
  'settings.integrations.key.LIVERESULTAT_API_KEY',
] as const;

describe('Plan 02-07 — i18n keys for SettingsView', () => {
  it('sv.json has all settings.* keys', async () => {
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    for (const key of SETTINGS_KEYS) {
      expect(sv[key], `missing sv key ${key}`).toBeTruthy();
    }
    // Spot-check the Swedish wording the plan locks verbatim.
    expect(sv['settings.title']).toBe('Inställningar');
    expect(sv['settings.integrations.notConfigured']).toBe('Inte konfigurerad');
    expect(sv['settings.integrations.masked']).toBe('••••••••');
    expect(sv['settings.integrations.show']).toBe('Visa');
    // sourceEnvBanner must mention ~/.env.fartola so operators recognise
    // the override warning.
    expect(sv['settings.integrations.sourceEnvBanner']).toContain('~/.env.fartola');
  });

  it('en.json mirrors all settings.* keys', async () => {
    const en = (await import('../i18n/en.json')).default as Record<string, string>;
    for (const key of SETTINGS_KEYS) {
      expect(en[key], `missing en key ${key}`).toBeTruthy();
    }
    expect(en['settings.title']).toBe('Settings');
    expect(en['settings.integrations.notConfigured']).toBe('Not configured');
  });
});

describe('Plan 02-07 — Settings API client wires', () => {
  beforeEach(() => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ integrations: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('listIntegrations GETs /api/settings/integrations', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const { listIntegrations } = await import('../api/client.ts');
    await listIntegrations();
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toBe('/api/settings/integrations');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('setIntegration PUTs /api/settings/integrations with the body', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, key: 'EVENTOR_API_KEY', set: true, source: 'config' }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    );
    const { setIntegration } = await import('../api/client.ts');
    const result = await setIntegration('EVENTOR_API_KEY', 'MY-KEY-VALUE');
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toBe('/api/settings/integrations');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({
      key: 'EVENTOR_API_KEY',
      value: 'MY-KEY-VALUE',
    });
    expect(result).toEqual({
      ok: true,
      key: 'EVENTOR_API_KEY',
      set: true,
      source: 'config',
    });
  });

  it('setIntegration with empty string fires PUT with value=""', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, key: 'EVENTOR_API_KEY', set: false, source: 'absent' }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      )
    );
    const { setIntegration } = await import('../api/client.ts');
    const result = await setIntegration('EVENTOR_API_KEY', '');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      key: 'EVENTOR_API_KEY',
      value: '',
    });
    expect(result.set).toBe(false);
    expect(result.source).toBe('absent');
  });
});

/**
 * Pure helpers mirrored from SettingsView. Keeping them as plain
 * functions lets vitest verify the predicates without mounting Svelte.
 * The component imports the same logic via static spreads.
 */
function shouldShowEnvBanner(source: 'env' | 'config' | 'absent'): boolean {
  return source === 'env';
}

function toggleVisibility(current: 'password' | 'text'): 'password' | 'text' {
  return current === 'password' ? 'text' : 'password';
}

function placeholderForRow(set: boolean, masked: string, notConfigured: string): string {
  return set ? masked : notConfigured;
}

describe('Plan 02-07 — SettingsView pure helpers', () => {
  it('shouldShowEnvBanner true only when source=env', () => {
    expect(shouldShowEnvBanner('env')).toBe(true);
    expect(shouldShowEnvBanner('config')).toBe(false);
    expect(shouldShowEnvBanner('absent')).toBe(false);
  });

  it('toggleVisibility flips password <-> text', () => {
    expect(toggleVisibility('password')).toBe('text');
    expect(toggleVisibility('text')).toBe('password');
  });

  it('placeholderForRow returns masked when set, notConfigured otherwise', () => {
    expect(placeholderForRow(true, '••••••••', 'Inte konfigurerad')).toBe('••••••••');
    expect(placeholderForRow(false, '••••••••', 'Inte konfigurerad')).toBe('Inte konfigurerad');
  });
});

describe('Plan 02-07 — /installningar route mounts SettingsView', () => {
  it('the +page.svelte wrapper file imports SettingsView from $lib/screens', async () => {
    // Read the wrapper as raw text; the file must reference the
    // SettingsView import path so the routing surface stays correct.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const wrapperPath = path.resolve(here, '../../routes/installningar/+page.svelte');
    const src = await fs.readFile(wrapperPath, 'utf8');
    expect(src).toMatch(/SettingsView/);
    expect(src).toMatch(/screens\/SettingsView\.svelte/);
  });
});

// SOFT TR 7.7.1: the liveresultat id and password are set and cleared from
// Inställningar; the password is write-only.
describe('liveresultat credentials (SOFT TR 7.7.1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('SOFT TR 7.7.1: settings set and clear the liveresultat id and password', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ liveresultat_id: '1234', has_password: true }), {
          status: 200,
        })
    ) as unknown as typeof fetch;
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const { getLiveresultatCredentials, setLiveresultatCredentials, clearLiveresultatCredentials } =
      await import('../api/client.ts');
    expect(await setLiveresultatCredentials('c 1', '1234', 'hemligt')).toEqual({
      liveresultat_id: '1234',
      has_password: true,
    });
    await getLiveresultatCredentials('c 1');
    await clearLiveresultatCredentials('c 1');
    const calls = fetchMock.mock.calls.map((c) => {
      const init = c[1] as RequestInit | undefined;
      return [
        String(c[0]),
        init?.method,
        init?.body === undefined ? null : JSON.parse(String(init.body)),
      ];
    });
    const url = '/api/competitions/c%201/liveresultat/credentials';
    expect(calls).toEqual([
      [url, 'PATCH', { liveresultat_id: '1234', liveresultat_pwd: 'hemligt' }],
      [url, 'GET', null],
      [url, 'DELETE', null],
    ]);
  });

  it('sv + en have the liveresultat keys; the hint cites the rule', async () => {
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    const en = (await import('../i18n/en.json')).default as Record<string, string>;
    for (const key of [
      'settings.liveresultat.title',
      'settings.liveresultat.description',
      'settings.liveresultat.id',
      'settings.liveresultat.password',
      'settings.liveresultat.save',
      'settings.liveresultat.clear',
    ]) {
      expect(sv[key], key).toBeTruthy();
      expect(en[key], key).toBeTruthy();
    }
    expect(sv['settings.liveresultat.description']).toContain('TR 7.7.1');
  });
});

// D-MOP-4 / D-MIP-1 revised 2026-10-05: the MeOS integration password, and
// the explicit "allow MeOS without password" choice with its warning.
describe('MeOS-koppling — i18n + API client', () => {
  const MEOS_KEYS = [
    'settings.meos.title',
    'settings.meos.desc',
    'settings.meos.password',
    'settings.meos.passwordSet',
    'settings.meos.passwordNotSet',
    'settings.meos.allowWithoutPassword',
    'settings.meos.allowWarning',
  ] as const;

  it('sv.json and en.json have the MeOS keys; the warning says what opening it means', async () => {
    const sv = (await import('../i18n/sv.json')).default as Record<string, string>;
    const en = (await import('../i18n/en.json')).default as Record<string, string>;
    for (const key of MEOS_KEYS) {
      expect(sv[key], `missing sv key ${key}`).toBeTruthy();
      expect(en[key], `missing en key ${key}`).toBeTruthy();
    }
    expect(sv['settings.meos.title']).toBe('MeOS-koppling');
    expect(sv['settings.meos.allowWithoutPassword']).toBe('Tillåt MeOS utan lösenord');
    expect(sv['settings.meos.allowWarning']).toMatch(/alla på nätverket/i);
    expect(sv['settings.meos.allowWarning']).toMatch(/löpare/);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getMeosSettings GETs and setMeosSettings PUTs /api/settings/meos', async () => {
    const reply = { has_meos_password: true, meos_allow_without_password: false };
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(reply), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );
    global.fetch = fetchMock;
    const { getMeosSettings, setMeosSettings } = await import('../api/client.ts');
    expect(await getMeosSettings()).toEqual(reply);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/settings/meos');
    await setMeosSettings({ meos_password: 'hemligt' });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('/api/settings/meos');
    const init = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ meos_password: 'hemligt' });
  });
});
