<!--
  Authored for fartola. Not ported from upstream.

  "Saknade starttider" (02.1-14 Task 15): every runner whose read-out had no
  start, with check time, suggested start (check + the day's median
  check → start gap, editable) and the resulting time. "Sätt" sets one row,
  "Sätt alla" every row, in one all-or-nothing batch. Shown on the results
  view outside fullscreen, only while there are such runners. Logic lives
  in screens/missing-starts.ts.
-->
<script lang="ts">
  import { t } from '#lib/i18n/index.ts';
  import Button from '#lib/ui/Button.svelte';
  import LoadError from '#lib/ui/LoadError.svelte';
  import { listMissingStarts } from '#lib/api/client.ts';
  import { formatElapsed } from '#lib/screens/readout-types.ts';
  import {
    applyMissingStartRows,
    initialStartText,
    resultingTimeMs,
    clockText,
    statsLabel,
    type MissingStartItem,
    type MissingStartsResponse,
  } from '#lib/screens/missing-starts.ts';

  interface Props {
    competitionId: string;
    /** Bumped by the parent when results change, to refetch. */
    refreshKey?: number | null;
  }

  let { competitionId, refreshKey = null }: Props = $props();

  let data = $state<MissingStartsResponse | null>(null);
  let texts = $state<Record<string, string>>({});
  /** A failed apply (shown above the table). */
  let error = $state<string | null>(null);
  /** The first or a refresh load failed. */
  let loadFailed = $state(false);
  let busy = $state(false);
  /** How many start times the last apply set. */
  let done = $state<number | null>(null);
  let loadSeq = 0;

  /** A retry clears the error first; a refresh keeps it until a load works,
   * so live results do not tear down the retry button under the operator. */
  async function load(clearDone = true, retry = false): Promise<void> {
    const seq = ++loadSeq;
    if (retry) loadFailed = false;
    try {
      const next = await listMissingStarts(competitionId);
      // Keep what the operator typed for runners still listed.
      const nextTexts: Record<string, string> = {};
      for (const item of next.items) {
        nextTexts[item.competitor_id] =
          texts[item.competitor_id] ?? initialStartText(item, next.clock_offset_min);
      }
      if (seq !== loadSeq) return;
      texts = nextTexts;
      data = next;
      loadFailed = false;
      // A later load with runners listed is a new situation: the old result line goes.
      if (clearDone && next.items.length > 0) done = null;
    } catch {
      if (seq !== loadSeq) return;
      loadFailed = true;
    }
  }

  // Loads on mount and again whenever the parent bumps refreshKey.
  $effect(() => {
    void refreshKey;
    void load();
  });

  async function apply(items: MissingStartItem[], clockOffsetMin: number): Promise<void> {
    busy = true;
    error = null;
    done = null;
    try {
      const res = await applyMissingStartRows(
        competitionId,
        items.map((item) => ({ item, text: texts[item.competitor_id] ?? '' })),
        clockOffsetMin
      );
      if (!res.ok) {
        error = t(res.error === 'after_finish' ? 'ms.startAfterFinish' : 'lottning.invalidTime');
        return;
      }
      done = res.updated;
      await load(false);
    } catch (e) {
      console.error('start time save failed:', e);
      error = t('common.unknownError');
    } finally {
      busy = false;
    }
  }

  const header = $derived(data ? statsLabel(data) : null);
</script>

{#if loadFailed}
  <div data-testid="missing-starts-error">
    <LoadError message={t('ms.loadError')} onretry={() => void load(true, true)} />
  </div>
{/if}
{#if done !== null}
  <p class="done" role="status" data-testid="missing-starts-done">{t('ms.done', { count: done })}</p>
{/if}
{#if data && data.items.length > 0}
  <section class="ms" data-testid="missing-starts">
    <header class="ms-head">
      <h2>{t('ms.title')}</h2>
      {#if header}
        <span class="muted mono" data-testid="missing-starts-stats">{t(header.key, header.vars)}</span>
      {/if}
      <span class="set-all">
        <Button
          variant="primary"
          disabled={busy}
          data-testid="missing-starts-set-all"
          onclick={() => data && void apply(data.items, data.clock_offset_min)}
        >
          {busy ? t('ms.setting') : t('ms.setAll', { n: data.items.length })}
        </Button>
      </span>
    </header>
    {#if error}
      <p class="err" role="alert">{error}</p>
    {/if}
    <table class="ms-table">
      <thead>
        <tr>
          <th>{t('ms.name')}</th>
          <th>{t('ms.class')}</th>
          <th>{t('ms.check')}</th>
          <th>{t('ms.suggested')}</th>
          <th>{t('ms.result')}</th>
          <th><span class="sr-only">{t('ms.set')}</span></th>
        </tr>
      </thead>
      <tbody>
        {#each data.items as item (item.competitor_id)}
          <tr data-testid="missing-start-row">
            <td>{item.name}</td>
            <td>{item.class_name}</td>
            <td class="mono">{clockText(item.check_ms, data.clock_offset_min) || '—'}</td>
            <td>
              <input
                type="text"
                class="mono start"
                placeholder="HH:MM:SS"
                aria-label={t('ms.suggested')}
                bind:value={texts[item.competitor_id]}
              />
            </td>
            <td class="mono">
              {item.status === 'OK'
                ? formatElapsed(
                    resultingTimeMs(item, texts[item.competitor_id] ?? '', data.clock_offset_min)
                  )
                : item.status}
            </td>
            <td>
              <Button
                variant="secondary"
                disabled={busy}
                onclick={() => data && void apply([item], data.clock_offset_min)}
              >
                {t('ms.set')}
              </Button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
{/if}

<style>
  .ms {
    display: grid;
    gap: 8px;
  }
  .ms-head {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .ms-head h2 {
    margin: 0;
    font-size: 16px;
  }
  .set-all {
    margin-left: auto;
  }
  .done {
    margin: 0;
    color: var(--fg);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
  }
  .muted {
    color: var(--fg-muted);
  }
  .mono {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum' 1;
  }
  .err {
    color: var(--dnf);
    margin: 0;
  }
  .ms-table {
    width: 100%;
    border-collapse: collapse;
    background: var(--bg-elev);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .ms-table th,
  .ms-table td {
    padding: 8px 12px;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  .ms-table th {
    font-size: var(--fs-label);
    color: var(--fg-muted);
    background: var(--bg-sunken);
  }
  .start {
    width: 10ch;
    height: var(--hit);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    padding: 0 8px;
  }
</style>
