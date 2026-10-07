<!--
  Authored for fartola. Not ported from upstream.

  Classic receipt template — default mall per UI-SPEC §"Receipt templates".
  Header rows (event name + date, runner + card, class + club + start),
  then a full controls list (#, code, split, cumulative), then total +
  place + thanks footer.

  Port of the `if (tpl === 'classic')` branch in
  01-SKETCHES/.../screens-readout.jsx (~lines 738-765).

  Locked by:
  - 01-UI-SPEC.md §"Receipt templates" (LOCKED — Klassisk default)
  - 01-13-PLAN.md task 1
-->
<script lang="ts">
  import { t } from '#lib/i18n/index.ts';
  import type { ReceiptTemplateProps } from './types.ts';

  let { read }: ReceiptTemplateProps = $props();
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

<div class="ctrl-head">{t('rcpt.controls')}</div>
<table class="splits-rcpt">
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

<div class="rcpt-sep"></div>
<div class="rcpt-row rcpt-total">
  <span>{t('rcpt.total')}</span><span>{read.elapsed} {read.statusLabel}</span>
</div>
{#if read.place}
  <div class="rcpt-row">
    <span>{t('rcpt.place')} {read.cls}</span><b>{read.place}</b>
  </div>
{/if}
<div class="rcpt-foot">{t('rcpt.thanks')}</div>

<style>
  .ctrl-head {
    font-weight: 700;
    margin-bottom: 4px;
  }
</style>
