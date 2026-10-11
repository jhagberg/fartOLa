<!--
  Authored for fartola. Not ported from upstream.

  HistoryList — vertical list of the last 12 card_reads. Newest first
  (the order of the rows array). Cap is enforced by the parent
  ReadoutView; this component is dumb-render only.

  Click a row → onSelect(row) → parent sets currentRead.

  Locked by:
  - 01-13-PLAN.md task 2
  - 01-UI-SPEC.md §"Readout view live behavior" — cap 12, click re-renders
-->
<script lang="ts">
  import { t } from '#lib/i18n/index.ts';
  import HistoryRow from './HistoryRow.svelte';
  import Icon from '#lib/ui/Icon.svelte';

  interface Row {
    cardNumber: number;
    name: string | null;
    cls: string;
    readTime: string;
    elapsed: string;
    status: 'OK' | 'MP' | 'DNF' | 'PEND' | 'DNS' | 'DQ' | 'CANCEL' | 'MAX';
    unknown: boolean;
    key: string;
  }

  interface Props {
    rows: Row[];
    /** key of the row that is currently displayed in LatestReadCard. */
    activeKey?: string | null;
    /** key of the row that just arrived — flashIn animation for 1.6s. */
    flashKey?: string | null;
    onSelect?: (row: Row) => void;
  }

  let { rows, activeKey = null, flashKey = null, onSelect }: Props = $props();

  /** Consecutive reads of the same card: newest first, earlier reads after. */
  const groups = $derived.by(() => {
    const out: Row[][] = [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (last && last[0]!.cardNumber === r.cardNumber) last.push(r);
      else out.push([r]);
    }
    return out;
  });
  let open: Record<string, boolean> = $state({});
</script>

<section class="card history-card">
  <header class="head">
    <h3>{t('ro.history')}</h3>
    <span class="badge mono">{rows.length}</span>
  </header>
  <div class="history-list" data-testid="history-list">
    {#if rows.length === 0}
      <div class="empty">—</div>
    {:else}
      {#each groups as g (g[0]!.key)}
        {@const top = g[0]!}
        {#if g.length === 1}
          <HistoryRow
            row={top}
            active={top.key === activeKey}
            flash={top.key === flashKey}
            onclick={(row) => onSelect?.(row)}
          />
        {:else}
          <div class="group" data-testid="history-group">
            <HistoryRow
              row={top}
              active={top.key === activeKey}
              flash={top.key === flashKey}
              onclick={(row) => onSelect?.(row)}
            />
            <button
              type="button"
              class="toggle"
              data-testid="history-group-toggle"
              aria-expanded={open[top.key] === true}
              aria-label={`${t('ro.history.reads', { n: g.length })}: ${t(open[top.key] ? 'ro.history.hideReads' : 'ro.history.showReads')}`}
              onclick={() => (open[top.key] = !open[top.key])}
            >
              <Icon name={open[top.key] ? 'chevron-up' : 'chevron-down'} size={16} />
              {t('ro.history.reads', { n: g.length })}
            </button>
            {#if open[top.key]}
              {#each g.slice(1) as r (r.key)}
                <HistoryRow
                  row={r}
                  active={r.key === activeKey}
                  flash={r.key === flashKey}
                  onclick={(row) => onSelect?.(row)}
                />
              {/each}
            {/if}
          </div>
        {/if}
      {/each}
    {/if}
  </div>
</section>

<style>
  .card {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  .head h3 {
    margin: 0;
    font-size: var(--fs-label);
    font-weight: 600;
  }
  .badge {
    margin-left: auto;
    font-size: var(--fs-label);
    color: var(--fg-muted);
  }
  .history-list {
    display: flex;
    flex-direction: column;
  }
  .group {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border);
  }
  .group > :global(.hist-row:first-child) {
    border-top: 0;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: var(--hit);
    padding: 0 14px;
    border: 0;
    background: transparent;
    color: var(--fg-muted);
    font: inherit;
    font-size: var(--fs-label);
    cursor: pointer;
    text-align: left;
  }
  .toggle:hover {
    background: var(--bg-sunken);
  }
  .empty {
    padding: 24px;
    text-align: center;
    color: var(--fg-faint);
  }
  .mono {
    font-family: var(--font-mono);
  }
</style>
