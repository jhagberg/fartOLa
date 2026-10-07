<!--
  Authored for fartola. Not ported from upstream.

  SettingsView (Phase 2.0 Plan 02-07 Task 3).

  Operator-facing surface for managing integration API keys without
  touching ~/.env.fartola. Windows operators (Phase 2.1 target user
  base) get a UI alternative to dotfiles; Linux operators keep their
  existing env-export workflow because boot precedence
  (env > config > absent) is preserved by apps/edge/src/config/secrets.ts.

  Lifecycle:
   - On mount: GET /api/settings/integrations → list of
     { key, set, source } rows. The `value` field is NEVER returned by
     the API (write-only secret, OWASP A02:2021) so the UI masks set
     rows to '••••••••' and renders "Inte konfigurerad" for unset.
   - "Visa" toggle: flips type=password ↔ text per row so the operator
     can paste-debug a freshly typed value (only matters BEFORE Save
     — after refetch, the input goes back to empty + masked).
   - "Spara": PUT /api/settings/integrations { key, value }. Empty
     string = delete row (server side). On success → toast + refetch.
   - When source='env', a banner explains that env overrides any UI
     save on next boot. The input stays editable — the operator can
     still queue a config-table override that env will trump.

  MeOS-koppling (D-MOP-4 / D-MIP-1 revised 2026-10-05): password for
  GET /mip + POST /mop (never shown, only "set"), and the explicit
  "Tillåt MeOS utan lösenord" choice with its warning. Without either,
  MeOS only works from this machine.

  Locked by:
  - .planning/phases/02-4-klubbs-mvp/02-07-PLAN.md task 3
  - apps/edge/src/routes/settings.ts (the REST surface)
  - apps/edge/src/config/secrets.ts (boot precedence contract)
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '#lib/i18n/index.ts';
  import {
    listIntegrations,
    setIntegration,
    getMeosSettings,
    setMeosSettings,
    type MeosSettings,
    type IntegrationStatus,
    type IntegrationSource,
    listEventCodes,
    generateEventCode,
    revokeEventCode,
    type EventCodeSummary,
    getLiveresultatCredentials,
    setLiveresultatCredentials,
    clearLiveresultatCredentials,
    type LiveresultatCredentials,
    getRadioStatus,
    setRadioSettings,
  } from '#lib/api/client.ts';
  import { activeCompetition } from '#lib/stores/activeCompetition.svelte.ts';
  import Button from '#lib/ui/Button.svelte';
  import { baselineKey, latestOnly } from '#lib/screens/radio-status.ts';
  import type { RadioStatus } from '@fartola/shared-types';

  // Per-row UI state. Keyed by integration key so we can find a row
  // fast on save and so adding a Phase-3 key needs no extra wiring.
  interface RowState {
    /** Current draft value typed by the operator (cleared after Save). */
    draft: string;
    /** Toggle: masked vs paste-debug. */
    visibility: 'password' | 'text';
    /** True while a PUT is in flight. Disables Spara to prevent double-save. */
    saving: boolean;
    /** Last-action toast: 'saved' | 'cleared' | 'error' | null. Auto-cleared
     * after the next user interaction. */
    toast: 'saved' | 'cleared' | 'error' | null;
  }

  let integrations: IntegrationStatus[] = $state([]);
  let loading = $state(true);
  let loadError: string | null = $state(null);
  let rows: Record<string, RowState> = $state({});

  onMount(() => {
    void fetchAll();
    void fetchMeos();
  });

  // MeOS-koppling.
  let meos: MeosSettings | null = $state(null);
  let meosDraft = $state('');
  let meosSaving = $state(false);
  let meosToast: RowState['toast'] = $state(null);

  async function fetchMeos(): Promise<void> {
    try {
      meos = await getMeosSettings();
    } catch {
      meos = null;
    }
  }

  async function saveMeos(body: {
    meos_password?: string;
    meos_allow_without_password?: boolean;
  }): Promise<void> {
    meosSaving = true;
    meosToast = null;
    try {
      meos = await setMeosSettings(body);
      meosToast = body.meos_password === '' ? 'cleared' : 'saved';
      meosDraft = '';
    } catch {
      meosToast = 'error';
    } finally {
      meosSaving = false;
    }
  }

  async function fetchAll(): Promise<void> {
    loading = true;
    loadError = null;
    try {
      const r = await listIntegrations();
      integrations = r.integrations;
      // Initialise per-row state for any new keys discovered on the
      // server. Preserve existing state (visibility, lingering toast)
      // so a refetch after Save doesn't wipe the operator's view.
      for (const row of r.integrations) {
        if (!rows[row.key]) {
          rows[row.key] = {
            draft: '',
            visibility: 'password',
            saving: false,
            toast: null,
          };
        }
      }
    } catch (e) {
      loadError = (e as Error).message || t('settings.integrations.loadError');
    } finally {
      loading = false;
    }
  }

  function toggleVisibility(key: string): void {
    const row = rows[key];
    if (!row) return;
    row.visibility = row.visibility === 'password' ? 'text' : 'password';
  }

  async function save(key: string): Promise<void> {
    const row = rows[key];
    if (!row) return;
    row.saving = true;
    row.toast = null;
    try {
      const result = await setIntegration(key, row.draft);
      // Reflect the server's authoritative state.
      const idx = integrations.findIndex((i) => i.key === key);
      if (idx >= 0) {
        integrations[idx] = {
          key: result.key,
          set: result.set,
          source: result.source,
        };
      }
      row.toast = result.set ? 'saved' : 'cleared';
      // Clear the draft so the masked placeholder shows the new value.
      row.draft = '';
      row.visibility = 'password';
    } catch {
      row.toast = 'error';
    } finally {
      row.saving = false;
    }
  }

  function placeholderForRow(row: IntegrationStatus): string {
    return row.set
      ? t('settings.integrations.masked')
      : t('settings.integrations.notConfigured');
  }

  function keyLabel(key: string): string {
    // Falls back to the bare key if we ever add a Phase-3 integration
    // without an i18n entry (defensive — Plan 02-07 ships all three).
    const labelKey = `settings.integrations.key.${key}`;
    const translated = t(labelKey);
    return translated === labelKey ? key : translated;
  }

  function sourceBadge(source: IntegrationSource): string | null {
    if (source === 'env') return t('settings.integrations.sourceEnvBadge');
    if (source === 'config') return t('settings.integrations.sourceConfigBadge');
    return null;
  }

  function toastLabel(state: RowState['toast']): string | null {
    if (state === 'saved') return t('settings.integrations.saved');
    if (state === 'cleared') return t('settings.integrations.cleared');
    if (state === 'error') return t('settings.integrations.saveError');
    return null;
  }

  // ---------------------------------------------------------------------------
  // Hjälpkoder (event admin codes)
  // ---------------------------------------------------------------------------

  let helperCodes: EventCodeSummary[] = $state([]);
  let helperCodesLoading = $state(false);
  let generatingCode = $state(false);
  let revokingId: string | null = $state(null);
  /** id → revealed plaintext code (visible for 30s) */
  let revealedCodes: Record<string, string> = $state({});
  /** id → setTimeout handle */
  const revealTimers: Record<string, ReturnType<typeof setTimeout>> = {};

  const currentCompId = $derived(activeCompetition.id);

  async function loadHelperCodes(): Promise<void> {
    if (!currentCompId) return;
    helperCodesLoading = true;
    try {
      const r = await listEventCodes(currentCompId);
      helperCodes = r.codes;
    } catch {
      // soft fail — list stays stale
    } finally {
      helperCodesLoading = false;
    }
  }

  async function handleGenerate(): Promise<void> {
    if (!currentCompId || generatingCode) return;
    generatingCode = true;
    try {
      const generated = await generateEventCode(currentCompId);
      // Show the plaintext code immediately for 30 seconds.
      revealedCodes[generated.id] = generated.code;
      if (revealTimers[generated.id]) clearTimeout(revealTimers[generated.id]);
      revealTimers[generated.id] = setTimeout(() => {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete revealedCodes[generated.id];
      }, 30_000);
      await loadHelperCodes();
    } catch {
      // soft fail
    } finally {
      generatingCode = false;
    }
  }

  async function handleRevoke(codeId: string): Promise<void> {
    if (!currentCompId || revokingId) return;
    revokingId = codeId;
    try {
      await revokeEventCode(currentCompId, codeId);
      await loadHelperCodes();
    } catch {
      // soft fail
    } finally {
      revokingId = null;
    }
  }

  function formatExpiry(ms: number): string {
    return new Date(ms).toLocaleDateString('sv-SE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  $effect(() => {
    // Reload helper codes whenever the active competition changes.
    void currentCompId;
    void loadHelperCodes();
  });

  // ---- Liveresultat (SOFT TR 7.7.1) ----------------------------------------
  let live: LiveresultatCredentials | null = $state(null);
  let liveId = $state('');
  /** Write-only: never prefilled; the server only says whether one is set. */
  let livePwd = $state('');
  let liveBusy = $state(false);
  let liveErr: string | null = $state(null);

  async function loadLive(): Promise<void> {
    live = null;
    liveErr = null;
    if (!currentCompId) return;
    try {
      live = await getLiveresultatCredentials(currentCompId);
      liveId = live.liveresultat_id ?? '';
      livePwd = '';
    } catch {
      // soft fail — section shows "not configured"
    }
  }

  async function saveLive(): Promise<void> {
    if (!currentCompId || liveBusy) return;
    if (!/^\d+$/.test(liveId.trim()) || livePwd.length === 0) {
      liveErr = t('settings.liveresultat.invalid');
      return;
    }
    liveBusy = true;
    liveErr = null;
    try {
      live = await setLiveresultatCredentials(currentCompId, liveId.trim(), livePwd);
      livePwd = '';
    } catch {
      liveErr = t('settings.liveresultat.saveError');
    } finally {
      liveBusy = false;
    }
  }

  async function clearLive(): Promise<void> {
    if (!currentCompId || liveBusy) return;
    liveBusy = true;
    liveErr = null;
    try {
      live = await clearLiveresultatCredentials(currentCompId);
      liveId = '';
      livePwd = '';
    } catch {
      liveErr = t('settings.liveresultat.saveError');
    } finally {
      liveBusy = false;
    }
  }

  $effect(() => {
    void currentCompId;
    void loadLive();
  });

  // ---- Radiokontroller (ROC) ----------------------------------------------
  /** The club's ROC id; offered when none is saved yet. */
  const DEFAULT_ROC_ID = '2380';
  let radioEnabled = $state(false);
  let radioId = $state(DEFAULT_ROC_ID);
  let radioStartId = $state('');
  let radioStartIdLoaded = '';
  let radioControls = $state('');
  let radioStartCodes = $state('');
  let radioCheckCodes = $state('');
  let radioFinishCodes = $state('');
  let radioHeard = $state('');
  let radioBaseline: { key: string; id: number | null } | null = $state(null);
  /** True only once the current competition's settings have been loaded: until
   * then the form holds defaults and must not be saved over the real ones. */
  let radioReady = $state(false);
  let radioBusy = $state(false);
  let radioMsg: string | null = $state(null);
  let radioErr: string | null = $state(null);

  function parseCodes(text: string): number[] {
    return text
      .split(/[,\s]+/)
      .filter((x) => x !== '')
      .map(Number);
  }

  function applyRadio(r: RadioStatus): void {
    radioEnabled = r.settings.enabled;
    radioId = r.settings.roc_competition_id ?? DEFAULT_ROC_ID;
    radioStartId = r.settings.start_id === null ? '' : String(r.settings.start_id);
    radioStartIdLoaded = radioStartId;
    radioControls = r.settings.radio_controls.join(', ');
    radioStartCodes = r.settings.start_codes.join(', ');
    radioCheckCodes = r.settings.check_codes.join(', ');
    radioFinishCodes = r.settings.finish_codes.join(', ');
    radioHeard = r.settings.heard_codes.join(', ');
    radioBaseline = baselineKey(r);
  }

  /** One token per load/switch/save: only the latest response may touch the form. */
  const radioRequest = latestOnly();

  async function loadRadio(): Promise<void> {
    const isCurrent = radioRequest();
    radioMsg = null;
    radioErr = null;
    // Blank the form first, so nothing of the previous competition can be saved
    // into this one while its settings are loading.
    radioEnabled = false;
    radioId = DEFAULT_ROC_ID;
    radioStartId = '';
    radioStartIdLoaded = '';
    radioControls = '';
    radioStartCodes = '';
    radioCheckCodes = '';
    radioFinishCodes = '';
    radioHeard = '';
    radioBaseline = null;
    radioReady = false;
    const id = currentCompId;
    if (!id) return;
    try {
      const r = await getRadioStatus(id);
      if (isCurrent()) {
        applyRadio(r);
        radioReady = true;
      }
    } catch {
      // Save stays off: the form holds defaults, not the real settings.
      if (isCurrent()) radioErr = t('settings.radio.loadError');
    }
  }

  async function saveRadio(): Promise<void> {
    const id = currentCompId;
    if (!id || radioBusy || !radioReady) return;
    const codes = parseCodes(radioControls);
    const startCodes = parseCodes(radioStartCodes);
    const checkCodes = parseCodes(radioCheckCodes);
    const finishCodes = parseCodes(radioFinishCodes);
    const startText = radioStartId.trim();
    if (
      !/^\d+$/.test(radioId.trim()) ||
      [codes, startCodes, checkCodes, finishCodes].some((l) =>
        l.some((n) => !Number.isInteger(n) || n <= 0)
      ) ||
      (startText !== '' && !/^\d+$/.test(startText))
    ) {
      radioErr = t('settings.radio.invalid');
      radioMsg = null;
      return;
    }
    const isCurrent = radioRequest();
    radioBusy = true;
    radioErr = null;
    radioMsg = null;
    try {
      const r = await setRadioSettings(id, {
          enabled: radioEnabled,
          roc_competition_id: radioId.trim(),
          radio_controls: codes,
          start_codes: startCodes,
          check_codes: checkCodes,
          finish_codes: finishCodes,
          // Only when changed: setting it makes the next fetch start over from there.
          ...(startText !== radioStartIdLoaded
            ? { start_id: startText === '' ? null : Number(startText) }
            : {}),
      });
      if (isCurrent()) {
        applyRadio(r);
        radioMsg = t('settings.radio.saved');
      }
    } catch {
      if (isCurrent()) radioErr = t('settings.radio.saveError');
    } finally {
      radioBusy = false;
    }
  }

  $effect(() => {
    void currentCompId;
    void loadRadio();
  });
