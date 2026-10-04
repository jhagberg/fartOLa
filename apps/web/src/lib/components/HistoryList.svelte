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
      {#each rows as r (r.key)}
        <HistoryRow
          row={r}
          active={r.key === activeKey}
          flash={r.key === flashKey}
          onclick={(row) => onSelect?.(row)}
        />
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
    font-size: 11px;
    color: var(--fg-muted);
  }
  .history-list {
    display: flex;
    flex-direction: column;
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
