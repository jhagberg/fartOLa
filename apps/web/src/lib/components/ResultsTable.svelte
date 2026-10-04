<!--
  Authored for fartola. Not ported from upstream.

  Per-class results table. The .new accent-soft flash lives here (UI-SPEC
  §"Live results auto-update" — 4s fade). The parent ResultsView tracks
  which competitor_ids should flash + when, and passes the Set through.

  Sort + status logic lives server-side (apps/edge/src/projection/*) so the
  Svelte side just renders. Empty state matches the sketch copy.

  Locked by:
  - 01-14-PLAN.md task 2
  - 01-UI-SPEC.md §"Live results auto-update"
-->
<script lang="ts">
  import { t } from '$lib/i18n/index.ts';
  import StatusPill from '$lib/ui/StatusPill.svelte';
  import { formatElapsed, softStatusLabel } from '$lib/screens/readout-types.ts';
  import type { SoftStatus } from '@fartola/shared-types';

  interface ResultRow {
    competitor_id: string;
    name: string;
    club: string | null;
    status: 'PEND' | 'OK' | 'MP' | 'DNF' | 'DNS' | 'DQ' | 'CANCEL' | 'MAX';
    elapsed_time_ms: number | null;
    place: number | null;
    behind_leader_ms: number | null;
    /** SOFT's name for the status (TA till TR 7.8.2), set by the edge. */
    soft_status: SoftStatus;
  }

  interface Props {
    rows: ResultRow[];
    /** competitor_ids whose row should flash with .new for ~4s. */
    flashIds: Set<string>;
  }

  let { rows, flashIds }: Props = $props();
</script>

<table class="res-table" data-testid="results-table">
  <thead>
    <tr>
      <th>{t('res.place')}</th>
      <th>{t('res.name')}</th>
      <th>{t('res.club')}</th>
      <th style="text-align: right;">{t('res.time')}</th>
      <th>{t('res.status')}</th>
    </tr>
  </thead>
  <tbody>
    {#each rows as r (r.competitor_id)}
      <tr
        class:pend={r.status === 'PEND'}
        class:new={flashIds.has(r.competitor_id)}
        data-testid="results-row"
      >
        <td class="plc">{r.place ?? '—'}</td>
        <td class="name" data-testid="results-row-name">{r.name}</td>
        <td class="club">{r.club ?? ''}</td>
        <td class="tm">{r.status === 'OK' ? formatElapsed(r.elapsed_time_ms) : '—'}</td>
        <td>
          <StatusPill
            status={r.status}
            label={softStatusLabel(r.soft_status)}
            tooltip={false}
            small
          />
        </td>
      </tr>
    {/each}
    {#if rows.length === 0}
      <tr>
        <td colspan="5" class="empty">Inga deltagare ännu.</td>
      </tr>
    {/if}
  </tbody>
</table>

<style>
  .res-table {
    width: 100%;
    border-collapse: collapse;
    background: var(--bg-elev);
    border-radius: var(--radius-lg);
    overflow: hidden;
    box-shadow: var(--shadow-sm);
  }
  .res-table th,
  .res-table td {
    padding: 14px 18px;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  .res-table th {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
    font-weight: 600;
    background: var(--bg-sunken);
  }
  .res-table td.plc {
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: 16px;
    width: 60px;
  }
  .res-table td.name {
    font-weight: 500;
  }
  .res-table td.tm {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 15px;
    text-align: right;
    width: 120px;
  }
  .res-table td.club {
    color: var(--fg-muted);
    font-size: 14px;
  }
  .res-table tr.pend td {
    color: var(--fg-faint);
  }
  /* .new accent-soft for 4s — applied via flashIds prop. */
  .res-table tr.new td {
    background: var(--accent-soft);
    transition: background 0.6s ease-out 3.4s;
  }
  .empty {
    text-align: center;
    padding: 40px;
    color: var(--fg-faint);
  }
</style>
