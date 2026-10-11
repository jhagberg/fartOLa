<!--
  Authored for fartola. Not ported from upstream.

  "Start och stämplingar" at the top of the edit dialog: what the secretariat
  needs to see before correcting a result — which start the time runs from,
  the controls in course order (punched, missing, by hand), the splits, the
  finish and the read. The same PunchGrid and SplitsTable as the readout card.

  Fetches by competitor id (the corrections endpoint, not the readout list,
  which keeps only the last 12 reads). The latest fetch wins: a dialog reused
  for another runner, or a refetch after a manual punch (`reloadKey`), never
  lands an older answer. A failed fetch says so with a retry; it never reads
  as "not read yet".
-->
<script lang="ts">
  import Icon from '#lib/ui/Icon.svelte';
  import LoadError from '#lib/ui/LoadError.svelte';
  import StatusPill from '#lib/ui/StatusPill.svelte';
  import PunchGrid from '#lib/components/PunchGrid.svelte';
  import SplitsTable from '#lib/components/SplitsTable.svelte';
  import { courseCodes, toEditRunnerRead, type EditRunnerRead } from './edit-runner-read.ts';
  import { t } from '#lib/i18n/index.ts';
  import {
    getCompetition,
    getCorrections,
    listHiredCards,
    listVoidedControls,
  } from '#lib/api/client.ts';

  interface Props {
    competitionId: string;
    competitorId: string;
    classId: string;
    cardNumber: number | null;
    /** Bumped by the parent after a correction: fetch again. */
    reloadKey?: number;
  }

  let { competitionId, competitorId, classId, cardNumber, reloadKey = 0 }: Props = $props();

  let view = $state<EditRunnerRead | null>(null);
  let failed = $state(false);
  let hired = $state(false);

  let generation = 0;
  async function load(): Promise<void> {
    const mine = ++generation;
    failed = false;
    try {
      const [corrections, comp, voided] = await Promise.all([
        getCorrections(competitionId, competitorId),
        getCompetition(competitionId),
        listVoidedControls(competitionId),
      ]);
      if (mine !== generation) return;
      const cls = comp.classes.find((c) => c.id === classId);
      view = toEditRunnerRead(corrections, {
        clockOffsetMin: comp.competition.clock_offset_min,
        expectedCodes: courseCodes(cls, comp.courses),
        voidedCodes: voided.control_codes,
        noTiming: cls?.no_timing ?? false,
      });
    } catch {
      if (mine !== generation) return;
      view = null;
      failed = true;
    }
  }

  /** Retry from the error: reset first, so the block reads "loading". */
  function retry(): void {
    view = null;
    void load();
  }

  async function loadHired(): Promise<void> {
    const card = cardNumber;
    hired = false;
    if (card === null) return;
    try {
      const res = await listHiredCards(competitionId);
      if (card === cardNumber) hired = res.open.some((c) => c.card_number === card);
    } catch {
      // The card number still shows; only the rental line is left out.
    }
  }

  // A different runner starts blank; the same runner refetched keeps what it
  // shows until the new answer arrives.
  $effect(() => {
    void competitorId;
    void classId;
    view = null;
    void loadHired();
  });
  $effect(() => {
    void competitorId;
    void reloadKey;
    void load();
  });
</script>

