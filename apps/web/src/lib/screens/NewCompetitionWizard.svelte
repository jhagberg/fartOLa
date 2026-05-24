<!--
  Authored for fartola. Not ported from upstream.

  Three-step new-competition wizard. Codex C-H3 LOCKED: step 3 fires
  ONE atomic POST to /api/competitions/from-wizard — the previous
  revision fired TWO sequential POSTs (createCompetition then
  importCompetitionFile), but HTTP requests cannot share a SQL
  transaction so a mid-flight failure left an orphan competition row.
  This revision routes both operations through the single atomic
  endpoint; on failure the server's SQLite transaction rolls back and
  no orphan row persists. wizard.spec.ts test 2 is the e2e regression
  gate.

  Wizard shell:
   - Modal scrim with click-out-to-cancel (Avbryt is non-destructive at
     all steps — deferred-POST contract).
   - Top step indicator (1/2/3) with active + done states matching
     screens-home.jsx.
   - Body delegates to WizardStep1/2/3.
   - Footer: Tillbaka (step > 1), Avbryt, Nästa (steps 1+2), and the
     Start-button lives INSIDE step 3 so it can manage submit state.
   - Inline error banner appears below step 3 on POST failure.

  State shape uses Svelte 5 runes ($state) per the plan interface block.
  pendingFile (File) stays in memory until step 3 commits — see the
  C-H3 deferred-POST contract.

  Locked by:
  - 01-UI-SPEC.md §"Click 1, Click 2, Click 3" + §Wizard styling
  - 01-REVIEWS.md §C-H3
  - 01-12-PLAN.md task 2
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n/index.ts';
  import Icon from '$lib/ui/Icon.svelte';
  import WizardStep1 from './WizardStep1.svelte';
  import WizardStep2 from './WizardStep2.svelte';
  import WizardStep3 from './WizardStep3.svelte';

  interface Props {
    /** Where Avbryt routes to. Defaults to `/` so Home → wizard →
     * Avbryt is a clean back-trip. */
    cancelHref?: string;
  }

  let { cancelHref = '/' }: Props = $props();

  type Step = 1 | 2 | 3;
  type Kind = 'CourseData' | 'EntryList';
  interface PreviewMeta {
    filename: string;
    kind: Kind;
  }

  let step: Step = $state(1);
  let name = $state('');
  let date = $state('');
  let pendingFile: File | null = $state(null);
  let preview: PreviewMeta | null = $state(null);
  let dropError: string | null = $state(null);
  let importError: string | null = $state(null);
  /** Plan 11 — Eventor event ID set by the wizard Eventor quickstart.
   * Flows through to the from-wizard POST body. */
  let eventorEventId: number | null = $state(null);

  /** Dirty-check (UI/UX audit #2, 2026-05-17). Accidental scrim tap on
   * a 3-step wizard would drop the operator's name + date + file work —
   * confirm first if any of those have been touched. Esc + the explicit
   * Avbryt button still close without prompt (explicit intent). */
  const dirty = $derived(
    name !== '' || date !== '' || pendingFile !== null
  );
  let confirmingClose = $state(false);

  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  const canAdvanceFromStep1 = $derived(name.trim().length > 0 && isoDate.test(date));
  const canAdvanceFromStep2 = $derived(pendingFile !== null && preview !== null && !dropError);

  function setName(v: string): void {
    name = v;
  }
  function setDate(v: string): void {
    date = v;
  }

  /** Step 1 quickstart import: pre-fills name + date + sets pendingFile
   * so Step 2's DropZone sees the file as already loaded. Operator can
   * still edit name + date and / or replace the file in Step 2. */
  function acceptQuickstart(
    f: File,
    parsedName: string,
    parsedDate: string,
    p: PreviewMeta
  ): void {
    pendingFile = f;
    preview = p;
    dropError = null;
    if (parsedName) name = parsedName;
    if (parsedDate) date = parsedDate;
  }
  function clearQuickstart(): void {
    pendingFile = null;
    preview = null;
    dropError = null;
  }

  // Plan 11 — Eventor quickstart handlers.
  function acceptEventorQuickstart(id: number, parsedName: string, parsedDate: string): void {
    eventorEventId = id;
    if (parsedName) name = parsedName;
    if (parsedDate && /^\d{4}-\d{2}-\d{2}$/.test(parsedDate)) date = parsedDate;
  }
  function clearEventorQuickstart(): void {
    eventorEventId = null;
  }

  function acceptFile(f: File, p: PreviewMeta): void {
    pendingFile = f;
    preview = p;
    dropError = null;
  }
  function rejectFile(msg: string): void {
    pendingFile = null;
    preview = null;
    dropError = msg;
  }
  function clearDrop(): void {
    dropError = null;
  }
  function handleImportError(msg: string): void {
    importError = msg;
  }

  function next(): void {
    if (step === 1 && canAdvanceFromStep1) step = 2;
    else if (step === 2 && canAdvanceFromStep2) step = 3;
  }
  function back(): void {
    importError = null;
    if (step === 3) step = 2;
    else if (step === 2) step = 1;
  }
  function cancel(): void {
    void goto(cancelHref);
  }

  function onScrimTap(): void {
    if (dirty && !confirmingClose) {
      confirmingClose = true;
      return;
    }
    cancel();
  }
  function cancelClose(): void {
    confirmingClose = false;
  }

  function onScrimKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') cancel();
  }
