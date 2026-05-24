<!--
  Authored for fartola. Not ported from upstream.

  Wizard step 1 — name + date (+ optional quickstart-import).

  Two paths into this step:
   - Manual: operator types Name + Date.
   - Quickstart (NEW 2026-05-17): operator drops the IOF XML 3.0
     CourseData file here. We parse the first ~4 KB to extract
     <Event><Name> and the root @createTime, pre-fill the form, AND
     hand the parsed File up to the wizard so Step 2's DropZone shows
     the same file as already-loaded (no double-upload).

  Date input uses `type="text"` with an ISO-8601 pattern, NOT the
  native `<input type="date">`. The native control was attempted with
  `lang="sv"` first, but Chrome on Linux ignores the element-level lang
  attribute for date input rendering and falls back to the system
  LANG/LANGUAGE locale — so on Jonas's laptop the native picker rendered
  the value as `DD/MM/YYYY` even with `lang="sv"`. A text input with
  `pattern="\d{4}-\d{2}-\d{2}"` and Swedish-format placeholder gives a
  stable YYYY-MM-DD display on every Chrome/Firefox/Safari/OS combo.
  The quickstart-import path auto-fills this field from the XML
  `<Event>` block in most real-world cases anyway. Server-side Zod
  stays authoritative on format.

  Locked by:
  - 01-UI-SPEC.md §"Click 1, Click 2, Click 3" + §"Date inputs"
  - 01-12-PLAN.md task 2
  - .planning/state/2026-05-17 Jonas wizard usability feedback
