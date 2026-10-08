<!--
  Authored for fartola. Not ported from upstream.

  "Ändringar av starttider": the latest changes to start times (draws, late
  entrants, hand edits, missing starts, imports, clock shifts, undos),
  newest first, each with an "Ångra" button. Undo puts back what that change
  replaced, whole or nothing; when the server refuses (a runner or the
  class's grid changed again since, or a clock shift) the reason is shown
  next to that change (ADR-0016 rule 2: undo rather than "are you sure?",
  and recent changes stay in a list). Logic lives in
  screens/start-time-history.ts.
-->
<script lang="ts">
  import { t } from '#lib/i18n/index.ts';
  import { formatClockTime } from '@fartola/shared-types';
  import { getStartTimeHistory, undoStartTimes } from '#lib/api/client.ts';
  import { fetchCompetitionClock } from '#lib/screens/competition-clock.ts';
  import {
    canUndo,
    undoErrorOf,
    type StartTimeHistoryItem,
  } from '#lib/screens/start-time-history.ts';
  import Button from '#lib/ui/Button.svelte';

  interface Props {
    competitionId: string;
    /** Class names by id, for the class column. */
    classNames: Record<string, string>;
    /** Bumped by the parent when start times change, to refetch. */
    refreshKey?: number;
    /** Called after an undo, so the parent reloads its start list. */
    onUndone?: () => void;
  }

  let { competitionId, classNames, refreshKey = 0, onUndone }: Props = $props();

  /** Rows shown before "Visa alla". */
  const FIRST = 5;

  let items = $state<StartTimeHistoryItem[]>([]);
  let offsetMin = $state<number | null>(null);
  let loadError = $state<string | null>(null);
  let showAll = $state(false);
  let busyKey = $state<string | null>(null);
  let rowError = $state<{ key: string; text: string } | null>(null);
  let doneText = $state<string | null>(null);

  const keyOf = (i: StartTimeHistoryItem) => `${i.node_id}:${i.local_seq}`;

  async function load(): Promise<void> {
    try {
      const [res, clock] = await Promise.all([
        getStartTimeHistory(competitionId),
        fetchCompetitionClock(competitionId),
      ]);
      items = res.items;
      offsetMin = clock.offsetMin;
      loadError = null;
    } catch (e) {
      loadError = (e as Error).message;
    }
  }

  $effect(() => {
    void refreshKey;
    void competitionId;
    void load();
  });

  async function undo(item: StartTimeHistoryItem): Promise<void> {
    busyKey = keyOf(item);
    rowError = null;
    doneText = null;
    try {
      const res = await undoStartTimes(competitionId, {
        node_id: item.node_id,
        local_seq: item.local_seq,
      });
      doneText = t('history.undone', { count: res.changed });
      onUndone?.();
      await load();
    } catch (e) {
      const { key, vars } = undoErrorOf(e);
      rowError = { key: keyOf(item), text: vars === undefined ? t(key) : t(key, vars) };
    } finally {
      busyKey = null;
    }
  }

  const shown = $derived(showAll ? items : items.slice(0, FIRST));
  const classText = (id: string | null) =>
    id === null ? t('history.allClasses') : (classNames[id] ?? '–');
</script>

<section class="history" data-testid="start-time-history" aria-labelledby="start-time-history-h">
  <h2 id="start-time-history-h">{t('history.title')}</h2>
  {#if loadError}
    <p class="err" role="alert">{t('history.err.load', { error: loadError })}</p>
  {:else if items.length === 0}
    <p class="muted">{t('history.empty')}</p>
  {:else}
    {#if doneText !== null}
      <p class="done" role="status" data-testid="history-done">{doneText}</p>
    {/if}
    <ul class="rows">
      {#each shown as item (keyOf(item))}
        <li class="row" data-testid="history-row" data-cause={item.cause}>
          <div class="what">
            <span class="mono">{offsetMin === null ? '' : formatClockTime(item.at_ms, offsetMin)}</span>
            <strong>{t(`history.cause.${item.cause}`)}</strong>
            <span>{classText(item.class_id)}</span>
            <span class="muted">{t('history.changed', { count: item.changed })}</span>
          </div>
          <div class="action">
            {#if item.undone}
              <span class="state" data-testid="history-undone">{t('history.isUndone')}</span>
            {:else if item.cause === 'clock_shift'}
              <span class="state">{t('history.notUndoable')}</span>
            {:else if canUndo(item)}
              <Button
                variant="secondary"
                disabled={busyKey !== null}
                onclick={() => void undo(item)}
                data-testid="history-undo"
              >
                {busyKey === keyOf(item) ? '…' : t('history.undo')}
              </Button>
            {/if}
          </div>
          {#if rowError !== null && rowError.key === keyOf(item)}
            <p class="err row-err" role="alert" data-testid="history-error">{rowError.text}</p>
          {/if}
        </li>
      {/each}
    </ul>
    {#if items.length > FIRST}
      <Button variant="ghost" onclick={() => (showAll = !showAll)} data-testid="history-toggle">
        {showAll ? t('history.showFewer') : t('history.showAll', { count: items.length })}
      </Button>
    {/if}
  {/if}
</section>

<style>
  .history {
    display: grid;
    gap: var(--space-sm);
  }
  h2 {
    margin: 0;
    font-size: var(--fs-label);
    font-weight: 600;
  }
  .muted {
    color: var(--fg-muted);
  }
  .mono {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum' 1;
  }
  .err,
  .done,
  .muted {
    margin: 0;
    font-size: var(--fs-body);
  }
  .err {
    color: var(--dnf);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-xs) var(--space-sm);
    padding: var(--space-xs) var(--space-sm);
    border-bottom: 1px solid var(--border);
    font-size: var(--fs-body);
  }
  .row:last-child {
    border-bottom: none;
  }
  .what {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-sm);
    align-items: baseline;
  }
  .state {
    color: var(--fg-muted);
    font-style: italic;
  }
  .row-err {
    flex-basis: 100%;
  }
</style>
