<!--
  Authored for fartola. Not ported from upstream.

  KvarISkovenView — operator safety readout view.

  Purpose: At end-of-race, the operator plugs in the BSF8 check unit,
  clicks "Hämta stämpeldata", and sees who is still in the forest:
    started (from check unit backup) MINUS returned (physical finish read).

  The "returned" set is based ONLY on physical evidence: a card_read event
  with a non-null finish punch. Computed statuses (OK/MP/DNF/DQ/MAX) and
  manual overrides are NOT used — a runner can be marked DNF without being
  physically back at the finish. (GPT+Gemini HIGH review concern resolved.)

  Unknown cards (SI number not in the competitor table) are shown separately
  so the operator can investigate or ignore them.

  Manual "Bekräftad säker" override lets the operator mark a runner safe
  without a finish read (e.g. a DNS who never entered the forest).

  Locked by:
  - .planning/phases/02.1-sanctioned-competition-foundations/02.1-06-PLAN.md task 2
  - REQ-OPS-004
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n/index.ts';
  import { postCheckunitSnapshot, listCompetitors, listClasses } from '$lib/api/client.ts';
  import type { CompetitorDTO, ClassDTO } from '@fartola/shared-types';

  interface Props {
    competitionId: string;
  }

  let { competitionId }: Props = $props();

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** Card numbers from the check unit (started). */
  let startedCards = $state<number[]>([]);
  /** Card numbers that physically returned (finish punch). */
  let returnedCards = $state<Set<number>>(new Set());
  /** Whether memory wrapped around (may be missing some records). */
  let overflow = $state(false);
  /** Competitors in this competition (for name/club/class lookup). */
  let competitors = $state<CompetitorDTO[]>([]);
  /** Classes map for class name lookup. */
  let classesMap = $state<Map<string, string>>(new Map());
  /** Card numbers the operator has manually confirmed safe. */
  let confirmedSafe = $state<Set<number>>(new Set());
  /** Whether a snapshot has been fetched at least once. */
  let hasFetched = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let copySuccess = $state(false);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  /** Build lookup: card_number → CompetitorDTO */
  const competitorByCard = $derived.by(() => {
    const m = new Map<number, CompetitorDTO>();
    for (const c of competitors) {
      if (c.card_number != null) m.set(c.card_number, c);
    }
    return m;
  });

  /** Diff: started but not returned and not confirmed safe. */
  const missingCards = $derived(
    startedCards.filter((cn) => !returnedCards.has(cn) && !confirmedSafe.has(cn))
  );

  /** Known competitors still in forest (have a competitor record). */
  const missingKnown = $derived(
    missingCards
      .map((cn) => competitorByCard.get(cn))
      .filter((c): c is CompetitorDTO => c !== undefined)
  );

  /** Unknown card numbers still in forest (not in competitor table). */
  const missingUnknownCards = $derived(
    missingCards.filter((cn) => !competitorByCard.has(cn))
  );

  /** Safety-call summary string. */
  const safetySummary = $derived.by(() => {
    const names = missingKnown.map((c) => c.name);
    if (missingUnknownCards.length > 0) {
      names.push(...missingUnknownCards.map((cn) => `#${cn}`));
    }
    if (names.length === 0) return '';
    return t('kvariskov.safetySummary', { names: names.join(', ') });
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function className(classId: string): string {
    return classesMap.get(classId) ?? classId;
  }

  function formatTime(ms: number | null | undefined): string {
    if (ms == null) return '—';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  /** Elapsed since start_time_ms. Handles midnight wrap. */
  function elapsed(startMs: number | null | undefined): string {
    if (startMs == null) return '—';
    const now = Date.now();
    const diffMs = ((now - startMs) % 86400000 + 86400000) % 86400000;
    return formatTime(diffMs);
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function fetchSnapshot(): Promise<void> {
    loading = true;
    error = null;
    try {
      const result = await postCheckunitSnapshot(competitionId);
      startedCards = result.cardNumbers;
      returnedCards = new Set(result.returnedCardNumbers ?? []);
      overflow = result.overflow;
      hasFetched = true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  async function loadCompetitors(): Promise<void> {
    try {
      const res = await listCompetitors(competitionId);
      competitors = res.competitors ?? [];
    } catch {
      // Non-fatal — the view degrades gracefully without competitor names.
    }
  }

  async function loadClasses(): Promise<void> {
    try {
      const res = await listClasses(competitionId);
      const m = new Map<string, string>();
      for (const cls of res.classes ?? []) {
        m.set(cls.id, cls.name);
      }
      classesMap = m;
    } catch {
      // Non-fatal.
    }
  }

  function markSafe(cardNumber: number): void {
    const next = new Set(confirmedSafe);
    next.add(cardNumber);
    confirmedSafe = next;
  }

  async function copyToClipboard(): Promise<void> {
    if (!safetySummary) return;
    try {
      await navigator.clipboard.writeText(safetySummary);
      copySuccess = true;
      setTimeout(() => {
        copySuccess = false;
      }, 2000);
    } catch {
      // Clipboard unavailable — silently ignore.
    }
  }

  onMount(() => {
    void loadCompetitors();
    void loadClasses();
  });
</script>

<div class="kvar" data-testid="kvariskov-view">
  <header class="hd">
    <h1 class="h0">{t('kvariskov.title')}</h1>
    <p class="muted">{t('kvariskov.hint')}</p>
  </header>

  <!-- Fetch button -->
  <section class="sec">
    <button class="btn primary" onclick={() => void fetchSnapshot()} disabled={loading}>
      {#if loading}
        {t('kvariskov.fetching')}
      {:else}
        {t('kvariskov.fetch')}
      {/if}
    </button>
    {#if error !== null}
      <div class="box err" data-testid="kvariskov-error">
        <strong>{error}</strong>
      </div>
    {/if}
    {#if overflow}
      <div class="box warn" data-testid="kvariskov-overflow">
        {t('kvariskov.overflow')}
      </div>
    {/if}
  </section>

  {#if hasFetched}
    <!-- Summary banner -->
    <section class="sec summary-banner" data-testid="kvariskov-summary">
      <div class="count-badge" class:urgent={missingCards.length > 0}>
        {t('kvariskov.result', { count: missingCards.length })}
      </div>
      {#if safetySummary}
        <p class="summary-text" data-testid="kvariskov-summary-text">{safetySummary}</p>
        <button
          class="btn secondary"
          onclick={() => void copyToClipboard()}
          data-testid="kvariskov-copy"
        >
          {#if copySuccess}
            {t('kvariskov.copied')}
          {:else}
            {t('kvariskov.copyClipboard')}
          {/if}
        </button>
      {/if}
    </section>

    <!-- Missing runners table -->
    {#if missingKnown.length > 0}
      <section class="sec" data-testid="kvariskov-missing-table">
        <h2 class="h1">{t('kvariskov.missing')} — {t('kvariskov.started')}</h2>
        <table class="tbl">
          <thead>
            <tr>
              <th>{t('kvariskov.name')}</th>
              <th>{t('kvariskov.club')}</th>
              <th>{t('kvariskov.class')}</th>
              <th>{t('kvariskov.startTime')}</th>
              <th>{t('kvariskov.elapsed')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each missingKnown as competitor (competitor.id)}
              <tr data-testid="kvariskov-row">
                <td class="name">{competitor.name}</td>
                <td>{competitor.club ?? '—'}</td>
                <td>{className(competitor.class_id)}</td>
                <td>{formatTime(competitor.start_time_ms)}</td>
                <td>{elapsed(competitor.start_time_ms)}</td>
                <td>
                  <button
                    class="btn xs"
                    onclick={() => markSafe(competitor.card_number!)}
                    data-testid="kvariskov-mark-safe"
                  >
                    {t('kvariskov.markSafe')}
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>
    {/if}

    <!-- Unknown cards section -->
    {#if missingUnknownCards.length > 0}
      <section class="sec" data-testid="kvariskov-unknown">
        <h2 class="h1">{t('kvariskov.unknownCards')}</h2>
        <ul class="card-list">
          {#each missingUnknownCards as cn (cn)}
            <li>
              #{cn}
              <button
                class="btn xs"
                onclick={() => markSafe(cn)}
                data-testid="kvariskov-mark-unknown-safe"
              >
                {t('kvariskov.markSafe')}
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if missingCards.length === 0}
      <div class="box ok" data-testid="kvariskov-all-returned">
        <strong>Alla löpare har återkommit.</strong>
      </div>
    {/if}
  {/if}
</div>

<style>
  .kvar {
    display: flex;
    flex-direction: column;
    gap: 24px;
    max-width: 800px;
  }
  .hd .muted {
    margin-top: 4px;
    color: var(--fg-muted);
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
  .sec {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 10px 20px;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    width: max-content;
  }
  .btn.primary {
    background: var(--accent);
    color: var(--accent-fg);
  }
  .btn.secondary {
    background: var(--bg-elev);
    color: var(--fg);
    border: 1px solid var(--border);
  }
  .btn.xs {
    padding: 4px 10px;
    font-size: 12px;
    background: var(--bg-elev);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .box {
    border-radius: 8px;
    padding: 12px 16px;
  }
  .box.err {
    background: color-mix(in srgb, var(--err) 12%, transparent);
    border: 1px solid var(--err);
  }
  .box.warn {
    background: color-mix(in srgb, var(--warn, orange) 12%, transparent);
    border: 1px solid var(--warn, orange);
  }
  .box.ok {
    background: color-mix(in srgb, var(--ok) 12%, transparent);
    border: 1px solid var(--ok);
  }
  .summary-banner {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    gap: 12px;
  }
  .count-badge {
    font-size: 20px;
    font-weight: 700;
  }
  .count-badge.urgent {
    color: var(--err);
  }
  .summary-text {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--fg-muted);
    word-break: break-all;
    margin: 0;
  }
  .tbl {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  .tbl th {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 2px solid var(--border);
    font-weight: 600;
    color: var(--fg-muted);
  }
  .tbl td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  .tbl tr:last-child td {
    border-bottom: none;
  }
  .name {
    font-weight: 500;
  }
  .card-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .card-list li {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: var(--font-mono);
  }
</style>
