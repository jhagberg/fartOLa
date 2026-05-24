<!--
  Authored for fartola. Not ported from upstream.

  ImportRunnersView — the "where do I add runners?" surface.

  Two paths into the same ingestEntryList pipeline:
   1. Direct from Eventor by date — operator picks the competition date,
      we list events from Eventor (filtered to STK org), operator picks
      the event, we POST /api/competitions/:id/eventor-import with that
      event ID. Server does the actual download + XSD + ingest in one
      atomic transaction (eventorImport route).
   2. Upload an IOF EntryList XML — fallback for offline / non-STK orgs
      / pre-downloaded files. POSTs multipart to the existing
      /api/competitions/:id/import endpoint.

  Both paths share the same success/error surface so the operator
  doesn't have to learn two flows.

  UI shape: date picker → event list → import. We skip the parallel
  Eventor club + class fetches because fartOLa already pulls clubs as
  part of the cachedcompetitors boot job and classes come from the
  CourseData import (no separate Eventor fetch needed).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n/index.ts';
  import {
    listEventorEvents,
    importEntriesFromEventor,
    importCompetitionFile,
    getCompetition,
    patchCompetition,
    getEventorEvent,
    type EventorEventListItem,
    type EventorImportResult,
    type EventorEventMeta,
  } from '$lib/api/client.ts';
  import { ApiError } from '$lib/api/client.ts';
  import Button from '$lib/ui/Button.svelte';
  import Field from '$lib/ui/Field.svelte';
  import Input from '$lib/ui/Input.svelte';
  import Icon from '$lib/ui/Icon.svelte';

  interface Props {
    competitionId: string;
    /** Hides the local header (title + subtitle) when this view is
     * embedded inside a parent surface that already provides one — e.g.
     * the Importera sheet on /runners. Defaults to false so the
     * standalone /import deep-link still renders the full page chrome. */
    embedded?: boolean;
  }

  let { competitionId, embedded = false }: Props = $props();

  // --- Linked-event state (Plan 11) -----------------------------------------
  /** When the competition has eventor_event_id set, this holds the fetched
   * event metadata (name, date) for the linked-event card. */
  let linkedEvent = $state<EventorEventMeta | null>(null);
  /** Set while relinking (date picker flow replaces the linked event). */
  let relinking = $state(false);
  let relinkError = $state<string | null>(null);

  // --- Eventor path ---------------------------------------------------------
  /** ISO date the operator wants to search Eventor on. Defaults to the
   * competition's date when known; otherwise today. */
  let searchDate = $state('');
  /** Inline date validation error, set on blur and cleared on next edit. */
  let dateError = $state<string | null>(null);
  let events = $state<EventorEventListItem[]>([]);
  let searching = $state(false);
  let searchError = $state<string | null>(null);
  /** True after a successful search; lets us render "no events" instead of
   * just showing an empty list (which the operator might mistake for
   * "didn't run yet"). */
  let searched = $state(false);
  /** EventId currently being imported — disables the row's button so a
   * double-tap can't double-POST. Null while no import is in flight. */
  let importingEventId = $state<number | null>(null);
  let importResult = $state<EventorImportResult | null>(null);
  /** Captured at the moment of a successful import so the success banner
   * can say "X importerade FRÅN <event-name>" — operator who picked the
   * wrong row otherwise gets a bare count with no recourse. */
  let lastImportedEvent = $state<EventorEventListItem | null>(null);
  let importError = $state<string | null>(null);

  // --- Upload-XML path ------------------------------------------------------
  let uploadInput: HTMLInputElement | undefined = $state();
  let uploading = $state(false);
  let uploadError = $state<string | null>(null);

  /** Build a user-facing error string from a thrown ApiError. When the
   * server responds with `{ error: 'xsd_invalid', errors: [...] }` (or any
   * other shape that carries a structured `errors` array), surface the
   * first few entries so the operator can actually see WHAT failed instead
   * of a bare `"xsd_invalid"` code. */
  function formatApiError(e: unknown, fallback: string): string {
    if (!(e instanceof ApiError)) return (e as Error)?.message || fallback;
    const body = e.body as { error?: string; errors?: unknown } | undefined;
    const code = body?.error ?? e.message ?? fallback;
    const errs = Array.isArray(body?.errors) ? body!.errors : null;
    if (!errs || errs.length === 0) return code;
    const head = errs
      .slice(0, 3)
      .map((x) =>
        typeof x === 'string' ? x : typeof x === 'object' && x ? JSON.stringify(x) : String(x)
      );
    const more = errs.length > 3 ? ` (+${errs.length - 3} more)` : '';
    return `${code}: ${head.join('; ')}${more}`;
  }

  // --- Init: prefill the date from the competition record ------------------
  onMount(() => {
    void prefillDate();
  });
  async function prefillDate(): Promise<void> {
    try {
      const res = await getCompetition(competitionId);
      // getCompetition returns { competition: { date, eventor_event_id, ... }, ... }
      const comp = (res as unknown as { competition?: { date?: string; eventor_event_id?: number | null } }).competition;
      const compDate = comp?.date;
      if (compDate && /^\d{4}-\d{2}-\d{2}$/.test(compDate)) {
        searchDate = compDate;
      } else {
        searchDate = isoToday();
      }
      // Plan 11 — fetch linked-event metadata when eventor_event_id is set.
      const eid = comp?.eventor_event_id;
      if (eid != null) {
        try {
          linkedEvent = await getEventorEvent(eid);
        } catch {
          // Non-fatal: linked-event card won't show, but the import still works.
          linkedEvent = null;
        }
      }
    } catch {
      searchDate = isoToday();
    }
  }
  function isoToday(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // --- date validation (audit follow-up #6, mirrors RegistrationView's
  //     blur-validation pattern) ----------------------------------------
  function validDate(s: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(s);
  }
  function onDateInput(): void {
    if (dateError !== null) dateError = null;
  }
  function onDateBlur(): void {
    if (searchDate.trim() === '') {
      dateError = null;
      return;
    }
    if (!validDate(searchDate)) dateError = t('importRunners.errBadDate');
  }

  async function search(): Promise<void> {
    searchError = null;
    importResult = null;
    importError = null;
    if (!validDate(searchDate)) {
      dateError = t('importRunners.errBadDate');
      return;
    }
    searching = true;
    try {
      const res = await listEventorEvents({
        fromDate: searchDate,
        toDate: searchDate,
      });
      events = res.events;
      searched = true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        searchError = t('importRunners.errNoKey');
      } else {
        searchError = (e as Error).message || t('importRunners.errSearchFailed');
      }
      events = [];
      searched = false;
    } finally {
      searching = false;
    }
  }

  async function importEvent(ev: EventorEventListItem): Promise<void> {
    importError = null;
    importResult = null;
    importingEventId = ev.eventId;
    try {
      const res = await importEntriesFromEventor(competitionId, ev.eventId);
      importResult = res;
      lastImportedEvent = ev;
    } catch (e) {
      lastImportedEvent = null;
      if (e instanceof ApiError && e.status === 503) {
        importError = t('importRunners.errNoKey');
      } else if (e instanceof ApiError && e.status === 502) {
        importError = t('importRunners.errEventorDown');
      } else {
        importError = formatApiError(e, t('importRunners.errImportFailed'));
      }
    } finally {
      importingEventId = null;
    }
  }

  // --- Linked-event import (Plan 11) ----------------------------------------

  async function importFromLinkedEvent(): Promise<void> {
    if (!linkedEvent) return;
    importError = null;
    importResult = null;
    importingEventId = linkedEvent.eventId;
    try {
      const res = await importEntriesFromEventor(competitionId, linkedEvent.eventId);
      importResult = res;
      lastImportedEvent = {
        eventId: linkedEvent.eventId,
        name: linkedEvent.name,
        date: linkedEvent.startDate,
        clock: null,
      };
    } catch (e) {
      lastImportedEvent = null;
      if (e instanceof ApiError && e.status === 503) {
        importError = t('importRunners.errNoKey');
      } else if (e instanceof ApiError && e.status === 502) {
        importError = t('importRunners.errEventorDown');
      } else {
        importError = formatApiError(e, t('importRunners.errImportFailed'));
      }
    } finally {
      importingEventId = null;
    }
  }

  function startRelink(): void {
    // Exit linked-event mode; operator now uses the normal date-picker
    // search to pick a new event. When they import a different event we
    // PATCH the competition to store the new eventor_event_id.
    linkedEvent = null;
    relinking = true;
    relinkError = null;
  }

  async function relinkEvent(ev: EventorEventListItem): Promise<void> {
    relinkError = null;
    importingEventId = ev.eventId;
    try {
      await patchCompetition(competitionId, { eventor_event_id: ev.eventId });
      linkedEvent = { eventId: ev.eventId, name: ev.name, startDate: ev.date, organisation: null };
      relinking = false;
      const res = await importEntriesFromEventor(competitionId, ev.eventId);
      importResult = res;
      lastImportedEvent = ev;
    } catch (e) {
      lastImportedEvent = null;
      if (e instanceof ApiError && e.status === 503) {
        relinkError = t('importRunners.errNoKey');
      } else if (e instanceof ApiError && e.status === 502) {
        relinkError = t('importRunners.errEventorDown');
      } else {
        relinkError = formatApiError(e, t('importRunners.errImportFailed'));
      }
    } finally {
      importingEventId = null;
    }
  }

  // --- Upload path ----------------------------------------------------------
  function openUploadPicker(): void {
    uploadInput?.click();
  }
  async function onUploadChange(e: Event): Promise<void> {
    const target = e.currentTarget as HTMLInputElement;
    const file = target.files && target.files[0];
    target.value = '';
    if (!file) return;
    uploadError = null;
    importResult = null;
    importError = null;
    uploading = true;
    try {
      const res = await importCompetitionFile(competitionId, file);
      // importCompetitionFile returns a different shape than the eventor
      // route (it can dispatch CourseData OR EntryList) — cast to the
      // EntryList branch we expect here.
      const r = res as unknown as EventorImportResult;
      if (r && r.kind === 'EntryList') {
        importResult = r;
      } else {
        uploadError = t('importRunners.errWrongKind');
      }
    } catch (e) {
      uploadError = formatApiError(e, t('importRunners.errImportFailed'));
    } finally {
      uploading = false;
    }
  }
