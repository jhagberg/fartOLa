<!--
  Authored for fartola. Not ported from upstream.

  HistoryRow — single row in the readout HistoryList. 3-column grid:
  card_number, name + class·readTime, elapsed + StatusPill (small).
  Unknown rows render with the DNF accent and no class column.

  Click sets the parent's `currentRead` to this row. Unknown rows
  additionally fire `onWalkup(cardNumber)` so the operator can open the
  walk-up overlay for any historical unknown card (UI-SPEC §"Walk-up
  modal" subsequent-cards behavior — C-M3 LOCKED).

  Port of `.hist-row` in screens-readout.jsx (~lines 93-122).

  Locked by:
  - 01-13-PLAN.md task 2
  - 01-UI-SPEC.md §"Readout view live behavior" (cap 12; clickable rows;
    active row gets accent left bar)
-->
<script lang="ts">
  import StatusPill from '#lib/ui/StatusPill.svelte';
  import { t } from '#lib/i18n/index.ts';
  import Icon from '#lib/ui/Icon.svelte';

  interface Row {
    cardNumber: number;
    name: string | null;
    cls: string;
    readTime: string;
    elapsed: string;
    status: 'OK' | 'MP' | 'DNF' | 'PEND' | 'DNS' | 'DQ' | 'CANCEL' | 'MAX';
    unknown: boolean;
    /** Locally-unique key — usually `${event_time_ms}-${local_seq}`. */
    key: string;
  }

  interface Props {
    row: Row;
    active?: boolean;
    /** Set on the most-recent row after a card_read for 1.6s. */
    flash?: boolean;
    onclick?: (row: Row) => void;
  }

  let { row, active = false, flash = false, onclick }: Props = $props();

  function handle(): void {
    onclick?.(row);
  }
</script>

<button
  type="button"
  class="hist-row"
  class:unmatched={row.unknown}
  class:active
  class:flash
  data-testid="history-row"
  data-card={row.cardNumber}
  data-unknown={row.unknown ? '1' : '0'}
  onclick={handle}
>
  <div class="h-card mono">{row.cardNumber}</div>
  <div class="h-mid">
    <div class="h-name">{#if row.unknown}<Icon name="alert-triangle" size={16} /> {t('ro.unknownCard')}{:else}{row.name ?? '—'}{/if}</div>
    <div class="h-class mono">{row.cls} · {row.readTime}</div>
  </div>
  <div class="h-right">
    <div class="h-time mono">{row.elapsed || '—'}</div>
    <StatusPill status={row.status} small />
  </div>
</button>

<style>
  .hist-row {
    display: grid;
    grid-template-columns: 60px 1fr auto;
    gap: 10px;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
    align-items: center;
    font-size: 13px;
    background: transparent;
    width: 100%;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
    min-height: 56px;
    font-family: inherit;
    color: inherit;
    position: relative;
    border-left: 0;
    border-right: 0;
    border-bottom: 0;
  }
  .hist-row:first-child {
    border-top: 0;
  }
  .hist-row:hover {
    background: var(--bg-sunken);
  }
  .hist-row.active {
    background: var(--bg-sunken);
  }
  .hist-row.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 6px;
    bottom: 6px;
    width: 3px;
    background: var(--fg);
    border-radius: 2px;
  }
  .hist-row.flash {
    animation: flashIn 1.6s ease-out;
  }
  @keyframes flashIn {
    0% {
      background: var(--accent-soft);
    }
    100% {
      background: transparent;
    }
  }
  .h-card {
    color: var(--fg-muted);
    font-size: 12px;
  }
  .h-mid {
    min-width: 0;
    overflow: hidden;
  }
  .h-name {
    font-weight: 500;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }
  .hist-row.unmatched .h-name {
    color: var(--dnf);
  }
  .h-class {
    color: var(--fg-muted);
    font-size: 12px;
  }
  .h-right {
    text-align: right;
  }
  .h-time {
    font-size: 14px;
  }
  .mono {
    font-family: var(--font-mono);
    font-feature-settings:
      'tnum' 1,
      'zero' 1;
  }
</style>
