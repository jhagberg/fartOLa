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
  import { t } from '$lib/i18n/index.ts';
  import { WsClient } from '$lib/ws/client.ts';
  import { resultsChannel, type WsEnvelope } from '@fartola/shared-types';
  import type { CompetitionDTO, ClassDTO, CourseDTO, SoftStatus } from '@fartola/shared-types';
  import { getCompetition, getResults } from '$lib/api/client.ts';
  import ClassTabs from '$lib/components/ClassTabs.svelte';
  import ResultsTable from '$lib/components/ResultsTable.svelte';
  import MissingStartsPanel from '$lib/components/MissingStartsPanel.svelte';

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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let courses: CourseDTO[] = $state([]);
  let classesMeta: ClassDTO[] = $state([]);
  /** Per-class rows keyed by class_id; class_id 'ALL' is the aggregate
   * computed from `classRows`. */
  let classRows: Map<string, ResultRow[]> = $state(new Map());
  let activeId = $state('ALL');
  let fullscreen = $state(false);
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
  const activeRows = $derived.by<ResultRow[]>(() => {
    if (activeId === 'ALL') {
      const merged: ResultRow[] = [];
      for (const rows of classRows.values()) merged.push(...rows);
      return merged;
    }
    return classRows.get(activeId) ?? [];
  });
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
    try {
      const [compRes, resultsRes] = await Promise.all([
        getCompetition(competitionId),
        getResults(competitionId) as Promise<{
          competition_id: string;
          classes: ResultsClass[];
        }>,
      ]);
      competition = compRes.competition;
      classesMeta = compRes.classes;
      courses = compRes.courses;
      const next = new Map<string, ResultRow[]>();
      for (const c of resultsRes.classes) next.set(c.class_id, c.rows);
      classRows = next;
      updatedAtMs = Date.now();
      if (activeId === 'ALL' && classesMeta.length > 0) {
        // Keep ALL as default — operators projecting the screen want the
        // aggregate; per-class tabs are one click away.
      }
    } catch {
      // Soft fail — WS will catch up if the projection is computable.
    }
    connectWs();
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
    const next = new Map<string, ResultRow[]>();
    for (const c of payload.classes) next.set(c.class_id, c.rows);
    classRows = next;
    updatedAtMs = Date.now();
  }

  function onResultsUpdate(payload: ResultsUpdatePayload): void {
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
      <button
        type="button"
        class="btn-fs"
        data-testid="results-fullscreen-toggle"
        onclick={() => void toggleFullscreen()}
      >
        {fullscreen ? `⤓ ${t('res.exit')}` : `⤢ ${t('res.fullscreen')}`}
      </button>
    </div>
  </header>

  <ClassTabs classes={tabItems} {totalCount} {activeId} onSelect={onTabSelect} />

  <div class="table-wrap">
    <ResultsTable rows={activeRows} {flashIds} />
  </div>

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
    font-size: 12px;
    color: var(--ok);
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
    font-size: 12px;
  }
  .updated {
    font-size: 12px;
  }
  .head-right {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 12px;
  }
  .finished {
    font-size: 13px;
  }
  .btn-fs {
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
  .btn-fs:hover {
    background: var(--bg-sunken);
  }
  .table-wrap {
    min-width: 0;
  }
  .comp-meta {
    color: var(--fg-faint);
    font-size: 12px;
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
  .res-fs :global(.res-tab) {
    font-size: 18px;
    padding: 16px 22px;
  }
  .res-fs .h0 {
    font-size: 36px;
  }
</style>
