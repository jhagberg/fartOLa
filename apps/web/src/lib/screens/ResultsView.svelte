<!--
  Authored for fartola. Not ported from upstream.

  Live results view (/competition/[id]/results). Mounts the per-class tabs
  + the results table, subscribes to results:<competitionId> for live
  updates, and toggles fullscreen (projector) mode via the F key + the
  on-screen button.

  Wire flow:
   - On mount: GET /api/competitions/:id (competition + classes) +
     GET /api/competitions/:id/results (initial snapshot).
   - WS subscribe to resultsChannel(competitionId). Server emits
     `results_full` once on hello + `results_update` per-class on every
     projection recompute (see apps/edge/src/projection/store.ts).
   - results_full → replace allRows + updatedAtMs (UI-SPEC §"Live results
     auto-update" — header timestamp refreshes on every message).
   - results_update → splice the affected class's rows. Newly-introduced
     competitor_ids (compared to the previous snapshot's rows for that
     class) join the flashIds set for 4s.
   - F key (when not typing in an input) toggles fullscreen mode.

  Locked by:
  - 01-14-PLAN.md task 2
  - 01-UI-SPEC.md §"Live results auto-update" + §"Fullscreen mode"
  - 01-UI-SPEC.md §"Keyboard shortcuts" (F toggles fullscreen)
  - REQ-EVT-CMP-007 (live results page on localhost during the event)
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { t } from '#lib/i18n/index.ts';
  import { WsClient } from '#lib/ws/client.ts';
  import { resultsChannel, type WsEnvelope } from '@fartola/shared-types';
  import type { CompetitionDTO, ClassDTO, CourseDTO, SoftStatus } from '@fartola/shared-types';
  import { getCompetition, getResults } from '#lib/api/client.ts';
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';
  import Button from '#lib/ui/Button.svelte';
  import Icon from '#lib/ui/Icon.svelte';
  import LoadError from '#lib/ui/LoadError.svelte';
  import ClassTabs from '#lib/components/ClassTabs.svelte';
  import ResultsTable from '#lib/components/ResultsTable.svelte';
  import MissingStartsPanel from '#lib/components/MissingStartsPanel.svelte';
  import { resultGroups } from './class-course.ts';

  interface ResultRow {
    competitor_id: string;
    name: string;
    club: string | null;
    status: 'PEND' | 'OK' | 'MP' | 'DNF' | 'DNS' | 'DQ' | 'CANCEL' | 'MAX';
    elapsed_time_ms: number | null;
    place: number | null;
    behind_leader_ms: number | null;
    soft_status: SoftStatus;
  }

  interface ResultsClass {
    class_id: string;
    class_name: string;
    rows: ResultRow[];
  }

  interface ResultsFullPayload {
    classes: ResultsClass[];
    pending_unknown_cards: number[];
  }

  interface ResultsUpdatePayload {
    class_id: string;
    class_name: string;
    rows: ResultRow[];
  }

  interface Props {
    competitionId: string;
  }

  let { competitionId }: Props = $props();

  // --- state ----------------------------------------------------------------
  let competition: CompetitionDTO | null = $state(null);
  let courses: CourseDTO[] = $state([]);
  let classesMeta: ClassDTO[] = $state([]);
  /** Per-class rows keyed by class_id; class_id 'ALL' is the aggregate
   * computed from `classRows`. */
  let classRows: Map<string, ResultRow[]> = $state(new Map());
  let activeId = $state('ALL');
  let fullscreen = $state(false);
  let loadError = $state(false);
  let loadSeq = 0;
  let updatedAtMs = $state<number | null>(null);
  /** competitor_ids whose row should flash. Cleared after 4s by per-id
   * setTimeout (UI-SPEC §"Live results auto-update"). */
  let flashIds = $state<Set<string>>(new Set());
  const flashTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let wsClient: WsClient | null = null;

  // --- derived UI shapes ----------------------------------------------------
  const tabItems = $derived(
    classesMeta.map((c) => ({
      id: c.id,
      name: c.name,
      count: (classRows.get(c.id) ?? []).length,
    }))
  );
  const totalCount = $derived.by(() => {
    let n = 0;
    for (const rows of classRows.values()) n += rows.length;
    return n;
  });
  /** SOFT TR 7.8.2: one table per class, each under its heading with course
   * and length — also in the default "all classes" view. */
  const groups = $derived(resultGroups(activeId, classesMeta, classRows, courses, t('res.course')));
  const activeRows = $derived(groups.flatMap((g) => g.rows));
  const finishedCount = $derived(activeRows.filter((r) => r.status === 'OK').length);
  const updatedLabel = $derived.by(() => {
    if (updatedAtMs === null) return '—';
    const d = new Date(updatedAtMs);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  });

  // --- effects --------------------------------------------------------------
  onMount(() => {
    void mountResults();
    window.addEventListener('keydown', onKeydown);
    document.addEventListener('fullscreenchange', onFullscreenChange);
  });

  onDestroy(() => {
    if (wsClient) wsClient.close();
    for (const t of flashTimers.values()) clearTimeout(t);
    flashTimers.clear();
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', onKeydown);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    }
  });

  async function mountResults(): Promise<void> {
    await load();
    connectWs();
  }

  /** Resets the error flag first. A live push (WS) or a newer load
   * supersedes this one: its results must not overwrite newer data. */
  async function load(): Promise<void> {
    const seq = ++loadSeq;
    loadError = false;
    const [comp, res] = await Promise.allSettled([
      getCompetition(competitionId),
      getResults(competitionId) as Promise<{
        competition_id: string;
        classes: ResultsClass[];
      }>,
    ]);
    // The class list does not change with live pushes: keep it either way.
    if (comp.status === 'fulfilled') {
      competition = comp.value.competition;
      classesMeta = comp.value.classes;
      courses = comp.value.courses;
      // The class in the URL; an unknown id falls back to "all classes".
      const wanted = page.url.searchParams.get('klass');
      activeId = classesMeta.some((c) => c.id === wanted) ? wanted! : 'ALL';
    }
    if (seq !== loadSeq) return;
    if (comp.status === 'rejected' || res.status === 'rejected') {
      loadError = true;
      return;
    }
    const next = new Map<string, ResultRow[]>();
    for (const c of res.value.classes) next.set(c.class_id, c.rows);
    classRows = next;
    updatedAtMs = Date.now();
  }

  /** A live push is newer than any load in flight, and proves the
   * results can be shown once the classes are known. */
  function livePush(): void {
    loadSeq++;
    if (classesMeta.length > 0) loadError = false;
  }

  function connectWs(): void {
    if (typeof window === 'undefined') return;
    const wsUrl =
      window.location.protocol === 'https:'
        ? `wss://${window.location.host}/ws`
        : `ws://${window.location.host}/ws`;
    wsClient = new WsClient(wsUrl, handleWs);
    wsClient.preSubscribe(resultsChannel(competitionId));
    wsClient.connect();
  }

  function handleWs(env: WsEnvelope): void {
    if (env.type === 'results_full') {
      onResultsFull(env.payload as ResultsFullPayload);
    } else if (env.type === 'results_update') {
      onResultsUpdate(env.payload as ResultsUpdatePayload);
    }
  }

  function onResultsFull(payload: ResultsFullPayload): void {
    livePush();
    const next = new Map<string, ResultRow[]>();
    for (const c of payload.classes) next.set(c.class_id, c.rows);
    classRows = next;
    updatedAtMs = Date.now();
  }

  function onResultsUpdate(payload: ResultsUpdatePayload): void {
    livePush();
    const prev = classRows.get(payload.class_id) ?? [];
    const prevIds = new Set(prev.map((r) => r.competitor_id));
    // Identify newly-introduced competitor_ids — these get the .new flash.
    const fresh: string[] = [];
    for (const r of payload.rows) {
      if (!prevIds.has(r.competitor_id)) fresh.push(r.competitor_id);
    }
    const next = new Map(classRows);
    next.set(payload.class_id, payload.rows);
    classRows = next;
    updatedAtMs = Date.now();

    if (fresh.length > 0) {
      const nextFlash = new Set(flashIds);
      for (const id of fresh) {
        nextFlash.add(id);
        if (flashTimers.has(id)) clearTimeout(flashTimers.get(id)!);
        const timer = setTimeout(() => {
          const after = new Set(flashIds);
          after.delete(id);
          flashIds = after;
          flashTimers.delete(id);
        }, 4_000);
        flashTimers.set(id, timer);
      }
      flashIds = nextFlash;
    }
  }

  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key !== 'F' && ev.key !== 'f') return;
    const tag = (ev.target as HTMLElement | null)?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    ev.preventDefault();
    void toggleFullscreen();
  }

  async function toggleFullscreen(): Promise<void> {
    if (typeof document === 'undefined') return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Browsers may reject requestFullscreen outside a user gesture; we
      // still flip the local class so the projector look is reachable from
      // headless e2e (Playwright's keydown dispatch is not a user gesture).
      fullscreen = !fullscreen;
    }
  }

  function onFullscreenChange(): void {
    fullscreen = document.fullscreenElement !== null;
  }

  function onTabSelect(id: string): void {
    activeId = id;
    const url = new URL(page.url.href);
    if (id === 'ALL') url.searchParams.delete('klass');
    else url.searchParams.set('klass', id);
    replaceState(url, page.state);
  }
