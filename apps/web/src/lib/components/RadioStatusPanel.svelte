<!--
  Authored for fartola. Not ported from upstream.

  Radio-control status where the readout operator works: one line per radio
  control with OK / Få stämplingar / Tyst as text plus a symbol, a date
  warning when ROC rows carry another date, and "senast hörd". Shown only
  while ROC input is on. Polls the edge every 10 s; the watchdog itself lives
  server-side (integrations/roc/watchdog.ts). A speaker view is a later task.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from '#lib/i18n/index.ts';
  import { getRadioStatus } from '#lib/api/client.ts';
  import type { RadioStatus } from '@fartola/shared-types';
  import { baselineKey, rocLinkProblem, sortedRadioViews } from '#lib/screens/radio-status.ts';

  interface Props {
    competitionId: string;
  }

  let { competitionId }: Props = $props();

  const POLL_MS = 10_000;
  let status = $state<RadioStatus | null>(null);
  let failed = $state(false);

  async function load(): Promise<void> {
    try {
      status = await getRadioStatus(competitionId);
      failed = false;
    } catch {
      failed = true;
    }
  }

  $effect(() => {
    void competitionId;
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  });

  onDestroy(() => {
    status = null;
  });

  const views = $derived(status ? sortedRadioViews(status) : []);
  const baseline = $derived(status ? baselineKey(status) : null);
  const linkProblem = $derived(status ? rocLinkProblem(status) : null);
</script>

{#if status?.settings.enabled}
  <section class="radio" data-testid="radio-panel" aria-label={t('radio.title')}>
    <header class="head">
      <h3>{t('radio.title')}</h3>
      <span class="muted">
        {#if linkProblem}
          <span data-testid="radio-link-problem">✕ {t('radio.linkProblem')}</span>
        {:else if failed}
          <span>✕ {t('radio.loadError')}</span>
        {:else}
          <span>✓ {t('radio.linkOk')}</span>
        {/if}
      </span>
    </header>
    {#if baseline}
      <p class="baseline muted" data-testid="radio-baseline">
        {t(baseline.key, { id: baseline.id })}
      </p>
    {/if}
    {#if views.length === 0}
      <p class="empty">{t('radio.none')}</p>
    {:else}
      <ul>
        {#each views as v (v.code)}
          <li data-testid="radio-control" data-state={v.state} data-code={v.code}>
            <span class="code mono">{v.code}</span>
            <span class="state">
              <span aria-hidden="true">{v.symbol}</span>
              {t(v.labelKey)}
            </span>
            {#if v.dateWarnings > 0}
              <span class="state" data-testid="radio-date-warning">
                <span aria-hidden="true">!</span>
                {t('radio.dateWarning', { n: v.dateWarnings })}
              </span>
            {/if}
            {#if v.siacProblem}
              <span class="state" data-testid="radio-siac-problem">
                <span aria-hidden="true">!</span>
                {t('radio.siacProblem')}
              </span>
            {/if}
            <span class="when muted">
              {#if v.lastHeard === null}
                {t('radio.neverHeard')}
              {:else}
                {t('radio.lastHeard', { time: v.lastHeard, min: v.agoMin })}
              {/if}
              {#if v.delayText}
                · {t('radio.delay', { text: v.delayText })}
              {/if}
              {#if v.coverageText}
                · {t('radio.coverage', { text: v.coverageText })}
              {/if}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .radio {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    font-size: 16px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  h3 {
    margin: 0;
    font-size: var(--fs-label);
    font-weight: 600;
  }
  .muted {
    color: var(--fg-muted);
  }
  .baseline {
    margin: 0;
    padding: 8px 16px;
    font-size: 14px;
    border-bottom: 1px solid var(--border);
  }
  .empty {
    margin: 0;
    padding: 12px 16px;
    color: var(--fg-muted);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 12px;
    padding: 10px 16px;
    min-height: 44px;
    border-bottom: 1px solid var(--border);
    border-left: 4px solid var(--ok);
  }
  li[data-state='few'] {
    border-left-color: var(--mp);
  }
  li[data-state='silent'] {
    border-left-color: var(--dnf);
  }
  .code {
    font-weight: 700;
    min-width: 3ch;
  }
  .state {
    font-weight: 600;
  }
  .when {
    flex-basis: 100%;
    font-size: 14px;
  }
</style>