-->
<script lang="ts">
  import { t } from '$lib/i18n/index.ts';
  import { getEventorEvent } from '$lib/api/client.ts';
  import { ApiError } from '$lib/api/client.ts';

  interface PreviewMeta {
    filename: string;
    kind: 'CourseData' | 'EntryList';
  }

  interface Props {
    name: string;
    date: string;
    /** Set when a file was imported via the quickstart pane. Used to
     * render a "Banfil importerad" badge here AND to short-circuit
     * Step 2's drop zone (the wizard owns the File). */
    preimportedFile: File | null;
    onnamechange: (v: string) => void;
    ondatechange: (v: string) => void;
    /** Quickstart callback. Fires once per successful import. The
     * wizard sets pendingFile + preview + name + date in one shot, so
     * Step 2 sees the file as already-loaded and the form fields show
     * the parsed values (operator can still edit them). */
    onquickstart: (file: File, parsedName: string, parsedDate: string, preview: PreviewMeta) => void;
    onquickstartclear: () => void;
    /** Eventor quickstart callback — fires when the operator fetched event
     * metadata via the Eventor event ID field. The wizard stores the ID so
     * it flows through to the final from-wizard POST. */
    oneventorquickstart?: (eventorEventId: number, parsedName: string, parsedDate: string) => void;
    oneventorquickstartclear?: () => void;
    /** Current Eventor event ID (null = not linked). */
    eventorEventId?: number | null;
  }

  let {
    name,
    date,
    preimportedFile,
    onnamechange,
    ondatechange,
    onquickstart,
    onquickstartclear,
    oneventorquickstart,
    oneventorquickstartclear,
    eventorEventId = null,
  }: Props = $props();

  let quickstartError = $state<string | null>(null);
  let fileInput: HTMLInputElement | undefined = $state();

  // --- Eventor quickstart state ------------------------------------------
  /** The raw text the operator types in the Eventor event ID field. */
  let eventorIdInput = $state('');
  let eventorFetching = $state(false);
  let eventorError = $state<string | null>(null);

  /** Same 4 KB head sample Step 2 uses — enough to land the root
   * element + the small <Event> block at the top of an IOF document. */
  const HEAD_BYTES = 4096;

  /** Strip BOM / XML decl / comments / CDATA so the root-element +
   * Event/Name regexes don't trip on prose. Lifted verbatim from
   * WizardStep2.inspectFile so the two paths agree on parse semantics. */
  function stripPreamble(s: string): string {
    return s
      .replace(/^﻿/, '')
      .replace(/<\?xml[^?]*\?>/i, '')
      .replace(new RegExp('<!--[\\s\\S]*?(?:-->|$)', 'g'), '')
      .replace(new RegExp('<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>|$)', 'g'), '');
  }

  /** Pull name + date hints out of an IOF 3.0 head. Both are best-
   * effort; the operator can override either field afterwards.
   *
   *   Source 1: <Event><Name>…</Name></Event>
   *     - May be present in both CourseData and EntryList.
   *     - Condes convention: "<YYYY-MM-DD> <event title>".
   *       We split on the date prefix to populate date + name.
   *     - If no date prefix, use whole Name as name + fall back to (2).
   *   Source 2: root @createTime="YYYY-MM-DDThh:mm:ss"
   *     - Always present in well-formed IOF 3.0; fallback for date. */
  function extractHints(head: string): { name: string; date: string; kind: 'CourseData' | 'EntryList' } | null {
    const cleaned = stripPreamble(head);
    const root = cleaned.match(/<\s*(CourseData|EntryList)\b([^>]*)>/);
    if (!root) return null;
    const kind = root[1] as 'CourseData' | 'EntryList';
    const rootAttrs = root[2] ?? '';

    // <Event> block, then nearest <Name> inside it.
    const evMatch = cleaned.match(/<Event\b[^>]*>([\s\S]*?)<\/Event>/);
    let evName = '';
    if (evMatch && evMatch[1]) {
      const nameMatch = evMatch[1].match(/<Name\b[^>]*>([^<]+)<\/Name>/);
      if (nameMatch && nameMatch[1]) evName = nameMatch[1].trim();
    }

    let name = '';
    let date = '';
    if (evName) {
      const datePfx = evName.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
      if (datePfx && datePfx[1] && datePfx[2]) {
        date = datePfx[1];
        name = datePfx[2].trim();
      } else {
        name = evName;
      }
    }
    if (!date) {
      const ctAttr = rootAttrs.match(/createTime="(\d{4}-\d{2}-\d{2})/);
      if (ctAttr && ctAttr[1]) date = ctAttr[1];
    }
    if (!name && !date) return null;
    return { name, date, kind };
  }

  async function handleQuickstartFile(file: File): Promise<void> {
    quickstartError = null;
    if (!file.name.toLowerCase().endsWith('.xml')) {
      quickstartError = t('wiz.step1.quickstart.error');
      return;
    }
    let head: string;
    try {
      head = await file.slice(0, HEAD_BYTES).text();
    } catch {
      quickstartError = t('wiz.step1.quickstart.error');
      return;
    }
    const hints = extractHints(head);
    if (!hints) {
      quickstartError = t('wiz.step1.quickstart.error');
      return;
    }
    onquickstart(file, hints.name, hints.date, { filename: file.name, kind: hints.kind });
  }

  function onFileInputChange(e: Event): void {
    const target = e.currentTarget as HTMLInputElement;
    const file = target.files && target.files[0];
    if (file) void handleQuickstartFile(file);
    // Reset so picking the SAME file again still fires change.
    target.value = '';
  }

  function openPicker(): void {
    fileInput?.click();
  }

  function clearImport(): void {
    quickstartError = null;
    onquickstartclear();
  }

  // --- Eventor quickstart handlers ----------------------------------------

  async function fetchEventorQuickstart(): Promise<void> {
    eventorError = null;
    const id = Number.parseInt(eventorIdInput.trim(), 10);
    if (!Number.isFinite(id) || id <= 0) {
      eventorError = t('wizard.eventor.error', { message: 'Ogiltigt ID' });
      return;
    }
    eventorFetching = true;
    try {
      const meta = await getEventorEvent(id);
      // Prefill name and date from the fetched event. Operator can still
      // edit them before advancing.
      if (meta.name) onnamechange(meta.name);
      if (meta.startDate && /^\d{4}-\d{2}-\d{2}$/.test(meta.startDate)) {
        ondatechange(meta.startDate);
      }
      oneventorquickstart?.(meta.eventId, meta.name, meta.startDate);
    } catch (e) {
      let msg: string;
      if (e instanceof ApiError) {
        const body = e.body as { error?: string } | undefined;
        const code = body?.error ?? '';
        if (code === 'not_found') msg = 'Tävlingen hittades inte i Eventor';
        else if (code === 'no_key') msg = 'Eventor API-nyckel saknas';
        else if (code === 'forbidden') msg = 'Åtkomst nekad av Eventor';
        else if (code === 'eventor_down') msg = 'Eventor svarar inte';
        else msg = code || e.message;
      } else {
        msg = (e as Error).message || 'okänt fel';
      }
      eventorError = t('wizard.eventor.error', { message: msg });
    } finally {
      eventorFetching = false;
    }
  }

  function clearEventorQuickstart(): void {
    eventorIdInput = '';
    eventorError = null;
    oneventorquickstartclear?.();
  }

  /** "Idag"-knapp — stoppar in dagens datum i ISO-format. Audit follow-
   * up #7: efter att vi tagit bort den native date-pickern fanns ingen
   * snabbväg för en frivillig som inte vill memorera datumformatet. */
  function setToday(): void {
    const d = new Date();
    const iso =
      `${d.getFullYear()}-` +
      `${String(d.getMonth() + 1).padStart(2, '0')}-` +
      `${String(d.getDate()).padStart(2, '0')}`;
    ondatechange(iso);
  }
</script>

<div class="step-grid">
  <!-- Quickstart panel — sits ABOVE the manual form so operators see
       the fastest path first. Manual entry stays available below for
       events without a course file (rare, but supported). -->
  <section
    class="quickstart"
    class:loaded={preimportedFile !== null}
    aria-labelledby="qs-title"
  >
    <h3 id="qs-title">{t('wiz.step1.quickstart')}</h3>
    {#if preimportedFile === null}
      <p class="muted small">{t('wiz.step1.quickstart.hint')}</p>
      <div class="qs-actions">
        <input
          bind:this={fileInput}
          type="file"
          accept=".xml,application/xml,text/xml"
          onchange={onFileInputChange}
          class="hidden-file-input"
          tabindex={-1}
          aria-hidden="true"
          data-testid="wiz-step1-file"
        />
        <button
          type="button"
          class="btn primary"
          onclick={openPicker}
          data-testid="wiz-step1-quickstart-btn"
        >
          📁 {t('wiz.step1.quickstart.button')}
        </button>
      </div>
      {#if quickstartError}
        <p class="err small" role="alert" data-testid="wiz-step1-quickstart-error">{quickstartError}</p>
      {/if}
    {:else}
      <div class="loaded-row" data-testid="wiz-step1-quickstart-loaded">
        <span class="ok-icon" aria-hidden="true">✓</span>
        <div class="grow">
          <div class="loaded-msg">{t('wiz.step1.quickstart.loaded')}</div>
          <div class="mono small">{preimportedFile.name}</div>
        </div>
        <button
          type="button"
          class="btn ghost small-btn"
          onclick={clearImport}
          data-testid="wiz-step1-quickstart-clear"
        >
          {t('wiz.step1.quickstart.clear')}
        </button>
      </div>
    {/if}
  </section>

  <!-- Eventor quickstart panel — lets the operator type an Eventor event ID
       to prefill name + date without needing the course XML file first.
       Sits below the file quickstart; either path can prefill the fields. -->
  <section class="quickstart eventor-qs" aria-labelledby="evqs-title">
    <h3 id="evqs-title">{t('wizard.eventor.title')}</h3>
    {#if eventorEventId === null}
      <form
        class="evqs-row"
        onsubmit={(e) => { e.preventDefault(); void fetchEventorQuickstart(); }}
      >
        <label class="sr-only" for="evqs-id">{t('wizard.eventor.inputLabel')}</label>
        <input
          id="evqs-id"
          class="input mono evqs-input"
          type="text"
          inputmode="numeric"
          bind:value={eventorIdInput}
          placeholder={t('wizard.eventor.inputLabel')}
          disabled={eventorFetching}
          data-testid="wiz-evqs-input"
        />
        <button
          type="submit"
          class="btn primary"
          disabled={eventorFetching || eventorIdInput.trim() === ''}
          data-testid="wiz-evqs-fetch"
        >
          {eventorFetching ? t('wizard.eventor.fetching') : t('wizard.eventor.fetch')}
        </button>
      </form>
      {#if eventorError}
        <p class="err small" role="alert" data-testid="wiz-evqs-error">{eventorError}</p>
      {/if}
    {:else}
      <div class="loaded-row" data-testid="wiz-evqs-loaded">
        <span class="ok-icon" aria-hidden="true">✓</span>
        <div class="grow">
          <div class="loaded-msg">{t('wizard.eventor.loaded', { name: name || String(eventorEventId), id: eventorEventId })}</div>
        </div>
        <button
          type="button"
          class="btn ghost small-btn"
          onclick={clearEventorQuickstart}
          data-testid="wiz-evqs-clear"
        >
          {t('wiz.step1.quickstart.clear')}
        </button>
      </div>
    {/if}
  </section>

  <p class="muted divider-or">{t('wiz.step1.quickstart.skip')}</p>

  <div class="field">
    <label for="wiz-name">{t('wiz.name')}</label>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      id="wiz-name"
      class="input"
      type="text"
      value={name}
      oninput={(e) => onnamechange((e.currentTarget as HTMLInputElement).value)}
      data-testid="wiz-name"
      autofocus
    />
  </div>
  <div class="field">
    <label for="wiz-date">{t('wiz.date')}</label>
    <!-- ISO 8601 text input, NOT type="date" — see the file header for
         the Chrome/Linux locale fallback that made the native control
         unusable. Pattern validates client-side; canAdvanceFromStep1
         in the parent wizard already enforces isoDate.test(date) before
         Next, and the server's Zod schema is the authoritative gate. -->
    <div class="date-row">
      <input
        id="wiz-date"
        class="input mono"
        type="text"
        value={date}
        placeholder={t('wiz.date.placeholder')}
        pattern={'\\d{4}-\\d{2}-\\d{2}'}
        maxlength={10}
        autocomplete="off"
        spellcheck="false"
        oninput={(e) => ondatechange((e.currentTarget as HTMLInputElement).value)}
        data-testid="wiz-date"
      />
      <button
        type="button"
        class="today-btn"
        onclick={setToday}
        data-testid="wiz-date-today"
      >
        {t('wiz.date.today')}
      </button>
    </div>
    <small class="muted small">{t('wiz.date.helper')}</small>
  </div>
</div>

<style>
  .step-grid {
    display: grid;
    gap: 16px;
  }
  .muted {
    margin: 0;
    color: var(--fg-muted);
  }
  .small {
    font-size: 12.5px;
  }
  .field {
    display: grid;
    gap: 6px;
  }
  label {
    font-size: 13px;
    color: var(--fg-muted);
    font-weight: 500;
  }
  .input {
    height: var(--hit);
    min-height: var(--hit);
    padding: 0 var(--space-sm);
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    font-size: var(--fs-body);
    width: 100%;
    color: var(--fg);
  }
  .input:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
    border-color: var(--accent);
  }
  /* "Idag"-button next to date input — compensation for losing the
     native picker. Inline with the input so keyboard tab order stays
     linear: input → button → next field. */
  .date-row {
    display: flex;
    gap: var(--space-xs);
    align-items: stretch;
  }
  .date-row .input {
    flex: 1;
    min-width: 0;
  }
  .today-btn {
    flex-shrink: 0;
    min-height: var(--hit);
    padding: 0 var(--space-md);
    border-radius: var(--radius);
    border: 1px solid var(--border-strong);
    background: var(--bg-sunken);
    color: var(--fg);
    font-size: var(--fs-label);
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }
  .today-btn:hover,
  .today-btn:focus-visible {
    background: var(--bg-elev);
    border-color: var(--accent);
  }

  /* ---------- quickstart panel ---------- */
  .quickstart {
    background: var(--bg-sunken);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px 16px;
    display: grid;
    gap: 10px;
  }
  .quickstart.loaded {
    background: color-mix(in srgb, var(--ok) 8%, var(--bg-elev));
    border-color: color-mix(in srgb, var(--ok) 35%, var(--border));
  }
  .quickstart h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--fg);
  }
  .qs-actions {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .hidden-file-input {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
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
  .btn.primary {
    background: var(--accent);
    color: var(--accent-fg);
    border-color: var(--accent);
  }
  .btn.primary:hover {
    background: var(--accent-strong);
  }
  .btn.ghost {
    background: transparent;
    border-color: transparent;
  }
  .btn.ghost:hover {
    background: var(--bg-sunken);
  }
  .small-btn {
    height: auto;
    min-height: 0;
    padding: 4px 10px;
    font-size: 12.5px;
  }
  .err {
    color: var(--dnf);
    margin: 0;
  }
  .loaded-row {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .loaded-row .grow {
    flex: 1;
    display: grid;
    gap: 2px;
  }
  .loaded-row .loaded-msg {
    color: var(--ok);
    font-weight: 600;
    font-size: 13.5px;
  }
  .ok-icon {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--ok);
    color: var(--accent-fg);
    display: grid;
    place-items: center;
    font-weight: 700;
    flex-shrink: 0;
  }
  .mono {
    font-family: var(--font-mono);
    color: var(--fg-muted);
  }
  .divider-or {
    text-align: center;
    color: var(--fg-faint);
    font-size: 11.5px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 500;
    margin: 4px 0 -4px;
  }
  /* Eventor quickstart row: ID input + Hämta button side-by-side. */
  .evqs-row {
    display: flex;
    gap: var(--space-xs);
    align-items: stretch;
  }
  .evqs-input {
    flex: 1;
    min-width: 0;
  }
  /* Screen-reader-only label for the Eventor ID input. */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
