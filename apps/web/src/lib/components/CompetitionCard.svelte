<!--
  Authored for fartola. Not ported from upstream.

  Single competition tile rendered inside HomeView's auto-fill grid.
  Contents:
    - hover darkens the border
    - top row: title + ISO date + status pill (from date and race start)
    - optional Eventor chip

  The card is an `<a>` to the readout, so it is announced as a link. 44px min-height is already exceeded by the inner
  padding so the --hit token doesn't need an explicit clamp here.

  Locked by:
  - 01-UI-SPEC.md §HomeView
  - 01-SKETCHES/.../screens-home.jsx CompetitionCard structure
  - 01-12-PLAN.md task 1
-->
<script lang="ts">
  import type { CompetitionDTO } from '@fartola/shared-types';
  import { t } from '#lib/i18n/index.ts';
  import { competitionStatus } from './competitionStatus.ts';

  let { competition }: { competition: CompetitionDTO } = $props();

  const status = $derived(competitionStatus(competition));
</script>

<a
  class="comp-card"
  href="/competition/{competition.id}/readout"
  data-testid="competition-card"
>
  <div class="top">
    <div>
      <h3>{competition.name}</h3>
      <div class="date">{competition.date}</div>
    </div>
    <span class="pill pill-{status}">{t(`home.status.${status}`)}</span>
  </div>
  {#if competition.eventor_event_id}
    <div class="meta">
      <span class="eventor-chip" data-testid="eventor-chip">
        {t('competition.eventorChip', { id: competition.eventor_event_id })}
      </span>
    </div>
  {/if}
</a>

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
    transition: border 0.12s;
    text-align: left;
    text-decoration: none;
    font: inherit;
    color: inherit;
    width: 100%;
    box-sizing: border-box;
  }
  .comp-card:hover {
    border-color: var(--border-strong);
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
  }
  .comp-card h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }
  .date {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--fg-muted);
    margin-top: 2px;
  }
  .pill {
    font-size: var(--fs-label);
    padding: 2px 8px;
    border-radius: 999px;
    font-weight: 600;
    white-space: nowrap;
  }
  .pill-running {
    background: var(--ok-soft);
    color: var(--ok);
  }
  .pill-today,
  .pill-finished,
  .pill-upcoming {
    background: var(--bg-sunken);
    color: var(--fg-muted);
  }
  .meta {
    display: flex;
    font-size: var(--fs-label);
    color: var(--fg-muted);
    margin-top: auto;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }
  /* Plan 11 — Eventor linkage chip */
  .eventor-chip {
    margin-left: auto;
    font-size: var(--fs-label);
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-sunken);
    color: var(--accent);
    border: 1px solid var(--border);
    font-weight: 600;
  }
</style>
