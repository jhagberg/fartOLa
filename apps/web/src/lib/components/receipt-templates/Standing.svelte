<!--
  Authored for fartola. Not ported from upstream.

  Class-standing receipt template. Big-time block + place "X of N
  finished" hero, then a leader-or-behind row, then the regular splits
  table. Used when the operator wants the runner to see how they stack
  up against the class without flipping templates.

  Port of the `if (tpl === 'standing')` branch in
  01-SKETCHES/.../screens-readout.jsx.

  Locked by 01-13-PLAN.md task 1.
-->
<script lang="ts">
  import { t } from '$lib/i18n/index.ts';
  import type { ReceiptTemplateProps } from './types.ts';

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

<div class="hero">
  <div class="hero-time">{read.elapsed}</div>
  <div class="hero-label">{t('rcpt.total')} · {read.statusLabel}</div>
</div>
<div class="rcpt-sep"></div>

{#if read.status === 'OK' && read.place}
  <div class="place-block">
    <div class="place-label">{t('rcpt.place')} {read.cls}</div>
    <div class="place-value">
      {read.place}
      <span class="of">{t('rcpt.of')} {read.progress.finishedInClass} {t('rcpt.finished')}</span>
    </div>
    <div class="starters">
      {read.progress.startersInClass} {t('rcpt.starters')}
    </div>
  </div>
  <div class="rcpt-sep"></div>
  <div class="rcpt-row leader-row">
    <span>{isLeader ? `★ ${t('rcpt.leader')}` : t('rcpt.behind')}</span>
    <span>{isLeader ? '—' : (read.progress.behind ?? '+0:00')}</span>
  </div>
{:else}
  <div class="rcpt-row"><b>Status</b><span>{read.statusLabel}</span></div>
{/if}

<div class="rcpt-sep"></div>
<div class="splits-label">{t('rcpt.controls')}</div>
<table class="splits-rcpt small">
  <tbody>
    {#each read.punches as p, i (i)}
      <tr>
        <td>{i + 1}.</td>
        <td>{p.finish ? 'M' : p.code}</td>
        <td>{p.split}</td>
        <td>{p.time}</td>
      </tr>
    {/each}
  </tbody>
</table>
<div class="rcpt-foot">{t('rcpt.thanks')}</div>

<style>
  .hero {
    text-align: center;
    padding: 4px 0 2px;
  }
  .hero-time {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .hero-label {
    font-size: 11px;
    margin-top: 4px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .place-block {
    text-align: center;
    padding: 6px 0 4px;
  }
  .place-label {
    font-size: 11px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .place-value {
    font-size: 22px;
    font-weight: 700;
    margin-top: 2px;
    line-height: 1;
  }
  .place-value .of {
    font-size: 13px;
    font-weight: 400;
    color: #666;
  }
  .starters {
    font-size: 11px;
    margin-top: 4px;
    color: #666;
  }
  .leader-row {
    font-weight: 600;
  }
  .splits-label {
    font-size: 10px;
    color: #666;
    margin-bottom: 4px;
  }
  .splits-rcpt.small {
    font-size: 10.5px;
  }
</style>