</script>

<section class="settings-view" data-testid="settings-view">
  <header class="head">
    <h1 class="title">{t('settings.title')}</h1>
  </header>

  <section class="card">
    <header class="section-head">
      <h2>{t('settings.integrations.title')}</h2>
    </header>
    <p class="desc muted small">{t('settings.integrations.desc')}</p>

    {#if loading}
      <p class="muted" data-testid="settings-loading">{t('settings.integrations.loading')}</p>
    {:else if loadError}
      <p class="err" data-testid="settings-error">{loadError}</p>
    {:else if integrations.length === 0}
      <p class="muted" data-testid="settings-empty">{t('settings.integrations.empty')}</p>
    {:else}
      <ul class="row-list">
        {#each integrations as row (row.key)}
          {@const state = rows[row.key] ?? { draft: '', visibility: 'password', saving: false, toast: null }}
          <li class="row" data-testid="settings-row" data-integration-key={row.key}>
            <div class="row-head">
              <label class="label" for={`settings-input-${row.key}`}>
                {keyLabel(row.key)}
              </label>
              {#if sourceBadge(row.source)}
                <span class="badge" data-testid="settings-row-source-badge">
                  {sourceBadge(row.source)}
                </span>
              {/if}
            </div>

            {#if row.source === 'env'}
              <p class="banner" data-testid="settings-row-env-banner">
                {t('settings.integrations.sourceEnvBanner')}
              </p>
            {/if}

            <div class="input-line">
              <input
                id={`settings-input-${row.key}`}
                class="key-input"
                type={state.visibility}
                placeholder={placeholderForRow(row)}
                bind:value={state.draft}
                autocomplete="off"
                spellcheck="false"
                data-testid="settings-row-input"
              />
              <Button
                variant="ghost"
                size="sm"
                onclick={() => toggleVisibility(row.key)}
                data-testid="settings-row-visa"
              >
                {state.visibility === 'password'
                  ? t('settings.integrations.show')
                  : t('settings.integrations.hide')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={state.saving}
                onclick={() => void save(row.key)}
                data-testid="settings-row-save"
              >
                {state.saving
                  ? t('settings.integrations.saving')
                  : state.draft.length === 0 && row.set
                    ? t('settings.integrations.clear')
                    : t('settings.integrations.save')}
              </Button>
            </div>

            {#if toastLabel(state.toast)}
              <p
                class="toast"
                class:toast-err={state.toast === 'error'}
                role="status"
                aria-live="polite"
                data-testid="settings-row-toast"
              >
                {toastLabel(state.toast)}
              </p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="card" data-testid="meos-settings-section">
    <header class="section-head">
      <h2>{t('settings.meos.title')}</h2>
    </header>
    <p class="desc muted small">{t('settings.meos.desc')}</p>

    {#if meos === null}
      <p class="muted">{t('settings.integrations.loading')}</p>
    {:else}
      <label class="label" for="meos-password-input">{t('settings.meos.password')}</label>
      <div class="input-line">
        <input
          id="meos-password-input"
          class="key-input"
          type="password"
          placeholder={meos.has_meos_password
            ? t('settings.meos.passwordSet')
            : t('settings.meos.passwordNotSet')}
          bind:value={meosDraft}
          autocomplete="new-password"
          spellcheck="false"
          data-testid="meos-password-input"
        />
        <Button
          variant="primary"
          size="sm"
          disabled={meosSaving || (meosDraft.length === 0 && !meos.has_meos_password)}
          onclick={() => void saveMeos({ meos_password: meosDraft })}
          data-testid="meos-password-save"
        >
          {meosSaving
            ? t('settings.integrations.saving')
            : meosDraft.length === 0 && meos.has_meos_password
              ? t('settings.integrations.clear')
              : t('settings.integrations.save')}
        </Button>
      </div>

      <label class="check">
        <input
          type="checkbox"
          checked={meos.meos_allow_without_password}
          disabled={meosSaving}
          onchange={(e) =>
            void saveMeos({ meos_allow_without_password: e.currentTarget.checked })}
          data-testid="meos-allow-checkbox"
        />
        {t('settings.meos.allowWithoutPassword')}
      </label>
      <p class="banner" data-testid="meos-allow-warning">{t('settings.meos.allowWarning')}</p>

      {#if toastLabel(meosToast)}
        <p
          class="toast"
          class:toast-err={meosToast === 'error'}
          role="status"
          aria-live="polite"
          data-testid="meos-settings-toast"
        >
          {toastLabel(meosToast)}
        </p>
      {/if}
    {/if}
  </section>

  <!-- ------------------------------------------------------------------ -->
  <!-- Hjälpkoder section                                                   -->
  <!-- ------------------------------------------------------------------ -->
  <section class="card" data-testid="helper-codes-section">
    <header class="section-head">
      <h2>{t('settings.helperCodes.title')}</h2>
    </header>
    <p class="desc muted small">{t('settings.helperCodes.description')}</p>

    {#if !currentCompId}
      <p class="muted" data-testid="helper-codes-no-competition">
        {t('settings.helperCodes.noCompetition')}
      </p>
    {:else}
      <div class="generate-row">
        <Button
          variant="primary"
          size="sm"
          disabled={generatingCode}
          onclick={() => void handleGenerate()}
          data-testid="helper-codes-generate"
        >
          {generatingCode
            ? t('settings.helperCodes.generating')
            : t('settings.helperCodes.generate')}
        </Button>
      </div>

      {#if helperCodesLoading && helperCodes.length === 0}
        <p class="muted">{t('settings.integrations.loading')}</p>
      {:else if helperCodes.length === 0}
        <p class="muted" data-testid="helper-codes-empty">{t('settings.helperCodes.empty')}</p>
      {:else}
        <ul class="code-list">
          {#each helperCodes as code (code.id)}
            <li
              class="code-row"
              class:revoked={code.revoked_at_ms !== null}
              data-testid="helper-code-row"
            >
              <div class="code-meta">
                {#if revealedCodes[code.id]}
                  <span class="code-reveal" data-testid="helper-code-revealed">
                    {t('settings.helperCodes.revealed')}
                    <span class="code-mono">{revealedCodes[code.id]}</span>
                  </span>
                {:else}
                  <span class="code-masked" data-testid="helper-code-masked">{code.masked_code}</span>
                {/if}
                <span class="code-expiry muted small">
                  {code.revoked_at_ms !== null
                    ? t('settings.helperCodes.revoked')
                    : `${t('settings.helperCodes.expires')} ${formatExpiry(code.expires_at_ms)}`}
                </span>
              </div>
              {#if code.revoked_at_ms === null}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={revokingId === code.id}
                  onclick={() => void handleRevoke(code.id)}
                  data-testid="helper-code-revoke"
                >
                  {revokingId === code.id
                    ? t('settings.helperCodes.revoking')
                    : t('settings.helperCodes.revoke')}
                </Button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </section>

  <!-- ------------------------------------------------------------------ -->
  <!-- Liveresultat (SOFT TR 7.7.1)                                         -->
  <!-- ------------------------------------------------------------------ -->
  <section class="card" data-testid="liveresultat-section">
    <header class="section-head">
      <h2>{t('settings.liveresultat.title')}</h2>
      <span class="muted small" data-testid="liveresultat-state">
        {live?.liveresultat_id && live.has_password
          ? t('settings.liveresultat.active')
          : t('settings.liveresultat.inactive')}
      </span>
    </header>
    <p class="desc muted small">{t('settings.liveresultat.description')}</p>

    {#if !currentCompId}
      <p class="muted">{t('settings.helperCodes.noCompetition')}</p>
    {:else}
      <div class="live-form">
        <label>
          <span>{t('settings.liveresultat.id')}</span>
          <input
            type="text"
            inputmode="numeric"
            bind:value={liveId}
            data-testid="liveresultat-id"
          />
        </label>
        <label>
          <span>{t('settings.liveresultat.password')}</span>
          <input
            type="password"
            autocomplete="off"
            placeholder={live?.has_password ? t('settings.liveresultat.passwordSet') : ''}
            bind:value={livePwd}
            data-testid="liveresultat-password"
          />
        </label>
      </div>
      {#if liveErr}
        <p class="err" role="alert">{liveErr}</p>
      {/if}
      <div class="generate-row">
        <Button
          variant="primary"
          size="sm"
          disabled={liveBusy}
          onclick={() => void saveLive()}
          data-testid="liveresultat-save"
        >
          {t('settings.liveresultat.save')}
        </Button>
        {#if live?.liveresultat_id || live?.has_password}
          <Button
            variant="ghost"
            size="sm"
            disabled={liveBusy}
            onclick={() => void clearLive()}
            data-testid="liveresultat-clear"
          >
            {t('settings.liveresultat.clear')}
          </Button>
        {/if}
      </div>
    {/if}
  </section>

  <!-- ------------------------------------------------------------------ -->
  <!-- Radiokontroller (ROC)                                                -->
  <!-- ------------------------------------------------------------------ -->
  <section class="card" data-testid="radio-section">
    <header class="section-head">
      <h2>{t('settings.radio.title')}</h2>
    </header>
    <p class="desc muted small">{t('settings.radio.description')}</p>

    {#if !currentCompId}
      <p class="muted">{t('settings.helperCodes.noCompetition')}</p>
    {:else}
      <div class="live-form">
        <label>
          <span>{t('settings.radio.id')}</span>
          <input type="text" inputmode="numeric" bind:value={radioId} data-testid="radio-id" />
        </label>
        <label>
          <span>{t('settings.radio.startId')}</span>
          <input
            type="text"
            inputmode="numeric"
            bind:value={radioStartId}
            data-testid="radio-start-id"
          />
        </label>
        <label>
          <span>{t('settings.radio.controls')}</span>
          <input type="text" bind:value={radioControls} data-testid="radio-controls" />
        </label>
        <label>
          <span>{t('settings.radio.startCodes')}</span>
          <input type="text" bind:value={radioStartCodes} data-testid="radio-start-codes" />
        </label>
        <label>
          <span>{t('settings.radio.checkCodes')}</span>
          <input type="text" bind:value={radioCheckCodes} data-testid="radio-check-codes" />
        </label>
        <label>
          <span>{t('settings.radio.finishCodes')}</span>
          <input type="text" bind:value={radioFinishCodes} data-testid="radio-finish-codes" />
        </label>
        <label class="radio-toggle">
          <input type="checkbox" bind:checked={radioEnabled} data-testid="radio-enabled" />
          <span>{t('settings.radio.enabled')}</span>
        </label>
      </div>
      <p class="desc muted small">{t('settings.radio.startIdHelp')}</p>
      <p class="desc muted small">{t('settings.radio.controlsHelp')}</p>
      <p class="desc muted small">{t('settings.radio.unitsHelp')}</p>
      {#if radioHeard}
        <p class="muted" data-testid="radio-heard-codes">
          {t('settings.radio.heard', { codes: radioHeard })}
        </p>
      {/if}
      {#if radioBaseline}
        <p class="muted" data-testid="radio-settings-baseline">
          {t(radioBaseline.key, { id: radioBaseline.id })}
        </p>
      {/if}
      {#if radioErr}
        <p class="err" role="alert">{radioErr}</p>
      {/if}
      {#if radioMsg}
        <p class="muted" role="status" data-testid="radio-saved">{radioMsg}</p>
      {/if}
      <div class="generate-row">
        <Button
          variant="primary"
          size="sm"
          disabled={radioBusy || !radioReady}
          onclick={() => void saveRadio()}
          data-testid="radio-save"
        >
          {t('settings.radio.save')}
        </Button>
      </div>
    {/if}
  </section>
</section>

<style>
  .live-form .radio-toggle {
    flex-direction: row;
    align-items: center;
    gap: var(--space-sm);
    min-height: 44px;
  }
  .live-form {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-sm);
  }
  .live-form label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1 1 200px;
  }
  .settings-view {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    padding: var(--space-md);
    min-width: 0;
    max-width: 720px;
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: var(--space-sm);
  }
  .title {
    margin: 0;
    font-size: var(--fs-heading);
    font-weight: 600;
  }
  .muted {
    color: var(--fg-muted);
  }
  .small {
    font-size: 13px;
  }
  .err {
    color: var(--dnf);
  }
  .card {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }
  .section-head h2 {
    margin: 0;
    font-size: var(--fs-label);
    font-weight: 600;
  }
  .desc {
    margin: 0;
    line-height: 1.4;
  }
  .row-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding-top: var(--space-sm);
    border-top: 1px solid var(--border);
  }
  .row:first-child {
    border-top: none;
    padding-top: 0;
  }
  .row-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-sm);
  }
  .label {
    font-size: var(--fs-label);
    font-weight: 600;
  }
  .badge {
    font-size: 11px;
    background: var(--bg-sunken);
    color: var(--fg-muted);
    padding: 2px 8px;
    border-radius: 999px;
  }
  .banner {
    margin: 0;
    padding: 8px 12px;
    background: var(--mp-soft);
    color: var(--mp);
    border: 1px solid color-mix(in oklch, var(--mp) 35%, transparent);
    border-radius: var(--radius);
    font-size: 13px;
    line-height: 1.4;
  }
  .input-line {
    display: flex;
    gap: var(--space-xs);
    align-items: center;
    flex-wrap: wrap;
  }
  .key-input {
    flex: 1 1 240px;
    min-height: var(--hit);
    padding: 0 12px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
  }
  .key-input:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .toast {
    margin: 0;
    font-size: 13px;
    color: var(--accent-strong, var(--accent));
  }
  .toast-err {
    color: var(--dnf);
  }
  .check {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    font-size: var(--fs-label);
  }
  .generate-row {
    display: flex;
    align-items: center;
  }
  .code-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }
  .code-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
    padding: var(--space-xs) 0;
    border-top: 1px solid var(--border);
  }
  .code-row:first-child {
    border-top: none;
  }
  .code-row.revoked {
    opacity: 0.5;
  }
  .code-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .code-masked,
  .code-reveal {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
  }
  .code-mono {
    font-family: var(--font-mono);
    font-weight: 600;
  }
  .code-expiry {
    font-size: 12px;
  }
</style>
