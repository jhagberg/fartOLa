<!--
  Authored for fartola. Not ported from upstream.

  Speaker view (/competition/[id]/speaker, todo 2026-10-07-speaker-view,
  REQ-UI-009): one screen instead of MeOS's per-class speaker windows. Pick
  classes and the screen splits itself (speakerGrid); an events strip runs
  across the top. Built for a 1920×1080 screen in full screen; on narrower
  screens the panels get narrower but names still wrap instead of being cut.

  Wire flow:
   - On mount: GET /api/competitions/:id (name) and
     GET /api/competitions/:id/speaker (the board, with the clock offset).
   - WS results:<id>. Any envelope (results_full on every hello,
     results_update on a read, radio_punch when ROC punches are stored)
     refetches the board, debounced. No polling.
   - Chosen classes are kept per competition in localStorage.
   - Bright light flips the same appearance setting as Inställningar.
   - Keys (not while typing): F full screen, 1–9 focus that panel.
     No auto-scroll: each panel scrolls on its own, "på väg in" on top.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    formatClockTime,
    resultsChannel,
    type SpeakerBoard,
    type SpeakerEvent,
  } from '@fartola/shared-types';
  import { t } from '#lib/i18n/index.ts';
  import { WsClient } from '#lib/ws/client.ts';
  import { getCompetition, getSpeakerBoard } from '#lib/api/client.ts';
  import { tweaks, persistTweaks } from '#lib/stores/tweaks.svelte.ts';
  import Icon from '#lib/ui/Icon.svelte';
  import SpeakerClassPanel from '#lib/components/SpeakerClassPanel.svelte';
  import { formatElapsed } from './readout-types.ts';
  import { speakerGrid } from './speaker.ts';

  interface Props {
    competitionId: string;
  }

  let { competitionId }: Props = $props();

  const storageKey = $derived(`fartola.speaker.${competitionId}`);

  let board = $state<SpeakerBoard | null>(null);
  let competitionName = $state('');
  let chosen: string[] = $state([]);
  let nowMs = $state(Date.now());
  let fullscreen = $state(false);
  let wsClient: WsClient | null = null;
  let refetchTimer: ReturnType<typeof setTimeout> | null = null;
  let tick: ReturnType<typeof setInterval> | null = null;
  let panelsEl: HTMLElement | undefined = $state();

  const shown = $derived(
    board ? board.classes.filter((c) => chosen.includes(c.class_id)) : []
  );
  const grid = $derived(speakerGrid(shown.length));
  const offsetMin = $derived(board?.clock_offset_min ?? 0);
  const strip = $derived(
    board
      ? board.events
          .filter((e) => chosen.includes(e.class_id))
          .slice(0, shown.length > 2 ? 3 : 5)
      : []
  );
  const className = (id: string): string =>
    board?.classes.find((c) => c.class_id === id)?.class_name ?? '';

  onMount(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as unknown;
      if (Array.isArray(saved)) chosen = saved.filter((x): x is string => typeof x === 'string');
    } catch {
      // Unreadable storage: start with nothing chosen.
    }
    void load();
    tick = setInterval(() => (nowMs = Date.now()), 5_000);
    window.addEventListener('keydown', onKeydown);
    document.addEventListener('fullscreenchange', onFullscreenChange);
  });

  onDestroy(() => {
    wsClient?.close();
    if (refetchTimer) clearTimeout(refetchTimer);
    if (tick) clearInterval(tick);
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', onKeydown);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    }
  });

  async function load(): Promise<void> {
    try {
      const { competition } = await getCompetition(competitionId);
      competitionName = competition.name;
    } catch {
      // The name is cosmetic here; the board still loads.
    }
    await refetch();
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
    wsClient = new WsClient(wsUrl, scheduleRefetch);
    wsClient.preSubscribe(resultsChannel(competitionId));
    wsClient.connect();
  }

  async function refetch(): Promise<void> {
    try {
      board = await getSpeakerBoard(competitionId);
      nowMs = Date.now();
    } catch {
      // Keep the last board; the next envelope tries again.
    }
  }

  function scheduleRefetch(): void {
    if (refetchTimer) return;
    refetchTimer = setTimeout(() => {
      refetchTimer = null;
      void refetch();
    }, 300);
  }

  function toggleClass(id: string): void {
    chosen = chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id];
    try {
      localStorage.setItem(storageKey, JSON.stringify(chosen));
    } catch {
      // Storage full or blocked: the choice lasts for this visit.
    }
  }

  function toggleSun(): void {
    tweaks.contrast_high = !tweaks.contrast_high;
    persistTweaks();
  }

  async function toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Rejected outside a user gesture (headless e2e): still switch the layout.
      fullscreen = !fullscreen;
    }
  }

  function onFullscreenChange(): void {
    fullscreen = document.fullscreenElement !== null;
  }

  function onKeydown(ev: KeyboardEvent): void {
    const tag = (ev.target as HTMLElement | null)?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === 'f' || ev.key === 'F') {
      ev.preventDefault();
      void toggleFullscreen();
    } else if (/^[1-9]$/.test(ev.key)) {
      const panel = panelsEl?.querySelectorAll<HTMLElement>('[data-testid="spk-panel"]')[
        Number(ev.key) - 1
      ];
      if (panel) {
        ev.preventDefault();
        panel.focus();
      }
    }
  }

  function eventPoint(e: SpeakerEvent): string {
    return e.control_code === null ? t('spk.finish') : t('spk.control', { code: e.control_code });
  }
