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

  Locked by:
  - .planning/phases/02-4-klubbs-mvp/02-07-PLAN.md task 3
  - apps/edge/src/routes/settings.ts (the REST surface)
  - apps/edge/src/config/secrets.ts (boot precedence contract)
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n/index.ts';
  import {
    listIntegrations,
    setIntegration,
    type IntegrationStatus,
    type IntegrationSource,
    listEventCodes,
    generateEventCode,
    revokeEventCode,
    type EventCodeSummary,
  } from '$lib/api/client.ts';
  import { activeCompetition } from '$lib/stores/activeCompetition.svelte.ts';
  import Button from '$lib/ui/Button.svelte';

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
  });

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
</section>

<style>
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
