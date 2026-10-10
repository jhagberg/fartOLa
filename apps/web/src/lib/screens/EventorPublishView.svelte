<!--
  Authored for fartola. Not ported from upstream.

  Eventor publish view — two-button layout for pushing IOF XML 3.0
  ResultList and StartList to Eventor's REST import endpoints.
  Follows ExportView trigger-button → async call → result/error pattern.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { formatClockTime } from '@fartola/shared-types';
  import { postEventorPushResults, postEventorPushStartlist, ApiError } from '#lib/api/client.ts';
  import { t } from '#lib/i18n/index.ts';
  import EventorKeyLink from '#lib/components/EventorKeyLink.svelte';
  import { fetchCompetitionClock } from '#lib/screens/competition-clock.ts';
  import Button from '#lib/ui/Button.svelte';
  import Icon from '#lib/ui/Icon.svelte';

  interface Props {
    competitionId: string;
  }

  let { competitionId }: Props = $props();

  type Kind = 'results' | 'startlist';
  interface Last {
    at: number;
    url: string;
  }
  interface Push {
    pushing: boolean;
    url: string | null;
    error: string | null;
    detail: string | null;
    noKey: boolean;
    last: Last | null;
  }

  const blank = (): Push => ({
    pushing: false,
    url: null,
    error: null,
    detail: null,
    noKey: false,
    last: null,
  });
  let pushes = $state<Record<Kind, Push>>({ results: blank(), startlist: blank() });
  let offsetMin = $state<number | null>(null);

  const storageKey = (kind: Kind): string => `fartola-eventor-${competitionId}-${kind}`;

  function readLast(kind: Kind): Last | null {
    try {
      const raw = localStorage.getItem(storageKey(kind));
      if (raw === null) return null;
      const v = JSON.parse(raw) as Partial<Last>;
      return typeof v.at === 'number' && typeof v.url === 'string' ? { at: v.at, url: v.url } : null;
    } catch {
      return null;
    }
  }

  onMount(() => {
    pushes.results.last = readLast('results');
    pushes.startlist.last = readLast('startlist');
    // The competition clock; until it arrives the local time is shown.
    void fetchCompetitionClock(competitionId)
      .then((c) => (offsetMin = c.offsetMin))
      .catch(() => {});
  });

  function lastTime(at: number): string {
    if (offsetMin !== null) return formatClockTime(at, offsetMin).slice(0, 5);
    return new Date(at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }

  async function push(kind: Kind): Promise<void> {
    const s = pushes[kind];
    s.pushing = true;
    s.url = null;
    s.error = null;
    s.detail = null;
    s.noKey = false;
    try {
      const res = await (kind === 'results'
        ? postEventorPushResults(competitionId)
        : postEventorPushStartlist(competitionId));
      s.url = res.url;
      s.last = { at: Date.now(), url: res.url };
      try {
        localStorage.setItem(storageKey(kind), JSON.stringify(s.last));
      } catch {
        // Storage can be blocked; the page still works without it.
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        s.error = t('eventor.publish.noKey');
        s.noKey = true;
      } else {
        s.error = t('eventor.publish.error');
        s.detail = err instanceof Error ? err.message : String(err);
      }
    } finally {
      s.pushing = false;
    }
  }
</script>

{#snippet section(kind: Kind, variant: 'primary' | 'secondary')}
  {@const s = pushes[kind]}
  <section class="sec" data-testid="eventor-publish-{kind}">
    <h2 class="h1">{t(`eventor.publish.${kind}.heading`)}</h2>
    <p class="muted">{t(`eventor.publish.${kind}.desc`)}</p>
    <Button {variant} disabled={s.pushing} onclick={() => push(kind)}>
      {s.pushing ? t('eventor.publish.pushing') : t(`eventor.publish.${kind}`)}
    </Button>
    {#if s.last}
      <p class="muted" data-testid="eventor-{kind}-last">
        {t('eventor.publish.last', { time: lastTime(s.last.at) })}
      </p>
    {/if}
    {#if s.url}
      <div class="box ok" data-testid="eventor-{kind}-ok">
        <strong>{t('eventor.publish.success')}</strong>
        <a href={s.url} target="_blank" rel="noopener">{s.url}</a>
      </div>
    {/if}
    {#if s.error}
      <div class="box err" data-testid="eventor-{kind}-err">
        <strong><Icon name="alert-triangle" size={18} /> {t('eventor.publish.errorLabel')}</strong>
        {s.error}
        {#if s.noKey}<EventorKeyLink />{/if}
        {#if s.detail}
          <details>
            <summary>{t('export.details')}</summary>
            <p>{s.detail}</p>
          </details>
        {/if}
      </div>
    {/if}
  </section>
{/snippet}

<div class="publish" data-testid="eventor-publish-view">
  <header class="hd">
    <h1 class="h0">{t('eventor.publish.title')}</h1>
  </header>

  {@render section('results', 'primary')}
  {@render section('startlist', 'secondary')}
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
    align-items: flex-start;
    gap: 8px;
  }
  .sec > :global(.box) {
    align-self: stretch;
  }
  .h0 {
    margin: 0;
    font-size: var(--fs-display);
    font-weight: 600;
  }
  .h1 {
    margin: 0;
    font-size: var(--fs-heading);
    font-weight: 600;
  }
  .muted {
    margin: 0;
    color: var(--fg-muted);
  }
  .box {
    border-radius: var(--radius);
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
    display: flex;
    align-items: center;
    min-height: var(--hit);
    overflow-wrap: anywhere;
  }
  .box.err {
    border: 1px solid var(--dnf);
    background: var(--dnf-soft);
    color: var(--fg);
  }
  .box summary {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: var(--hit);
    cursor: pointer;
  }
  /* display: flex drops the native marker; draw it back. */
  .box summary::before {
    content: '\25B8' / '';
  }
  .box details[open] > summary::before {
    content: '\25BE' / '';
  }
  .box details p {
    overflow-wrap: anywhere;
  }
</style>
