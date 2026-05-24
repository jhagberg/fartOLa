<!--
  Authored for fartola. Not ported from upstream.

  Eventor publish view — two-button layout for pushing IOF XML 3.0
  ResultList and StartList to Eventor's REST import endpoints.
  Follows ExportView trigger-button → async call → result/error pattern.
-->
<script lang="ts">
  import { postEventorPushResults, postEventorPushStartlist, ApiError } from '$lib/api/client.ts';
  import { t } from '$lib/i18n/index.ts';

  interface Props {
    competitionId: string;
  }

  let { competitionId }: Props = $props();

  let resultsPushing = $state(false);
  let resultsUrl = $state<string | null>(null);
  let resultsError = $state<string | null>(null);

  let startlistPushing = $state(false);
  let startlistUrl = $state<string | null>(null);
  let startlistError = $state<string | null>(null);

  async function pushResults(): Promise<void> {
    resultsPushing = true;
    resultsUrl = null;
    resultsError = null;
    try {
      const res = await postEventorPushResults(competitionId);
      resultsUrl = res.url;
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        resultsError = t('eventor.publish.noKey');
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        resultsError = t('eventor.publish.error', { message: msg });
      }
    } finally {
      resultsPushing = false;
    }
  }

  async function pushStartlist(): Promise<void> {
    startlistPushing = true;
    startlistUrl = null;
    startlistError = null;
    try {
      const res = await postEventorPushStartlist(competitionId);
      startlistUrl = res.url;
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        startlistError = t('eventor.publish.noKey');
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        startlistError = t('eventor.publish.error', { message: msg });
      }
    } finally {
      startlistPushing = false;
    }
  }
</script>

<div class="publish" data-testid="eventor-publish-view">
  <header class="hd">
    <h1 class="h0">{t('eventor.publish.title')}</h1>
  </header>

  <section class="sec" data-testid="eventor-publish-results">
    <h2 class="h1">{t('eventor.publish.results')}</h2>
    <p class="muted">{t('eventor.publish.results.desc')}</p>
    <button class="btn primary" disabled={resultsPushing} onclick={pushResults}>
      {#if resultsPushing}
        {t('eventor.publish.pushing')}
      {:else}
        {t('eventor.publish.results')}
      {/if}
    </button>
    {#if resultsUrl}
      <div class="box ok" data-testid="eventor-results-ok">
        <strong>{t('eventor.publish.success')}</strong>
        <a href={resultsUrl} target="_blank" rel="noopener">{resultsUrl}</a>
      </div>
    {/if}
    {#if resultsError}
      <div class="box err" data-testid="eventor-results-err">
        {resultsError}
      </div>
    {/if}
  </section>

  <section class="sec" data-testid="eventor-publish-startlist">
    <h2 class="h1">{t('eventor.publish.startlist')}</h2>
    <p class="muted">{t('eventor.publish.startlist.desc')}</p>
    <button class="btn primary" disabled={startlistPushing} onclick={pushStartlist}>
      {#if startlistPushing}
        {t('eventor.publish.pushing')}
      {:else}
        {t('eventor.publish.startlist')}
      {/if}
    </button>
    {#if startlistUrl}
      <div class="box ok" data-testid="eventor-startlist-ok">
        <strong>{t('eventor.publish.success')}</strong>
        <a href={startlistUrl} target="_blank" rel="noopener">{startlistUrl}</a>
      </div>
    {/if}
    {#if startlistError}
      <div class="box err" data-testid="eventor-startlist-err">
        {startlistError}
      </div>
    {/if}
  </section>
</div>

<style>
  .publish {
    display: flex;
    flex-direction: column;
    gap: 24px;
    max-width: 720px;
  }
  .sec {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .h0 {
    margin: 0;
    font-size: 28px;
    font-weight: 600;
  }
  .h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }
  .muted {
    color: var(--fg-muted);
  }
  .box {
    border-radius: 8px;
    padding: 12px 16px;
  }
  .box.ok {
    background: color-mix(in srgb, var(--ok) 12%, transparent);
    border: 1px solid var(--ok);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .box.ok a {
    color: var(--ok);
    word-break: break-all;
  }
  .box.err {
    background: color-mix(in srgb, var(--err) 12%, transparent);
    border: 1px solid var(--err);
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 10px 20px;
    border-radius: 8px;
    background: var(--accent);
    color: var(--accent-fg);
    font-weight: 600;
    border: none;
    cursor: pointer;
    width: max-content;
  }
  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