<details class="read" open data-testid="edit-read">
  <summary>{t('edit.read.title')}</summary>
  <div class="read-body">
    <p class="card" data-testid="edit-read-card">
      <span class="mono"
        >{cardNumber === null ? t('edit.read.noCard') : t('edit.read.card', { card: cardNumber })}</span
      >
      {#if hired}
        <span class="tag" data-testid="edit-read-hire">{t('edit.read.hire')}</span>
      {/if}
    </p>

    {#if failed}
      <div data-testid="edit-read-error">
        <LoadError message={t('edit.read.loadError')} onretry={retry} />
      </div>
    {:else if view === null}
      <p class="muted" data-testid="edit-read-loading">{t('edit.read.loading')}</p>
    {:else}
      <div class="facts">
        <div>
          <span class="label">{t('ro.start')}</span>
          <div class="value" data-testid="edit-read-start">
            {#if view.start.drawn === null && view.start.punch === null}
              {t('edit.read.noStart')}
            {:else}
              {#if view.start.drawn !== null}
                <span>{t('edit.read.drawn')} <b class="mono">{view.start.drawn}</b></span>
              {/if}
              {#if view.start.punch !== null}
                <span>{t('edit.read.startPunch')} <b class="mono">{view.start.punch}</b></span>
              {/if}
            {/if}
          </div>
        </div>
        {#if view.start.from !== null}
          <p class="from" data-testid="edit-read-from">
            {t(view.start.from === 'drawn' ? 'edit.read.fromDrawn' : 'edit.read.fromPunch')}
          </p>
        {/if}
        {#if view.lateStart !== null}
          <p class="late" role="status" data-testid="edit-read-late">
            <Icon name="alert-triangle" size={16} />
            {t('ro.lateStart', { diff: view.lateStart })}
          </p>
        {/if}
        {#if view.neverRead}
          <p class="muted" data-testid="edit-read-never">{t('edit.read.never')}</p>
        {:else}
          {#if view.finish !== null}
            <div>
              <span class="label">{t('edit.read.finish')}</span>
              <div class="value mono" data-testid="edit-read-finish">
                {view.finish.byHand
                  ? t('edit.read.finishByHand', { time: view.finish.time })
                  : view.finish.time}
              </div>
            </div>
          {/if}
          <div>
            <span class="label">{t('edit.read.readAt')}</span>
            <div class="value" data-testid="edit-read-readat">
              <span class="mono">{view.readAt}</span>
              <span>{t('edit.read.reads', { count: view.readCount })}</span>
            </div>
          </div>
          <div>
            <span class="label">{t('ro.status')}</span>
            <div class="value" data-testid="edit-read-status">
              <StatusPill status={view.status} />
              {#if view.elapsed !== null}<b class="mono">{view.elapsed}</b>{/if}
            </div>
          </div>
          {#if view.timeAddition !== null}
            <p class="from" data-testid="edit-read-addition">
              {t('corr.line.addition', {
                minutes: view.timeAddition.min,
                reason: view.timeAddition.reason,
              })}
            </p>
          {/if}
        {/if}
      </div>

      {#if view.punches.length > 0}
        <h3>{t('edit.read.punches')}</h3>
        <PunchGrid punches={view.punches} verdict={view.verdict} />
        {#if view.manualPunches.length > 0}
          <ul class="by-hand" data-testid="edit-read-by-hand">
            {#each view.manualPunches as p (p.code)}
              <li><Icon name="edit" size={16} /> {t('corr.line.punch', { code: p.code, reason: p.reason })}</li>
            {/each}
          </ul>
        {/if}
        <h3>{t('edit.read.splits')}</h3>
        <SplitsTable punches={view.punches} />
      {/if}
    {/if}
  </div>
</details>

<style>
  .read {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-sunken);
  }
  summary {
    min-height: var(--hit);
    display: flex;
    align-items: center;
    padding: 0 var(--space-sm);
    font-weight: 600;
    cursor: pointer;
  }
  .read-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding: 0 var(--space-sm) var(--space-sm);
  }
  p {
    margin: 0;
  }
  .card {
    display: flex;
    gap: var(--space-xs);
    align-items: center;
    flex-wrap: wrap;
  }
  .tag {
    padding: 2px 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    font-size: var(--fs-label);
  }
  .muted {
    color: var(--fg-muted);
  }
  .facts {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2xs);
  }
  .facts > div {
    display: flex;
    gap: var(--space-xs);
    flex-wrap: wrap;
    align-items: baseline;
  }
  .label {
    min-width: 7ch;
    color: var(--fg-muted);
  }
  .value {
    display: flex;
    gap: var(--space-sm);
    flex-wrap: wrap;
    align-items: center;
  }
  .from {
    color: var(--fg-muted);
    font-size: var(--fs-label);
  }
  .late {
    display: flex;
    gap: var(--space-2xs);
    align-items: center;
    padding: 6px 10px;
    border: 1px solid var(--mp);
    border-radius: var(--radius);
    background: var(--mp-soft);
    color: var(--mp-fg);
    font-weight: 600;
  }
  h3 {
    margin: var(--space-2xs) 0 0;
    font-size: var(--fs-label);
    color: var(--fg-muted);
    font-weight: 600;
  }
  .by-hand {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--fs-label);
  }
</style>
