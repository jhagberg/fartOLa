<!--
  Authored for fartola. Not ported from upstream.

  Single competition tile rendered inside HomeView's auto-fill grid.
  Mirrors `screens-home.jsx` `.comp-card`:
    - hover lifts border to accent + adds shadow
    - top row: title + ISO date + StatusPill
    - progress bar (finished / starters)
    - bottom meta row: starters · finished · status label

  The card is `<button>` for tap-target compliance — the whole tile is
  clickable per UI-SPEC §"Component Inventory" and screens-home.jsx.
  44px min-height is already exceeded by the inner padding so the --hit
  token doesn't need an explicit clamp here.

  Locked by:
  - 01-UI-SPEC.md §HomeView
  - 01-SKETCHES/.../screens-home.jsx CompetitionCard structure
  - 01-12-PLAN.md task 1
-->
<script lang="ts">
  import type { CompetitionDTO } from '@fartola/shared-types';
  import { t } from '$lib/i18n/index.ts';

  interface Props {
    competition: CompetitionDTO;
    /** Optional pre-aggregated counts; falls back to `—` placeholders if
     * the caller hasn't computed them yet (Phase 1 readout view owns the
     * authoritative counts). */
    starters?: number | null;
    finished?: number | null;
    status?: 'live' | 'done';
    onclick?: (c: CompetitionDTO) => void;
  }

  let { competition, starters = null, finished = null, status = 'live', onclick }: Props =
    $props();

  const progressPct = $derived(
    starters && finished !== null && starters > 0
      ? Math.min(100, Math.round((finished / starters) * 100))
      : 0
  );
</script>

<button
  type="button"
  class="comp-card"
  onclick={() => onclick?.(competition)}
  data-testid="competition-card"
>
  <div class="top">
    <div>
      <h3>{competition.name}</h3>
      <div class="date">{competition.date}</div>
    </div>
    <span class="pill pill-{status}">
      {status === 'live' ? t('home.status.live') : t('home.status.done')}
    </span>
  </div>
  <div class="progress-bar"><div style="width: {progressPct}%"></div></div>
  <div class="meta">
    <span>{t('home.starters')} <b>{starters ?? '—'}</b></span>
    <span>{t('home.finished')} <b>{finished ?? '—'}</b></span>
    {#if competition.eventor_event_id}
      <span class="eventor-chip" data-testid="eventor-chip">
        {t('competition.eventorChip', { id: competition.eventor_event_id })}
      </span>
    {/if}
  </div>
</button>

<style>
  .comp-card {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    cursor: pointer;
    transition:
      border 0.12s,
      box-shadow 0.12s;
    text-align: left;
    font: inherit;
    color: inherit;
    width: 100%;
  }
  .comp-card:hover {
    border-color: var(--accent);
    box-shadow: var(--shadow-md);
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
  }
  .comp-card h3 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
  }
  .date {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg-muted);
    margin-top: 2px;
  }
  .pill {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .pill-live {
    background: var(--ok-soft);
    color: var(--ok);
  }
  .pill-done {
    background: var(--bg-sunken);
    color: var(--fg-muted);
  }
  .progress-bar {
    height: 6px;
    background: var(--bg-sunken);
    border-radius: 999px;
    overflow: hidden;
  }
  .progress-bar div {
    height: 100%;
    background: var(--accent);
    border-radius: 999px;
  }
  .meta {
    display: flex;
    gap: 18px;
    font-size: 13px;
    color: var(--fg-muted);
    margin-top: auto;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }
  .meta b {
    color: var(--fg);
    font-weight: 600;
    font-family: var(--font-mono);
  }
  /* Plan 11 — Eventor linkage chip inside the card meta row */
  .eventor-chip {
    margin-left: auto;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-sunken);
    color: var(--accent);
    border: 1px solid var(--border);
    font-weight: 600;
  }
</style>