</script>

<svelte:window on:keydown={onScrimKey} />

<div
  class="modal-scrim"
  role="presentation"
  onclick={onScrimTap}
  data-testid="wizard-scrim"
>
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="wiz-title"
    tabindex={-1}
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
  >
    <header class="modal-head">
      <h2 id="wiz-title">{t('wiz.title')}</h2>
      <span class="muted mono small">{step}/3</span>
    </header>

    <div class="wiz-steps" aria-label="wizard progress">
      {#each [1, 2, 3] as n (n)}
        <div class="wiz-step {step === n ? 'active' : step > n ? 'done' : ''}">
          <span class="num">
            {#if step > n}
              <Icon name="check" size={16} />
            {:else}
              {n}
            {/if}
          </span>
          <span class="lbl">
            <b>{t(`wiz.step${n}.title`)}</b>
            <span class="small">{n === 1 ? 'Skapa' : n === 2 ? 'Importera' : 'Klar'}</span>
          </span>
        </div>
      {/each}
    </div>

    <div class="modal-body">
      {#if step === 1}
        <WizardStep1
          {name}
          {date}
          preimportedFile={pendingFile}
          onnamechange={setName}
          ondatechange={setDate}
          onquickstart={acceptQuickstart}
          onquickstartclear={clearQuickstart}
          oneventorquickstart={acceptEventorQuickstart}
          oneventorquickstartclear={clearEventorQuickstart}
          {eventorEventId}
        />
      {:else if step === 2}
        <WizardStep2
          file={pendingFile}
          {preview}
          error={dropError}
          onfile={acceptFile}
          onerror={rejectFile}
          onclear={clearDrop}
        />
      {:else}
        <WizardStep3
          {name}
          {date}
          {pendingFile}
          {eventorEventId}
          onerror={handleImportError}
        />
        {#if importError}
          <div class="err-banner" role="alert" data-testid="wizard-error">
            {importError}
          </div>
        {/if}
      {/if}
    </div>

    {#if confirmingClose}
      <div class="discard-confirm" role="alert" data-testid="wizard-discard-confirm">
        <p class="discard-msg">{t('wiz.discard.msg')}</p>
        <div class="discard-actions">
          <button
            type="button"
            class="btn ghost"
            onclick={cancelClose}
            data-testid="wizard-discard-cancel"
          >
            {t('wiz.discard.keep')}
          </button>
          <button
            type="button"
            class="btn danger"
            onclick={cancel}
            data-testid="wizard-discard-confirm-btn"
          >
            {t('wiz.discard.discard')}
          </button>
        </div>
      </div>
    {/if}
    <footer class="modal-foot">
      {#if step > 1}
        <button type="button" class="btn ghost" onclick={back} data-testid="wiz-back">
          ← {t('wiz.back')}
        </button>
      {/if}
      <button type="button" class="btn ghost" onclick={cancel} data-testid="wiz-cancel">
        {t('wiz.cancel')}
      </button>
      <div class="spacer"></div>
      {#if step < 3}
        <button
          type="button"
          class="btn primary"
          disabled={(step === 1 && !canAdvanceFromStep1) || (step === 2 && !canAdvanceFromStep2)}
          onclick={next}
          data-testid="wiz-next"
        >
          {t('wiz.next')} →
        </button>
      {/if}
    </footer>
  </div>
</div>

<style>
  .modal-scrim {
    position: fixed;
    inset: 0;
    background: rgba(20, 20, 30, 0.32);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-lg);
    z-index: 50;
    backdrop-filter: blur(2px);
  }
  .modal {
    background: var(--bg-elev);
    border-radius: 14px;
    box-shadow: var(--shadow-lg);
    width: min(720px, 100%);
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .modal-head {
    padding: 18px 22px;
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    border-bottom: 1px solid var(--border);
  }
  .modal-head h2 {
    margin: 0;
    font-size: 19px;
  }
  .muted {
    color: var(--fg-muted);
    margin-left: auto;
  }
  .small {
    font-size: 13px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .modal-body {
    padding: 22px;
    overflow: auto;
  }
  .modal-foot {
    padding: var(--space-md) 22px;
    display: flex;
    gap: 10px;
    border-top: 1px solid var(--border);
    background: var(--bg-sunken);
    align-items: center;
  }
  @media (max-width: 480px) {
    .modal-scrim {
      padding: var(--space-sm);
    }
    .modal-head {
      padding: 14px 16px;
    }
    .modal-body {
      padding: 16px;
    }
    .modal-foot {
      padding: var(--space-sm) 16px;
    }
    .wiz-steps {
      padding: 8px 16px 0;
    }
    .discard-confirm {
      margin: 0 16px 10px;
    }
  }
  .spacer {
    flex: 1;
  }
  .wiz-steps {
    display: flex;
    gap: 8px;
    padding: 8px 22px 0;
  }
  .wiz-step {
    flex: 1;
    padding: 12px 14px;
    border-radius: 8px;
    background: var(--bg-sunken);
    display: flex;
    gap: 12px;
    align-items: center;
    font-size: 13px;
    color: var(--fg-muted);
    border: 1px solid transparent;
  }
  .wiz-step .num {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--bg-elev);
    border: 1.5px solid var(--border-strong);
    display: grid;
    place-items: center;
    font-family: var(--font-mono);
    font-weight: 600;
    flex-shrink: 0;
  }
  .wiz-step.active {
    background: var(--accent-soft);
    color: var(--accent-strong);
    border-color: var(--accent);
  }
  .wiz-step.active .num {
    background: var(--accent);
    color: var(--accent-fg);
    border-color: var(--accent);
  }
  .wiz-step.done .num {
    background: var(--ok);
    color: var(--accent-fg);
    border-color: var(--ok);
  }
  .lbl {
    display: grid;
  }
  .lbl b {
    font-weight: 600;
    color: inherit;
  }
  .lbl .small {
    font-size: 11px;
    color: var(--fg-muted);
  }
  .btn {
    height: var(--hit);
    min-height: var(--hit);
    padding: 0 var(--space-md);
    border-radius: var(--radius);
    border: 1px solid var(--border-strong);
    background: var(--bg-elev);
    color: var(--fg);
    font-size: var(--fs-label);
    font-weight: 500;
    cursor: pointer;
  }
  .btn:hover {
    background: var(--bg-sunken);
  }
  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .btn.primary {
    background: var(--accent);
    color: var(--accent-fg);
    border-color: var(--accent);
  }
  .btn.primary:hover:not(:disabled) {
    background: var(--accent-strong);
  }
  .btn.ghost {
    background: transparent;
    border-color: transparent;
  }
  .btn.ghost:hover {
    background: var(--bg-sunken);
  }
  .err-banner {
    margin-top: 16px;
    padding: 12px 16px;
    background: var(--bg-elev);
    border: 1px solid var(--dnf);
    border-radius: var(--radius);
    color: var(--dnf);
    font-size: 14px;
  }
  /* Discard-confirm bar — shown only when the scrim is tapped with
     unsaved input. Lives outside .modal-body so it sits between body and
     foot for visual separation. */
  .discard-confirm {
    margin: 0 22px 12px;
    padding: 10px 12px;
    background: var(--mp-soft);
    border: 1px solid var(--mp);
    border-radius: var(--radius);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .discard-msg {
    margin: 0;
    color: var(--fg);
    font-size: 13.5px;
    font-weight: 500;
  }
  .discard-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .btn.danger {
    background: var(--dnf);
    color: #fff;
    border-color: var(--dnf);
  }
</style>
