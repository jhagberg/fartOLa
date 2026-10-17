<!--
  Authored for fartola. Not ported from upstream.

  Two-step new-competition wizard. Codex C-H3 LOCKED: "Skapa tävling" on
  step 2 fires ONE atomic POST to /api/competitions/from-wizard; HTTP
  requests cannot share a SQL transaction, so the server wraps the
  competition INSERT and the XML ingest in one SQLite transaction. On
  failure it rolls back and no orphan competition row persists.
  wizard.spec.ts test 2 is the e2e regression gate. Nothing waits for a
  reader: the competition is created and the readout opens.

  Wizard shell:
   - Modal scrim with click-out-to-cancel (Avbryt is non-destructive at
     all steps — deferred-POST contract).
   - Top step indicator (1/2) with active + done states.
   - Body delegates to WizardStep1/2.
   - Footer: Tillbaka (step 2), Avbryt, Nästa (step 1), Skapa tävling
     (step 2). The import error banner sits under step 2.
   - The typed name, date and Eventor ID are kept in sessionStorage while
     the wizard is open, so a detour to the Eventor key settings does not
     lose them. The chosen file is not kept.

  pendingFile (File) stays in memory until Skapa tävling — see the C-H3
  deferred-POST contract.

  Locked by:
  - 01-UI-SPEC.md §"Click 1, Click 2, Click 3" + §Wizard styling
  - 01-REVIEWS.md §C-H3
  - 01-12-PLAN.md task 2
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { t } from '#lib/i18n/index.ts';
  import Icon from '#lib/ui/Icon.svelte';
  import Button from '#lib/ui/Button.svelte';
  import { createCompetitionFromWizard, setActiveCompetition } from '#lib/api/client.ts';
  import WizardStep1 from './WizardStep1.svelte';
  import WizardStep2 from './WizardStep2.svelte';
  import { validDate } from './wizardDate.ts';
  import { CompetitionLevel } from '@fartola/shared-types';

  interface Props {
    /** Where Avbryt routes to. Defaults to `/` so Home → wizard →
     * Avbryt is a clean back-trip. */
    cancelHref?: string;
  }

  let { cancelHref = '/' }: Props = $props();

  type Step = 1 | 2;
  type Kind = 'CourseData' | 'EntryList';
  interface PreviewMeta {
    filename: string;
    kind: Kind;
  }

  const DRAFT_KEY = 'fartola-wizard-draft';
  function loadDraft(): {
    name: string;
    date: string;
    eventorId: string;
    level: CompetitionLevel | null;
  } {
    const empty = { name: '', date: '', eventorId: '', level: null };
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return empty;
      const d = JSON.parse(raw) as Partial<Record<keyof typeof empty, unknown>>;
      return {
        name: typeof d.name === 'string' ? d.name : '',
        date: typeof d.date === 'string' ? d.date : '',
        eventorId: typeof d.eventorId === 'string' ? d.eventorId : '',
        level: CompetitionLevel.safeParse(d.level).success ? (d.level as CompetitionLevel) : null,
      };
    } catch {
      return empty;
    }
  }
  function clearDraft(): void {
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* storage unavailable */
    }
  }
  const draft = loadDraft();

  let step: Step = $state(1);
  let name = $state(draft.name);
  let date = $state(draft.date);
  /** The raw text typed in the Eventor ID field (lives here for the draft). */
  let eventorIdInput = $state(draft.eventorId);
  /** ADR-0018: asked before the courses import; null sends no level. */
  let level: CompetitionLevel | null = $state(draft.level);
  let submitting = $state(false);
  let pendingFile: File | null = $state(null);
  let preview: PreviewMeta | null = $state(null);
  let dropError: string | null = $state(null);
  let importError: string | null = $state(null);
  /** Plan 11 — Eventor event ID set by the wizard Eventor quickstart.
   * Flows through to the from-wizard POST body. */
  let eventorEventId: number | null = $state(null);

  /** Dirty-check (UI/UX audit #2, 2026-05-17). Accidental scrim tap on
   * a 2-step wizard would drop the operator's name + date + file work —
   * confirm first if any of those have been touched. Esc + the explicit
   * Avbryt button still close without prompt (explicit intent). */
  const dirty = $derived(
    name !== '' || date !== '' || pendingFile !== null
  );
  let confirmingClose = $state(false);

  const dateInvalid = $derived(date !== '' && !validDate(date));
  const canAdvanceFromStep1 = $derived(name.trim().length > 0 && validDate(date));
  $effect(() => {
    const d = { name, date, eventorId: eventorIdInput, level };
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    } catch {
      /* storage unavailable */
    }
  });
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
    importError = null;
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
    importError = null;
  }
  function rejectFile(msg: string): void {
    pendingFile = null;
    preview = null;
    importError = null;
    dropError = msg;
  }
  function clearDrop(): void {
    dropError = null;
  }

  async function fileToBase64(file: File): Promise<string> {
    const buf = await file.arrayBuffer();
    const u8 = new Uint8Array(buf);
    // Chunk to avoid arg-spread blowing the call stack on large files
    // (e.g. a 5 MB XML would be ~5e6 args otherwise).
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < u8.length; i += CHUNK) {
      const slice = u8.subarray(i, i + CHUNK);
      bin += String.fromCharCode.apply(null, Array.from(slice));
    }
    return btoa(bin);
  }

  function mapServerError(status: number, body: { error: string }): string {
    const code = body.error;
    if (code === 'entrylist_without_courses') return t('wiz.err.needCourse');
    if (code === 'parse_failed' || code === 'xsd_invalid') return t('wiz.err.notCourse');
    if (code === 'ingest_failed') return t('wiz.err.import');
    if (code === 'bad_filename' || code === 'bad_base64') return t('wiz.err.file');
    if (code === 'file_too_large' || status === 413) return t('wiz.err.tooLarge');
    return t('wiz.err.generic');
  }

  async function create(): Promise<void> {
    if (!pendingFile || !canAdvanceFromStep2 || submitting) return;
    importError = null;
    submitting = true;
    try {
      const content_base64 = await fileToBase64(pendingFile);
      const result = await createCompetitionFromWizard({
        name,
        date,
        xml_file: { name: pendingFile.name, content_base64 },
        // Plan 11 — pass Eventor linkage through to the atomic POST so
        // the row is linked from creation without a separate PATCH.
        ...(eventorEventId !== null ? { eventor_event_id: eventorEventId } : {}),
        level,
      });
      if (result.ok) {
        clearDraft();
        // Set the active competition so reload + bridge reconnect both
        // point at the freshly-created row. Failure here is non-fatal —
        // the readout view will fall back to the URL parameter.
        try {
          await setActiveCompetition(result.data.competition_id);
        } catch {
          /* non-fatal */
        }
        await goto(`/competition/${result.data.competition_id}/readout`);
        return;
      }
      // Codex C-H3: the server's atomic transaction rolled back; no
      // competition row exists. Show the error and stay in the wizard.
      importError = mapServerError(result.status, result.data);
    } catch {
      importError = t('wiz.err.network');
    } finally {
      submitting = false;
    }
  }

  function next(): void {
    if (step === 1 && canAdvanceFromStep1) step = 2;
  }
  function back(): void {
    importError = null;
    if (step === 2) step = 1;
  }
  function cancel(): void {
    clearDraft();
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
      <span class="muted mono small">{step}/2</span>
    </header>

    <div class="wiz-steps" aria-label={t('wiz.progress')}>
      {#each [1, 2] as n (n)}
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
          </span>
        </div>
      {/each}
    </div>

    <div class="modal-body">
      {#if step === 1}
        <WizardStep1
          {name}
          {date}
          {dateInvalid}
          bind:eventorIdInput
          preimportedFile={pendingFile}
          onnamechange={setName}
          ondatechange={setDate}
          {level}
          onlevelchange={(v) => (level = v)}
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
          <Button variant="ghost" onclick={cancelClose} data-testid="wizard-discard-cancel">
            {t('wiz.discard.keep')}
          </Button>
          <Button variant="danger" onclick={cancel} data-testid="wizard-discard-confirm-btn">
            {t('wiz.discard.discard')}
          </Button>
        </div>
      </div>
    {/if}
    <footer class="modal-foot">
      {#if step > 1}
        <Button variant="ghost" onclick={back} data-testid="wiz-back">
          <Icon name="arrow-left" size={18} /> {t('wiz.back')}
        </Button>
      {/if}
      <Button variant="ghost" onclick={cancel} data-testid="wiz-cancel">
        {t('wiz.cancel')}
      </Button>
      <div class="spacer"></div>
      {#if step === 1}
        <Button
          variant="primary"
          disabled={!canAdvanceFromStep1}
          disabledHint={t('wiz.next.missing')}
          onclick={next}
          data-testid="wiz-next"
        >
          {t('wiz.next')} <Icon name="arrow-right" size={18} />
        </Button>
      {:else}
        <Button
          variant="primary"
          disabled={!canAdvanceFromStep2 || submitting}
          onclick={create}
          data-testid="wiz-start"
        >
          {submitting ? t('wiz.creating') : t('wiz.create')}
        </Button>
      {/if}
    </footer>
  </div>
</div>

<style>
  .modal-scrim {
    position: fixed;
    inset: 0;
    background: var(--scrim);
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
    font-size: var(--fs-label);
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
    font-size: var(--fs-label);
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
    background: var(--bg-sunken);
    color: var(--fg);
    border-color: var(--fg);
    font-weight: 600;
  }
  .wiz-step.active .num {
    background: var(--bg-elev);
    color: var(--fg);
    border-color: var(--fg);
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
  .err-banner {
    margin-top: 16px;
    padding: 12px 16px;
    background: var(--bg-elev);
    border: 1px solid var(--dnf);
    border-radius: var(--radius);
    color: var(--dnf);
    font-size: var(--fs-label);
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
    font-size: var(--fs-body);
    font-weight: 500;
  }
  .discard-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
