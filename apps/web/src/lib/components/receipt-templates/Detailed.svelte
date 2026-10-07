<!--
  Authored for fartola. Not ported from upstream.

  Detailed receipt template — MeOS-OZ style per-leg breakdown with
  per-leg rank (`Pl`) and time-lost (`+/−`) columns.

  Port of the `if (tpl === 'detailed')` branch in
  01-SKETCHES/.../screens-readout.jsx.

  Phase 1 reality: `legRank` and `lost` are nullable in the projection
  pipeline (not computed until plan 15+ if at all). The template tolerates
  null by rendering an em-dash; we keep the columns in place so the
  template's visual identity holds for the operator preview.

  Locked by 01-13-PLAN.md task 1.
-->
<script lang="ts">
  import { t } from '#lib/i18n/index.ts';
  import type { ReceiptTemplateProps } from './types.ts';
  import PunchCode from './PunchCode.svelte';
  import { punchNo } from './punchLabels.ts';

  let { read }: ReceiptTemplateProps = $props();
  const isLeader = $derived(read.progress.place === 1);
</script>

<div class="rcpt-title">{t('rcpt.title')}</div>
<div class="rcpt-row">
  <span>{read.competitionName}</span><span>{read.competitionDate}</span>
</div>
<div class="rcpt-row">
  <b>{read.name}</b><span>{read.cardNumber}</span>
</div>
<div class="rcpt-row">
  <span>{read.cls}{read.club ? ` · ${read.club}` : ''}</span>
  <span>{read.startTime}</span>
</div>
<div class="rcpt-sep"></div>

<table class="splits-rcpt splits-detailed">
  <thead>
    <tr class="head">
      <td>#</td>
      <td>Kod</td>
      <td class="r">Sträcka</td>
      <td class="r">Pl</td>
      <td class="r">+/−</td>
    </tr>
  </thead>
  <tbody>
    {#each read.punches as p, i (i)}
      <tr class:finish={p.finish}>
        <td>{punchNo(read.punches, i)}</td>
        <td><PunchCode {p} /></td>
        <td class="r">{p.split}</td>
        <td class="r" class:best={p.legRank === 1}>{p.legRank ?? '—'}</td>
        <td class="r" class:loss={p.lost && p.lost !== '+0:00'}>{p.lost ?? '—'}</td>
      </tr>
    {/each}
  </tbody>
</table>

<div class="rcpt-sep"></div>
<div class="rcpt-row rcpt-total">
  <span>{t('rcpt.total')}</span><span>{read.elapsed} {read.statusLabel}</span>
</div>
{#if read.place}
  <div class="rcpt-row">
    <span>{t('rcpt.place')}</span>
    <b>{read.place} {t('rcpt.of')} {read.progress.finishedInClass} {t('rcpt.finished')}</b>
  </div>
  <div class="rcpt-row">
    <span>{isLeader ? t('rcpt.leader') : t('rcpt.behind')}</span>
    <b>{isLeader ? '—' : (read.progress.behind ?? '+0:00')}</b>
  </div>
{/if}
<div class="rcpt-foot">{t('rcpt.thanks')}</div>

<style>
  .splits-detailed :global(td) {
    padding: 1.5px 0;
  }
  .splits-detailed thead .head {
    font-size: 9px;
    color: #666;
  }
  .splits-detailed thead .head td {
    border-bottom: 1px dashed #888;
    padding-bottom: 3px;
  }
  .splits-detailed tr.finish td {
    font-weight: 700;
  }
  .splits-detailed td.r {
    text-align: right;
  }
  .splits-detailed td.best {
    color: #0a7a2a;
  }
  .splits-detailed td.loss {
    color: #a64c00;
  }
  /* Override the shared widths for the 5-column detailed layout. */
  .splits-detailed td:nth-child(1) {
    width: 22px;
  }
  .splits-detailed td:nth-child(2) {
    width: 30px;
  }
  .splits-detailed td:nth-child(3) {
    width: auto;
  }
  .splits-detailed td:nth-child(4) {
    width: 26px;
  }
  .splits-detailed td:nth-child(5) {
    width: 42px;
  }
</style>
