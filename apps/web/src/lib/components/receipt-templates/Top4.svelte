<!--
  Authored for fartola. Not ported from upstream.

  Top-4 leaderboard receipt template — runner's row + the top 4 of their
  class. If the runner is NOT in the top 4, an extra "Din placering"
  block is appended below the leaderboard.

  Port of the `if (tpl === 'top4')` branch in
  01-SKETCHES/.../screens-readout.jsx. The sketch reads classResults from
  `window.MOCK_RESULTS`; we lift this to an explicit `classResults` prop
  so the readout view can wire real top-4 data in plan 15 without touching
  the template.

  Locked by 01-13-PLAN.md task 1.
-->
<script lang="ts">
  import { t } from '$lib/i18n/index.ts';
  import type { ReceiptTemplateProps } from './types.ts';

  let { read, classResults = [] }: ReceiptTemplateProps = $props();
  const isLeader = $derived(read.progress.place === 1);
  const top4 = $derived(classResults.slice(0, 4));
  const youInTop4 = $derived(top4.some((r) => r.name === read.name));
  const topTitle = $derived(t('rcpt.top.title').replace('{{cls}}', read.cls));
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

<div class="rcpt-row rcpt-total">
  <span>{t('rcpt.total')}</span><span>{read.elapsed} {read.statusLabel}</span>
</div>
{#if read.place}
  <div class="rcpt-row leader-row">
    <span>{isLeader ? `★ ${t('rcpt.leader')}` : t('rcpt.behind')}</span>
    <span>{isLeader ? '—' : (read.progress.behind ?? '+0:00')}</span>
  </div>
{/if}
<div class="rcpt-sep"></div>

<div class="top-head">{topTitle}</div>
<table class="splits-rcpt top4-tbl">
  <tbody>
    {#if top4.length === 0}
      <tr>
        <td>—</td>
        <td class="nm">{t('rcpt.top.pending')}</td>
        <td class="tm">—</td>
      </tr>
    {:else}
      {#each top4 as r, i (i)}
        {@const isYou = r.name === read.name}
        <tr class:you={isYou}>
          <td>{r.place ?? '—'}</td>
          <td class="nm">{r.name}{isYou ? ' ←' : ''}</td>
          <td class="tm">{r.status === 'PEND' ? t('rcpt.top.pending') : r.time}</td>
        </tr>
      {/each}
    {/if}
  </tbody>
</table>

{#if !youInTop4 && top4.length > 0}
  <div class="rcpt-sep-dot"></div>
  <div class="top-head">{t('rcpt.top.yourow')}</div>
  <table class="splits-rcpt top4-tbl">
    <tbody>
      <tr class="you">
        <td>{read.place ?? '—'}</td>
        <td class="nm">{read.name} ←</td>
        <td class="tm">{read.elapsed}</td>
      </tr>
    </tbody>
  </table>
{/if}
<div class="rcpt-foot">{t('rcpt.thanks')}</div>

<style>
  .top-head {
    font-size: 10px;
    color: #444;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 4px;
    font-weight: 700;
  }
  .leader-row {
    font-size: 10.5px;
    color: #555;
  }
  .top4-tbl :global(td) {
    padding: 3px 2px;
    vertical-align: top;
  }
  .top4-tbl :global(td:nth-child(1)) {
    width: 22px;
    font-weight: 700;
  }
  .top4-tbl :global(td.nm) {
    text-align: left;
  }
  .top4-tbl :global(td.tm) {
    text-align: right;
    width: 56px;
  }
  .top4-tbl :global(tr.you td) {
    background: #fff3c4;
    font-weight: 700;
  }
  .top4-tbl :global(tr.you td:first-child) {
    padding-left: 4px;
  }
  .top4-tbl :global(tr.you td:last-child) {
    padding-right: 4px;
  }
</style>