</script>

<section
  class="import-runners"
  class:embedded
  data-testid="import-runners-view"
>
  {#if !embedded}
    <header class="head">
      <h1 class="title">{t('importRunners.title')}</h1>
      <p class="muted">{t('importRunners.subtitle')}</p>
    </header>
  {/if}

  <!-- Eventor card ---------------------------------------------------- -->
  <section class="card">
    <header class="section-head">
      <span class="ico" aria-hidden="true"><Icon name="download" size={18} /></span>
      <h2>{t('importRunners.eventor.title')}</h2>
    </header>
    <p class="desc muted small">{t('importRunners.eventor.desc')}</p>

    {#if linkedEvent !== null && !relinking}
      <!-- Linked-event card (Plan 11): compact view when the competition
           has an eventor_event_id stored. Replaces the date-picker search.
           "Länka om" exits back to the date-picker search flow. -->
      <div class="linked-card" data-testid="linked-event-card">
        <div class="linked-meta">
          <span class="event-name">{linkedEvent.name}</span>
          <span class="muted small mono">ID {linkedEvent.eventId} · {linkedEvent.startDate}</span>
        </div>
        <div class="linked-actions">
          <Button
            variant="primary"
            size="sm"
            onclick={() => void importFromLinkedEvent()}
            disabled={importingEventId !== null}
            data-testid="linked-import-btn"
          >
            {importingEventId === linkedEvent.eventId
              ? t('importRunners.importing')
              : t('import.linked.import')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onclick={startRelink}
            disabled={importingEventId !== null}
            data-testid="linked-relink-btn"
          >
            {t('import.relink')}
          </Button>
        </div>
      </div>
      {#if relinkError}
        <p class="err" role="alert" data-testid="import-relink-error">{relinkError}</p>
      {/if}
    {:else}
      <!-- Normal date-picker search flow. Also used when relinking=true so
           the operator can pick a new event. On successful import while
           relinking=true, relinkEvent() PATCHes eventor_event_id + imports. -->

      <!-- Form wrap: Enter on the date input submits the search instead of
           being swallowed (audit follow-up #5). preventDefault on submit
           stops the page reload; the button stays type=submit so screen
           readers announce the form action correctly. -->
      <form
        class="search-row"
        onsubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <Field label={t('importRunners.eventor.dateLabel')} htmlFor="import-date">
          <Input
            id="import-date"
            data-testid="import-date"
            type="text"
            bind:value={searchDate}
            oninput={onDateInput}
            onblur={onDateBlur}
            placeholder="ÅÅÅÅ-MM-DD"
            maxlength={10}
            aria-invalid={dateError !== null}
            aria-describedby={dateError !== null ? 'import-date-error' : undefined}
          />
        </Field>
        <Button
          variant="primary"
          type="submit"
          disabled={searching}
          data-testid="import-search"
        >
          <span class="btn-label">
            {searching ? t('importRunners.eventor.searching') : t('importRunners.eventor.search')}
          </span>
        </Button>
      </form>

      {#if dateError}
        <p id="import-date-error" class="err" role="alert" data-testid="import-date-error">
          {dateError}
        </p>
      {/if}

      {#if searchError}
        <p class="err" role="alert" data-testid="import-search-error">{searchError}</p>
      {/if}

      {#if searched && events.length === 0 && !searchError}
        <p class="muted small" data-testid="import-empty">
          {t('importRunners.eventor.noEvents', { date: searchDate })}
        </p>
      {/if}

      {#if events.length > 0}
        <ul class="event-list" data-testid="import-event-list">
          {#each events as ev (ev.eventId)}
            <li class="event-row" data-testid="import-event-row">
              <div class="event-meta">
                <span class="event-name">{ev.name}</span>
                <span class="muted small mono">
                  {ev.date}{ev.clock ? ` · ${ev.clock.slice(0, 5)}` : ''} · ID {ev.eventId}
                </span>
              </div>
              <Button
                variant="primary"
                size="sm"
                onclick={() => void (relinking ? relinkEvent(ev) : importEvent(ev))}
                disabled={importingEventId !== null}
                data-testid="import-event-btn"
              >
                {importingEventId === ev.eventId
                  ? t('importRunners.importing')
                  : relinking
                    ? t('import.relink')
                    : t('importRunners.import')}
              </Button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </section>

  <!-- Upload card ----------------------------------------------------- -->
  <section class="card">
    <header class="section-head">
      <span class="ico" aria-hidden="true"><Icon name="download" size={18} /></span>
      <h2>{t('importRunners.upload.title')}</h2>
    </header>
    <p class="desc muted small">{t('importRunners.upload.desc')}</p>

    <div class="upload-row">
      <input
        bind:this={uploadInput}
        type="file"
        accept=".xml,application/xml,text/xml"
        onchange={onUploadChange}
        class="hidden-file-input"
        tabindex={-1}
        aria-hidden="true"
        data-testid="import-upload-input"
      />
      <Button
        variant="ghost"
        onclick={openUploadPicker}
        disabled={uploading}
        data-testid="import-upload-btn"
      >
        {uploading ? t('importRunners.uploading') : t('importRunners.upload.button')}
      </Button>
    </div>

    {#if uploadError}
      <p class="err" role="alert" data-testid="import-upload-error">{uploadError}</p>
    {/if}
  </section>

  <!-- Result banner --------------------------------------------------- -->
  {#if importResult}
    <div class="result ok" role="status" data-testid="import-result">
      <strong>
        {#if lastImportedEvent}
          {t('importRunners.successFrom', {
            count: importResult.competitors_created,
            name: lastImportedEvent.name,
            eventId: lastImportedEvent.eventId,
          })}
        {:else}
          {t('importRunners.success', { count: importResult.competitors_created })}
        {/if}
      </strong>
      {#if importResult.competitors_skipped_duplicate > 0}
        <p class="small" data-testid="import-skipped">
          {t('importRunners.skippedDuplicate', {
            count: importResult.competitors_skipped_duplicate,
          })}
        </p>
      {/if}
      {#if importResult.auto_bound.length > 0}
        <p class="small">
          {t('importRunners.autoBound', { count: importResult.auto_bound.length })}
        </p>
      {/if}
      {#if importResult.classes_missing.length > 0}
        <p class="warn small" data-testid="import-classes-missing">
          {t('importRunners.classesMissing', { classes: importResult.classes_missing.join(', ') })}
        </p>
      {/if}
    </div>
  {/if}

  {#if importError}
    <p class="err" role="alert" data-testid="import-error">{importError}</p>
  {/if}
</section>

<style>
  .import-runners {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    padding: var(--space-md);
    max-width: 720px;
    min-width: 0;
  }
  /* Embedded mode: drop the outer padding/width cap so the sheet host
     controls the spacing instead. */
  .import-runners.embedded {
    padding: var(--space-md);
    max-width: none;
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .title {
    margin: 0;
    font-size: var(--fs-heading);
    font-weight: 600;
  }
  .muted {
    color: var(--fg-muted);
    margin: 0;
  }
  .small {
    font-size: 13px;
  }
  .mono {
    font-family: var(--font-mono);
    font-feature-settings:
      'tnum' 1,
      'zero' 1;
  }
  .err {
    margin: 0;
    color: var(--dnf);
    font-size: 13px;
  }
  .warn {
    margin: 4px 0 0;
    color: var(--mp);
  }
  .card {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }
  .section-head {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
  }
  .section-head h2 {
    margin: 0;
    font-size: var(--fs-label);
    font-weight: 600;
  }
  .ico {
    color: var(--accent);
    display: inline-flex;
  }
  .desc {
    margin: 0;
    line-height: 1.4;
  }
  .search-row {
    display: flex;
    gap: var(--space-sm);
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .search-row :global(.field) {
    flex: 1 1 200px;
  }
  /* Linked-event card (Plan 11) */
  .linked-card {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: 10px 12px;
    background: var(--ok-soft);
    border: 1px solid var(--ok);
    border-radius: var(--radius);
  }
  .linked-meta {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .linked-actions {
    display: flex;
    gap: var(--space-xs);
    flex-shrink: 0;
  }
  .event-list {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }
  .event-row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: 10px 12px;
    background: var(--bg-sunken);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    transition: border-color 120ms ease-out, background 120ms ease-out;
  }
  /* Row hover/focus-within so the operator sees where each row begins
     and ends — without this, the row felt like just-a-button. */
  .event-row:hover,
  .event-row:focus-within {
    background: var(--bg-elev);
    border-color: var(--border-strong);
  }
  .event-meta {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .event-name {
    font-weight: 600;
    color: var(--fg);
  }
  .upload-row {
    display: flex;
    gap: var(--space-sm);
  }
  /* Search button keeps a stable width across the "Sök tävlingar" ↔
     "Söker…" label swap so the layout doesn't jitter on every search. */
  .search-row :global(button) {
    min-width: 9rem;
  }
  .btn-label {
    display: inline-block;
    text-align: center;
    width: 100%;
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
  .result {
    margin: 0;
    padding: 12px 14px;
    background: var(--ok-soft);
    border: 1px solid var(--ok);
    border-radius: var(--radius);
    color: var(--ok);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .result.ok strong {
    font-weight: 600;
    color: var(--ok);
  }
  @media (max-width: 480px) {
    .import-runners {
      padding: var(--space-sm);
    }
    .search-row {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
