<!--
  Authored for fartola. Not ported from upstream.

  AccessView — event-code authentication screen for mobile sekretariat-helpers.

  Flow:
    1. Helper opens /access on their phone (LAN).
    2. Picks a competition from the dropdown (or the only one shown).
    3. Types the short code (e.g. sänkan-127).
    4. Submits → POST /access → on success, the signed HttpOnly cookie
       is set and the helper is redirected to /competition/:id/registration.
    5. On failure, a localised error message is shown without exposing
       the plaintext code in any visible error.

  Locked by:
    - .planning/phases/02.1-sanctioned-competition-foundations/02.1-12-PLAN.md task 3
    - apps/edge/src/routes/access.ts (the REST endpoint)
    - .planning/adr/0010-event-admin-codes-trust-model.md
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n/index.ts';
  import { listCompetitions, postAccess } from '$lib/api/client.ts';
  import type { CompetitionDTO } from '@fartola/shared-types';
  import Button from '$lib/ui/Button.svelte';

  let competitions: CompetitionDTO[] = $state([]);
  let selectedCompId: string = $state('');
  let code: string = $state('');
  let submitting = $state(false);
  let errorKey: string | null = $state(null);
  let loadError = $state(false);

  onMount(() => {
    void loadCompetitions();
  });

  async function loadCompetitions(): Promise<void> {
    try {
      const r = await listCompetitions();
      competitions = r.competitions;
      if (competitions.length === 1) {
        selectedCompId = competitions[0]!.id;
      }
    } catch {
      loadError = true;
    }
  }

  async function handleSubmit(): Promise<void> {
    if (!selectedCompId || !code.trim() || submitting) return;
    submitting = true;
    errorKey = null;
    try {
      await postAccess(selectedCompId, code.trim());
      void goto(`/competition/${encodeURIComponent(selectedCompId)}/registration`);
    } catch (e: unknown) {
      const body =
        e instanceof Error && (e as { body?: { error?: string } }).body
          ? ((e as { body?: { error?: string } }).body?.error ?? 'unknown')
          : 'unknown';
      errorKey = `access.error.${body}`;
      submitting = false;
    }
  }

  function handleKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Enter') void handleSubmit();
  }
</script>

<div class="access-view" data-testid="access-view">
  <header class="head">
    <h1 class="title">{t('access.title')}</h1>
  </header>

  <div class="card">
    {#if loadError}
      <p class="err">{t('access.error.unknown')}</p>
    {:else}
      <div class="field">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label class="label" for="access-comp">{t('access.selectCompetition')}</label>
        <select
          id="access-comp"
          class="select"
          bind:value={selectedCompId}
          disabled={submitting || competitions.length === 0}
        >
          {#if competitions.length === 0}
            <option value="">…</option>
          {:else}
            {#if competitions.length > 1}
              <option value="" disabled>{t('access.selectCompetition')}</option>
            {/if}
            {#each competitions as comp (comp.id)}
              <option value={comp.id}>{comp.name}</option>
            {/each}
          {/if}
        </select>
      </div>

      <div class="field">
        <label class="label" for="access-code">{t('access.codePlaceholder')}</label>
        <input
          id="access-code"
          class="code-input"
          type="text"
          inputmode="text"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="none"
          spellcheck="false"
          placeholder={t('access.codePlaceholder')}
          bind:value={code}
          disabled={submitting}
          onkeydown={handleKeydown}
          aria-describedby={errorKey ? 'access-error' : undefined}
          aria-invalid={errorKey ? 'true' : undefined}
        />
      </div>

      {#if errorKey}
        <p id="access-error" class="err" role="alert" aria-live="assertive" data-testid="access-error">
          {t(errorKey)}
        </p>
      {/if}

      <Button
        variant="primary"
        disabled={!selectedCompId || !code.trim() || submitting}
        onclick={() => void handleSubmit()}
        data-testid="access-submit"
      >
        {submitting ? t('access.submitting') : t('access.submit')}
      </Button>
    {/if}
  </div>
</div>

<style>
  .access-view {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    padding: var(--space-md);
    max-width: 480px;
    margin: 0 auto;
  }
  .head {
    text-align: center;
  }
  .title {
    margin: 0;
    font-size: var(--fs-heading);
    font-weight: 600;
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
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }
  .label {
    font-size: var(--fs-label);
    font-weight: 600;
  }
  .select,
  .code-input {
    min-height: var(--hit);
    padding: 0 12px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--fg);
    font-size: var(--fs-label);
    width: 100%;
    box-sizing: border-box;
  }
  .select:focus,
  .code-input:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .code-input {
    font-family: var(--font-mono);
    letter-spacing: 0.03em;
  }
  .err {
    margin: 0;
    color: var(--dnf);
    font-size: 13px;
  }
</style>
