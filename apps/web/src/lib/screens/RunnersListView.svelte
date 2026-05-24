<!--
  Authored for fartola. Not ported from upstream.

  RunnersListView — the canonical "Anmälda" surface. Operators land here
  from the sidebar to verify imports, find/edit a specific runner, and
  launch the Importera sheet (Eventor / file upload). Replaces the
  former /import-as-only-page UX where the imported roster was invisible.

  Data:
    - listCompetitors(competitionId)   — pre-registered + walk-ups
    - listClasses(competitionId)        — filter chips + class label resolution
    - listHiredCards(competitionId)     — bricka-chip variant lookup

  Surface contract (consumed by /competition/:id/runners/+page.svelte):
    - URL param ?import=1 opens the Importera sheet on mount; closing
      the sheet rewrites the URL without ?import so back-navigation works.
    - Tap a row → EditCompetitorModal (existing operator correction surface).
    - Empty state CTA opens the same Importera sheet.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n/index.ts';
  import {
    listCompetitors,
    listClasses,
    listHiredCards,
  } from '$lib/api/client.ts';
  import type { CompetitorDTO, ClassDTO } from '@fartola/shared-types';
  import Button from '$lib/ui/Button.svelte';
  import Input from '$lib/ui/Input.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import Modal from '$lib/ui/Modal.svelte';
  import EditCompetitorModal from '$lib/components/EditCompetitorModal.svelte';
  import AddRunnerSheet from '$lib/components/AddRunnerSheet.svelte';
  import ImportRunnersView from './ImportRunnersView.svelte';

  interface Props {
    competitionId: string;
  }

  let { competitionId }: Props = $props();

  let competitors = $state<CompetitorDTO[]>([]);
  let classes = $state<ClassDTO[]>([]);
  /** Set of card_numbers currently rented out (open hyrbrickor). Lets us
   * render the "hyrbricka" chip variant without N+1 lookups. */
  let hiredCardSet = $state<Set<number>>(new Set());

  let loading = $state(true);
  let loadError = $state<string | null>(null);

  let query = $state('');
  let selectedClassId = $state<string | null>(null); // null = Alla

  // Edit modal state
  let editTarget = $state<CompetitorDTO | null>(null);
  let editOpen = $derived(editTarget !== null);

  // Add-runner sheet (manual add — distinct from Importera which is the
  // bulk Eventor/file path).
  let addOpen = $state(false);

  // Import sheet — auto-opens when URL has ?import=1.
  const importParamOpen = $derived(page.url.searchParams.get('import') === '1');
  let importSheetOpen = $state(false);
  $effect(() => {
    importSheetOpen = importParamOpen;
  });

  async function loadAll(): Promise<void> {
    loading = true;
    loadError = null;
    try {
      const [compRes, classRes, hiredRes] = await Promise.all([
        listCompetitors(competitionId),
        listClasses(competitionId),
        listHiredCards(competitionId),
      ]);
      competitors = compRes.competitors;
      classes = classRes.classes;
      hiredCardSet = new Set(hiredRes.open.map((c) => c.card_number));
    } catch (e) {
      loadError = (e as Error).message || t('runners.loadError');
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void loadAll();
  });

  // Filter pipeline: class chip + free-text search across name/club/card.
  const classById = $derived.by(() => {
    const m = new Map<string, ClassDTO>();
    for (const c of classes) m.set(c.id, c);
    return m;
  });

  const visible = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return competitors.filter((c) => {
      if (selectedClassId !== null && c.class_id !== selectedClassId) return false;
      if (q.length === 0) return true;
      if (c.name.toLowerCase().includes(q)) return true;
      if (c.club && c.club.toLowerCase().includes(q)) return true;
      if (c.card_number !== null && String(c.card_number).includes(q)) return true;
      return false;
    });
  });

  /** Stable alphabetical sort for the visible slice — operators scan the
   * list by name when checking who's in or not. */
  const sortedVisible = $derived(
    [...visible].sort((a, b) => a.name.localeCompare(b.name, 'sv'))
  );

  function clearSearch(): void {
    query = '';
  }

  function openImportSheet(): void {
    importSheetOpen = true;
    if (!importParamOpen) {
      const u = new URL(page.url);
      u.searchParams.set('import', '1');
      void goto(u.pathname + u.search, { replaceState: true, keepFocus: true, noScroll: true });
    }
  }

  function closeImportSheet(): void {
    importSheetOpen = false;
    if (importParamOpen) {
      const u = new URL(page.url);
      u.searchParams.delete('import');
      void goto(u.pathname + (u.search.length > 1 ? u.search : ''), {
        replaceState: true,
        keepFocus: true,
        noScroll: true,
      });
    }
    // After an import the operator expects the list to reflect new rows.
    void loadAll();
  }

  function openEdit(c: CompetitorDTO): void {
    editTarget = c;
  }
  function closeEdit(): void {
    editTarget = null;
  }
  function onEditSaved(updated: CompetitorDTO): void {
    competitors = competitors.map((c) => (c.id === updated.id ? updated : c));
  }

  /** Format epoch ms as HH:MM:SS for start-time display. */
  function formatStartTime(ms: number): string {
    const totalSec = Math.floor((ms % 86_400_000) / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function openAdd(): void {
    addOpen = true;
  }
  function closeAdd(): void {
    addOpen = false;
  }
  function onAddSaved(created: CompetitorDTO): void {
    competitors = [...competitors, created];
    addOpen = false;
  }
</script>

<section class="runners" data-testid="runners-view">
  <header class="head">
    <div class="title-row">
      <h1 class="title">{t('runners.title')}</h1>
      {#if !loading && competitors.length > 0}
        <span class="count" data-testid="runners-count">
          {t('runners.count', { count: competitors.length })}
        </span>
      {/if}
    </div>
    <div class="actions">
      <Button variant="primary" onclick={openImportSheet} data-testid="runners-import-btn">
        <span class="btn-row">
          <Icon name="download" size={16} />
          {t('runners.cta.import')}
        </span>
      </Button>
      <Button variant="secondary" onclick={openAdd} data-testid="runners-add-btn">
        <span class="btn-row">
          <Icon name="plus" size={16} />
          {t('runners.cta.addManual')}
        </span>
      </Button>
    </div>
  </header>

  {#if loading}
    <p class="muted" data-testid="runners-loading">{t('runners.loading')}</p>
  {:else if loadError}
    <p class="err" role="alert" data-testid="runners-load-error">{loadError}</p>
  {:else if competitors.length === 0}
    <!-- True empty state — no runners imported yet. Primary CTA opens the
         sheet so the operator never has to leave this screen. -->
    <div class="empty-state" data-testid="runners-empty">
      <div class="empty-icon" aria-hidden="true"><Icon name="users" size={48} /></div>
      <h2 class="empty-title">{t('runners.empty.title')}</h2>
      <p class="muted">{t('runners.empty.desc')}</p>
      <Button variant="primary" onclick={openImportSheet} data-testid="runners-empty-cta">
        <span class="btn-row">
          <Icon name="download" size={16} />
          {t('runners.empty.cta')}
        </span>
      </Button>
    </div>
  {:else}
    <!-- Search + class filter chips -->
    <div class="controls">
      <div class="search-wrap">
        <span class="search-icon" aria-hidden="true"><Icon name="search" size={18} /></span>
        <Input
          data-testid="runners-search"
          type="search"
          inputmode="search"
          bind:value={query}
          placeholder={t('runners.search.placeholder')}
          aria-label={t('runners.search.placeholder')}
        />
        {#if query.length > 0}
          <button
            class="search-clear"
            type="button"
            onclick={clearSearch}
            aria-label={t('runners.search.clear')}
          >
            <Icon name="x" size={14} />
          </button>
        {/if}
      </div>
      <div
        class="chip-row"
        role="tablist"
        aria-label={t('runners.filter.allClasses')}
        data-testid="runners-class-filter"
      >
        <button
          type="button"
          role="tab"
          aria-selected={selectedClassId === null}
          class="chip"
          class:active={selectedClassId === null}
          onclick={() => (selectedClassId = null)}
        >
          {t('runners.filter.allClasses')}
        </button>
        {#each classes as klass (klass.id)}
          <button
            type="button"
            role="tab"
            aria-selected={selectedClassId === klass.id}
            class="chip"
            class:active={selectedClassId === klass.id}
            onclick={() => (selectedClassId = klass.id)}
            data-testid="runners-class-chip"
          >
            {klass.short_name ?? klass.name}
          </button>
        {/each}
      </div>
    </div>

    {#if sortedVisible.length === 0}
      <div class="empty-state subtle" data-testid="runners-noresults">
        <h2 class="empty-title">{t('runners.noResults.title', { q: query })}</h2>
        <p class="muted">{t('runners.noResults.desc')}</p>
      </div>
    {:else}
      <ul class="list" data-testid="runners-list">
        {#each sortedVisible as c (c.id)}
          {@const klass = c.class_id ? classById.get(c.class_id) : null}
          {@const isHire = c.card_number !== null && hiredCardSet.has(c.card_number)}
          <li>
            <button
              type="button"
              class="row"
              onclick={() => openEdit(c)}
              data-testid="runners-row"
              aria-label={`${t('runners.row.edit')}: ${c.name}`}
            >
              <div class="row-main">
                <span class="name">{c.name}</span>
                <span class="club" class:missing={!c.club}>
                  {c.club ?? t('runners.row.club.missing')}
                </span>
              </div>
              <div class="row-meta">
                <span class="chip-data class">
                  {klass ? (klass.short_name ?? klass.name) : t('runners.row.class.missing')}
                </span>
                {#if c.start_time_ms !== null}
                  <span class="chip-data start-time mono" data-testid="runners-start-time">
                    {formatStartTime(c.start_time_ms)}
                  </span>
                {/if}
                {#if c.card_number === null}
                  <span class="chip-data card missing" data-testid="runners-card-missing">
                    {t('runners.row.card.missing')}
                  </span>
                {:else if isHire}
                  <span class="chip-data card hire" data-testid="runners-card-hire">
                    <Icon name="key" size={12} />
                    <span class="mono">{c.card_number}</span>
                    · {t('runners.row.card.hire')}
                  </span>
                {:else}
                  <span class="chip-data card owned">
                    <span class="dot" aria-hidden="true"></span>
                    <span class="mono">{c.card_number}</span>
                  </span>
                {/if}
                <span class="chev" aria-hidden="true"><Icon name="chevron-right" size={16} /></span>
              </div>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<!-- Edit modal — reuses the existing operator correction surface so this
     view doesn't duplicate the patch-name/club/class/card form. -->
<EditCompetitorModal
  open={editOpen}
  competitor={editTarget}
  {competitionId}
  {classes}
  onClose={closeEdit}
  onSaved={onEditSaved}
/>

<!-- Manual add sheet — smart Eventor search + manual fields + Klubblös. -->
<AddRunnerSheet
  open={addOpen}
  {competitionId}
  {classes}
  onClose={closeAdd}
  onSaved={onAddSaved}
/>

<!-- Import sheet — wraps the existing ImportRunnersView so the operator
     never has to leave the roster screen to pull more entries. -->
<Modal open={importSheetOpen} onClose={closeImportSheet}>
  {#snippet head()}
    <h2 class="sheet-title">{t('runners.importSheet.title')}</h2>
    <button
      type="button"
      class="sheet-close"
      onclick={closeImportSheet}
      aria-label={t('runners.importSheet.close')}
    >
      <Icon name="x" size={18} />
    </button>
  {/snippet}
  {#snippet body()}
    <ImportRunnersView {competitionId} embedded />
  {/snippet}
</Modal>

<style>
  .runners {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    padding: var(--space-md);
    max-width: 880px;
    min-width: 0;
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }
  .title-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }
  .title {
    margin: 0;
    font-size: var(--fs-heading);
    font-weight: 600;
  }
  .count {
    color: var(--fg-muted);
    font-size: 14px;
    font-variant-numeric: tabular-nums;
  }
  .actions {
    display: flex;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }
  .btn-row {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .muted {
    color: var(--fg-muted);
    margin: 0;
  }
  .err {
    color: var(--dnf);
    margin: 0;
    font-size: 14px;
  }
  .controls {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--bg);
    padding-bottom: var(--space-2xs);
  }
  .search-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }
  .search-wrap :global(input) {
    padding-left: 36px;
    padding-right: 36px;
    width: 100%;
    min-height: 44px;
  }
  .search-icon {
    position: absolute;
    left: 10px;
    color: var(--fg-muted);
    pointer-events: none;
    display: inline-flex;
  }
  .search-clear {
    position: absolute;
    right: 8px;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    border-radius: 999px;
    color: var(--fg-muted);
    cursor: pointer;
  }
  .search-clear:hover {
    background: var(--bg-elev);
    color: var(--fg);
  }
  .chip-row {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 2px;
  }
  /* Hide scrollbar — class chip strip is finger-scrollable, doesn't need a bar */
  .chip-row::-webkit-scrollbar {
    display: none;
  }
  .chip {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    color: var(--fg);
    padding: 8px 14px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    min-height: 36px;
    transition:
      background 120ms,
      border-color 120ms,
      color 120ms;
  }
  .chip:hover {
    background: var(--bg-sunken);
  }
  .chip.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-fg, white);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .row {
    width: 100%;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px 14px;
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    cursor: pointer;
    text-align: left;
    transition:
      border-color 120ms,
      background 120ms;
    min-height: 60px;
  }
  .row:hover,
  .row:focus-visible {
    background: var(--bg-sunken);
    border-color: var(--border-strong);
  }
  .row-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .name {
    font-weight: 600;
    color: var(--fg);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .club {
    color: var(--fg-muted);
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .club.missing {
    font-style: italic;
  }
  .row-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: nowrap;
  }
  .chip-data {
    font-size: 12px;
    padding: 4px 8px;
    border-radius: 999px;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .chip-data.class {
    background: var(--bg-sunken);
    color: var(--fg);
    border: 1px solid var(--border);
    font-weight: 500;
  }
  .chip-data.card.owned {
    background: var(--ok-soft, rgba(16, 122, 87, 0.12));
    color: var(--ok, #107a57);
    border: 1px solid var(--ok, #107a57);
  }
  .chip-data.card.hire {
    background: rgba(33, 99, 224, 0.12);
    color: #1c50b8;
    border: 1px solid #1c50b8;
  }
  .chip-data.card.missing {
    background: transparent;
    color: var(--fg-muted);
    border: 1px dashed var(--border);
    font-style: italic;
  }
  .chip-data.start-time {
    background: var(--mp-soft, rgba(235, 130, 9, 0.1));
    color: oklch(0.45 0.12 70);
    border: 1px solid oklch(0.65 0.12 70);
    font-size: 11px;
  }
  .chip-data .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    display: inline-block;
  }
  .mono {
    font-family: var(--font-mono);
    font-feature-settings:
      'tnum' 1,
      'zero' 1;
  }
  .chev {
    color: var(--fg-faint);
    display: inline-flex;
  }
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xl) var(--space-md);
    text-align: center;
    border: 1px dashed var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-elev);
  }
  .empty-state.subtle {
    border-style: solid;
    background: transparent;
  }
  .empty-icon {
    color: var(--fg-faint);
  }
  .empty-title {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }
  /* Modal renders the head wrapper with padding + border-bottom; we just
     drop title + close button into the head snippet so we don't get a
     double underline. flex:1 on the title pushes the close button right. */
  .sheet-title {
    flex: 1;
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }
  .sheet-close {
    background: transparent;
    border: 0;
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    cursor: pointer;
    color: var(--fg-muted);
  }
  .sheet-close:hover {
    background: var(--bg-sunken);
    color: var(--fg);
  }
  /* Mobile: tighten paddings + stack action buttons full-width */
  @media (max-width: 480px) {
    .runners {
      padding: var(--space-sm);
    }
    .row {
      flex-direction: column;
      align-items: stretch;
    }
    .row-meta {
      justify-content: flex-start;
      flex-wrap: wrap;
    }
    .chev {
      display: none;
    }
  }
</style>
