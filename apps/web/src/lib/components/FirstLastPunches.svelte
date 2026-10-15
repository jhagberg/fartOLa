<!--
  Authored for fartola. Not ported from upstream.

  ADR-0019 step 2: a SIAC punched at the start or finish more than once
  keeps the first punch next to the last. Where they differ, the read-out
  card and the edit dialog show both, and mark the last when the result uses
  it (today's rule). Nothing renders without lines.
-->
<script lang="ts">
  import { t } from '#lib/i18n/index.ts';
  import type { FirstLastLine } from '#lib/screens/readout-types.ts';

  let { lines }: { lines: FirstLastLine[] } = $props();

  const label = {
    start: ['ro.firstLast.firstStart', 'ro.firstLast.lastStart'],
    finish: ['ro.firstLast.firstFinish', 'ro.firstLast.lastFinish'],
  } as const;
</script>

{#if lines.length > 0}
  <ul class="first-last" data-testid="first-last">
    {#each lines as line (line.kind)}
      <li data-testid="first-last-{line.kind}">
        <span>{t(label[line.kind][0])} <b class="mono">{line.first}</b></span>
        <span
          >{t(label[line.kind][1])} <b class="mono">{line.last}</b>
          {#if line.lastUsed}({t('ro.firstLast.used')}){/if}</span
        >
      </li>
    {/each}
  </ul>
{/if}

<style>
  .first-last {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 14px;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
  }
</style>
