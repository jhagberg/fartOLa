<!--
  Authored for fartola. Not ported from upstream.

  SplitsTable — dense-density alt view to the PunchGrid. 4 columns: #,
  code, split (since previous control), cumulative time. Finish row gets
  the accent soft fill.

  Port of the `.splits-table` block in screens-readout.jsx (~lines 76-90).

  Locked by:
  - 01-13-PLAN.md task 2
  - 01-UI-SPEC.md §"Tweaks panel" — density='high' shows this surface
-->
<script lang="ts">
  import { t } from '#lib/i18n/index.ts';
  import type { ReceiptPunch } from './receipt-templates/types.ts';

  interface Props {
    punches: ReceiptPunch[];
  }

  let { punches }: Props = $props();
</script>

<table class="splits-table" data-testid="splits-table">
  <thead>
    <tr>
      <th>#</th>
      <th>{t('ro.code')}</th>
      <th>{t('ro.split')}</th>
      <th>{t('ro.cumul')}</th>
    </tr>
  </thead>
  <tbody>
    {#each punches as p, i (i)}
      <tr class:finish-row={p.finish}>
        <td>{i + 1}</td>
        <td>{p.finish ? 'M (mål)' : p.code}</td>
        <td>{p.split}</td>
        <td>{p.time}</td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .splits-table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: 13px;
  }
  .splits-table th,
  .splits-table td {
    padding: 6px 10px;
    text-align: right;
    border-bottom: 1px solid var(--border);
  }
  .splits-table th {
    font-weight: 500;
    color: var(--fg-muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    text-align: right;
  }
  .splits-table th:first-child,
  .splits-table td:first-child {
    text-align: left;
  }
  .splits-table tr.finish-row td {
    background: var(--accent-soft);
    font-weight: 600;
  }
</style>