</script>

<div class="spk" class:spk-fs={fullscreen} data-testid="speaker-view" data-fullscreen={fullscreen}>
  <header class="top">
    <h1>{t('spk.title')}</h1>
    {#if competitionName}<span class="muted">{competitionName}</span>{/if}
    <div class="actions">
      <button
        type="button"
        class="btn"
        aria-pressed={tweaks.contrast_high}
        onclick={toggleSun}
        data-testid="spk-sun"
      >
        <Icon name="sun" />
        {t('spk.sun')}
      </button>
      <button
        type="button"
        class="btn"
        onclick={() => void toggleFullscreen()}
        data-testid="spk-fullscreen"
      >
        <Icon name={fullscreen ? 'minimize' : 'maximize'} />
        {fullscreen ? t('spk.exit') : t('spk.fullscreen')}
      </button>
    </div>
  </header>

  {#if board && !fullscreen}
    <fieldset class="picker">
      <legend>{t('spk.classes')}</legend>
      {#each board.classes as c (c.class_id)}
        <button
          type="button"
          class="chip"
          aria-pressed={chosen.includes(c.class_id)}
          onclick={() => toggleClass(c.class_id)}
          data-testid="spk-class"
        >
          {#if chosen.includes(c.class_id)}<Icon name="check" />{/if}
          {c.class_name}
        </button>
      {/each}
    </fieldset>
  {/if}

  {#if shown.length > 0}
    <section class="strip" aria-label={t('spk.events')} aria-live="polite">
      <h2 class="strip-h">{t('spk.events')}</h2>
      {#if strip.length === 0}
        <p class="muted">{t('spk.events.empty')}</p>
      {:else}
        <ol>
          {#each strip as e (`${e.competitor_id}:${e.kind}:${e.control_code}`)}
            <li class:lead={e.new_leader} data-testid="spk-event">
              <span class="mono">{formatClockTime(e.at_ms, offsetMin)}</span>
              <span class="cls">{className(e.class_id)}</span>
              <span>{eventPoint(e)}</span>
              <span class="nm">{e.name}{e.club ? `, ${e.club}` : ''}</span>
              <span class="mono">
                {#if e.place !== null}<strong>{e.place}.</strong>{/if}
                {formatElapsed(e.elapsed_ms)}
                {#if e.behind_ms}+{formatElapsed(e.behind_ms)}{/if}
                {#if e.kind === 'radio_finish'}{t('spk.notRead')}{/if}
              </span>
              {#if e.new_leader}
                <span class="badge"><Icon name="trophy" />{t('spk.newLeader')}</span>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}
    </section>

    <div
      class="panels"
      bind:this={panelsEl}
      style:grid-template-columns="repeat({grid.cols}, minmax(0, 1fr))"
      style:grid-template-rows="repeat({grid.rows}, minmax(0, 1fr))"
      data-cols={grid.cols}
      data-rows={grid.rows}
      data-testid="spk-panels"
    >
      {#each shown as c (c.class_id)}
        <SpeakerClassPanel cls={c} {nowMs} {offsetMin} />
      {/each}
    </div>
    {#if !fullscreen}<p class="muted keys">{t('spk.keys')}</p>{/if}
  {:else if board}
    <p class="muted">{t('spk.choose')}</p>
  {/if}
</div>

<style>
  .spk {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    height: 100%;
    min-height: 0;
  }
  .spk-fs {
    position: fixed;
    inset: 0;
    z-index: 80;
    padding: var(--space-md);
    background: var(--bg);
  }
  .top {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }
  h1 {
    margin: 0;
    font-size: var(--fs-display);
  }
  .actions {
    margin-left: auto;
    display: flex;
    gap: var(--space-xs);
  }
  .btn,
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: var(--hit);
    padding: 0 var(--space-md);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--bg-elev);
    color: var(--fg);
    font-size: var(--fs-body);
    cursor: pointer;
  }
  .btn[aria-pressed='true'],
  .chip[aria-pressed='true'] {
    border: 2px solid var(--fg);
    font-weight: 700;
  }
  .picker {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
    margin: 0;
    padding: 0;
    border: 0;
  }
  .picker legend {
    padding: 0;
    margin-bottom: var(--space-xs);
    font-size: var(--fs-label);
    color: var(--fg-muted);
  }
  .muted {
    margin: 0;
    color: var(--fg-muted);
  }
  .strip {
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    background: var(--bg-elev);
    padding: var(--space-xs) var(--space-md);
  }
  .strip-h {
    margin: 0;
    font-size: var(--fs-label);
    color: var(--fg-muted);
  }
  .strip ol {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 18px;
  }
  .strip li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px var(--space-md);
    padding: 4px 0;
    border-bottom: 1px solid var(--border);
  }
  .strip li:last-child {
    border-bottom: 0;
  }
  .strip li.lead {
    font-weight: 700;
  }
  .cls {
    font-weight: 700;
  }
  .nm {
    overflow-wrap: anywhere;
  }
  .mono {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum' 1;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 var(--space-xs);
    border: 2px solid var(--fg);
    border-radius: var(--radius);
  }
  .panels {
    flex: 1;
    min-height: 0;
    display: grid;
    gap: var(--space-sm);
  }
  .keys {
    font-size: var(--fs-label);
  }
</style>
