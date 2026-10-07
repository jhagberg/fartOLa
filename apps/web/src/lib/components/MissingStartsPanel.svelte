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
  let error = $state<string | null>(null);
  let busy = $state(false);

  async function load(): Promise<void> {
    try {
      const next = await listMissingStarts(competitionId);
      // Keep what the operator typed for runners still listed.
      const nextTexts: Record<string, string> = {};
      for (const item of next.items) {
        nextTexts[item.competitor_id] =
          texts[item.competitor_id] ?? initialStartText(item, next.clock_offset_min);
      }
      texts = nextTexts;
      data = next;
    } catch (e) {
      error = (e as Error).message;
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
      await load();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  const header = $derived(data ? statsLabel(data) : null);
</script>

{#if data && data.items.length > 0}
  <section class="ms" data-testid="missing-starts">
    <header class="ms-head">
      <h2>{t('ms.title')}</h2>
      {#if header}
        <span class="muted mono" data-testid="missing-starts-stats">{t(header.key, header.vars)}</span>
      {/if}
      <button
        type="button"
        class="btn primary"
        disabled={busy}
        data-testid="missing-starts-set-all"
        onclick={() => data && void apply(data.items, data.clock_offset_min)}
      >
        {t('ms.setAll')}
      </button>
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
          <th></th>
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
              <button
                type="button"
                class="btn"
                disabled={busy}
                onclick={() => data && void apply([item], data.clock_offset_min)}
              >
                {t('ms.set')}
              </button>
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
  .ms-head .btn {
    margin-left: auto;
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
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
    background: var(--bg-sunken);
  }
  .start {
    width: 10ch;
    height: 32px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    padding: 0 8px;
  }
  .btn {
    height: 32px;
    padding: 0 12px;
    border-radius: var(--radius);
    border: 1px solid var(--border-strong);
    background: var(--bg-elev);
    color: var(--fg);
    font-weight: 600;
    cursor: pointer;
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-fg);
  }
  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
