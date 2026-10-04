<!--
  Authored for fartola. Not ported from upstream.

  Minimal receipt template — name, class/club/card, hero time, place or
  status, optional behind-leader pill, footer. Nothing else.

  Port of the default branch in 01-SKETCHES/.../screens-readout.jsx
  (the `receipt-min` variant after the kids branch).

  Locked by 01-13-PLAN.md task 1.
-->
<script lang="ts">
  import { t } from '$lib/i18n/index.ts';
  import type { ReceiptTemplateProps } from './types.ts';

  let { read }: ReceiptTemplateProps = $props();
  const isLeader = $derived(read.progress.place === 1);
</script>

<div class="rcpt-title">{t('rcpt.title')}</div>
<div class="header">
  <div class="runner-name">{read.name}</div>
  <div class="runner-sub">
    {read.cls}{read.club ? ` · ${read.club}` : ''} · SI {read.cardNumber}
  </div>
</div>
<div class="rcpt-sep"></div>

<div class="hero">
  <div class="hero-time">{read.elapsed}</div>
  <div class="hero-sub">
    {#if read.status === 'OK' && read.place}
      {t('rcpt.place')} <b>{read.place}</b>
      {t('rcpt.of')} {read.progress.finishedInClass} {t('rcpt.finished')}
    {:else}
      <b>{read.statusLabel}</b>
    {/if}
  </div>
  {#if !isLeader && read.status === 'OK' && read.progress.behind}
    <div class="hero-behind">{read.progress.behind} {t('rcpt.behind')}</div>
  {/if}
</div>

<div class="rcpt-sep"></div>
<div class="rcpt-foot">{t('rcpt.thanks')}</div>

<style>
  .header {
    text-align: center;
    padding: 6px 0;
  }
  .runner-name {
    font-size: 15px;
    font-weight: 700;
  }
  .runner-sub {
    font-size: 11px;
    color: #666;
    margin-top: 2px;
  }
  .hero {
    text-align: center;
    padding: 10px 0 4px;
  }
  .hero-time {
    font-size: 34px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.02em;
  }
  .hero-sub {
    margin-top: 6px;
    font-size: 12px;
    color: #666;
  }
  .hero-sub b {
    color: #1a1a1a;
  }
  .hero-behind {
    margin-top: 2px;
    font-size: 11px;
    color: #a64c00;
  }
</style>