</script>

<div
  class="results"
  class:res-fs={fullscreen}
  data-testid="results-view"
  data-fullscreen={fullscreen}
  data-updated-ms={updatedAtMs ?? ''}
>
  <header class="res-head">
    <h1 class="h0">{t('res.title')}</h1>
    <span class="live">
      <span class="pulse-dot"></span>
      {t('ro.feed.live')}
    </span>
    <span class="muted mono updated" data-testid="results-updated">
      {t('res.updated')}
      {updatedLabel}
    </span>
    <div class="head-right">
      <span class="muted finished">
        {finishedCount}/{activeRows.length}
        {t('res.finished')}
      </span>
      <Button
        variant="secondary"
        data-testid="results-fullscreen-toggle"
        onclick={() => void toggleFullscreen()}
      >
        <Icon name={fullscreen ? 'minimize' : 'maximize'} size={16} />
        {fullscreen ? t('res.exit') : t('res.fullscreen')}
      </Button>
    </div>
  </header>

  <ClassTabs classes={tabItems} {totalCount} {activeId} onSelect={onTabSelect} />

  {#if loadError}
    <LoadError message={t('res.loadError')} onretry={() => void load()} />
  {/if}

  {#each loadError ? [] : groups as g (g.classId)}
    <h2 class="class-course" data-testid="results-class-course">{g.heading}</h2>
    <div class="table-wrap">
      <ResultsTable rows={g.rows} {flashIds} />
    </div>
  {:else}
    {#if !loadError}
      <div class="table-wrap">
        <ResultsTable rows={[]} {flashIds} />
      </div>
    {/if}
  {/each}

  <!-- 02.1-14 Task 15: secretariat sets missing start times (not on the projector) -->
  {#if !fullscreen}
    <MissingStartsPanel {competitionId} refreshKey={updatedAtMs} />
  {/if}

  {#if competition}
    <p class="comp-meta">{competition.name} · {competition.date}</p>
  {/if}
</div>

<style>
  .results {
    display: flex;
    flex-direction: column;
    gap: 16px;
    height: 100%;
  }
  .class-course {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }
  .res-head {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .h0 {
    margin: 0;
    font-size: 28px;
    font-weight: 600;
  }
  .live {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--fg-muted);
    padding: 4px 10px;
    background: var(--ok-soft);
    border-radius: 999px;
  }
  .pulse-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
  }
  .muted {
    color: var(--fg-muted);
  }
  .mono {
    font-family: var(--font-mono);
    font-feature-settings:
      'tnum' 1,
      'zero' 1;
    font-size: var(--fs-label);
  }
  .updated {
    font-size: var(--fs-label);
  }
  .head-right {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 12px;
  }
  .finished {
    font-size: var(--fs-label);
  }
  .table-wrap {
    min-width: 0;
  }
  .comp-meta {
    color: var(--fg-muted);
    font-size: var(--fs-label);
    margin: 0;
  }

  /* Fullscreen / projector mode (UI-SPEC §"Fullscreen mode"). The
     CSS class hooks scale typography for 1080p projection. The class
     is toggled both on the actual document.fullscreenElement event and
     locally when requestFullscreen rejects (headless e2e). */
  .res-fs {
    position: fixed;
    inset: 0;
    background: var(--bg);
    z-index: 80;
    padding: 36px;
    overflow: auto;
  }
  .res-fs :global(.res-table th),
  .res-fs :global(.res-table td) {
    padding: 18px 22px;
    font-size: 18px;
  }
  .res-fs :global(.res-table td.tm) {
    font-size: 22px;
  }
  .res-fs :global(.res-table td.plc) {
    font-size: 22px;
  }
  .res-fs :global(.status) {
    font-size: 18px;
  }
  .res-fs :global(.res-tab) {
    font-size: 18px;
    padding: 16px 22px;
  }
  .res-fs .h0 {
    font-size: 36px;
  }
</style>
