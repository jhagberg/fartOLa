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
  import Button from '#lib/ui/Button.svelte';
  import Icon from '#lib/ui/Icon.svelte';
  import { t } from '#lib/i18n/index.ts';
  import {
    getCompetition,
    postCheckunitSnapshot,
    listCompetitors,
    listClasses,
  } from '#lib/api/client.ts';
  import type { CheckunitSnapshotResult } from '#lib/api/client.ts';
  import type { CompetitorDTO, ClassDTO } from '@fartola/shared-types';
  import { formatClockTime } from '@fartola/shared-types';

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
  /** Where each card was seen (radio, check unit, start read), by card number. */
  let sources = $state<NonNullable<CheckunitSnapshotResult['sources']>>({});
  /** Cards seen by radio or a read but not at the check. */
  let noCheckCards = $state<Set<number>>(new Set());
  /** Cards out by a status set by hand (not a physical return). */
  let handSetCards = $state<Set<number>>(new Set());
  /** Where the check-unit part of the list came from. An older edge omits it: 'read'. */
  let checkunitMode = $state<'read' | 'stored' | 'unavailable'>('read');
  let updated = $state<CheckunitSnapshotResult['updated'] | null>(null);
  /** Whether memory wrapped around (may be missing some records). */
  let overflow = $state(false);
  /** Competitors in this competition (for name/club/class lookup). */
  let competitors = $state<CompetitorDTO[]>([]);
  /** Classes map for class name lookup. */
  let classesMap = $state<Map<string, string>>(new Map());
  /** The competition clock's UTC offset (ADR-0012): start times are shown on it. */
  let clockOffsetMin = $state<number | null>(null);
  /** Card numbers the operator has manually confirmed safe.
   * Persisted to sessionStorage so safety-critical state survives page refresh. */
  let confirmedSafe = $state<Set<number>>((() => {
    try {
      const saved = sessionStorage.getItem(`fartola-safe-${competitionId}`);
      return saved ? new Set(JSON.parse(saved) as number[]) : new Set();
    } catch { return new Set(); }
  })());
  /** Whether a snapshot has been fetched at least once. */
  let hasFetched = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  /** The latest read failed. Cleared only by a successful read, so a retry
   * in flight never brings back the all-clear from an older snapshot. */
  let lastFetchFailed = $state(false);
  let copySuccess = $state(false);
  /** When the last successful fetch finished (epoch ms). */
  let fetchedAt = $state<number | null>(null);
  /** Bumped once a minute so the gångtid column re-renders. */
  let tick = $state(0);

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

  /** Started cards that were physically read out at the finish. */
  const backCards = $derived(startedCards.filter((cn) => returnedCards.has(cn)));

  /** Started cards the operator marked safe without a finish read. */
  const markedCards = $derived(
    startedCards.filter((cn) => !returnedCards.has(cn) && confirmedSafe.has(cn))
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

  /** Elapsed since start_time_ms (epoch ms); 0 before the start. */
  function elapsed(startMs: number | null | undefined): string {
    void tick;
    if (startMs == null) return '—';
    return formatTime(Math.max(0, Date.now() - startMs));
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /** True when the last fetch failed because the check unit was asleep —
   * drives a friendly "dip a card to wake it" callout instead of a raw error. */
  let asleep = $state(false);

  async function fetchSnapshot(): Promise<void> {
    loading = true;
    error = null;
    asleep = false;
    try {
      const result = await postCheckunitSnapshot(competitionId);
      startedCards = result.cardNumbers;
      returnedCards = new Set(result.returnedCardNumbers ?? []);
      sources = result.sources ?? {};
      noCheckCards = new Set(result.noCheckCardNumbers ?? []);
      handSetCards = new Set(result.outCardNumbers ?? []);
      checkunitMode = result.checkunit ?? 'read';
      updated = result.updated ?? null;
      overflow = result.overflow;
      fetchedAt = Date.now();
      hasFetched = true;
      lastFetchFailed = false;
    } catch (err) {
      lastFetchFailed = true;
      // The edge returns { error: 'station_asleep' } (503) when the coupled
      // unit never synced — almost always because it's asleep. Show the
      // localized wake instructions rather than the raw backend message.
      const code = (err as { body?: { error?: string } } | null)?.body?.error;
      if (code === 'station_asleep') {
        asleep = true;
        error = t('kvariskov.asleep');
      } else {
        error = err instanceof Error ? err.message : String(err);
      }
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

  async function loadClock(): Promise<void> {
    try {
      clockOffsetMin = (await getCompetition(competitionId)).competition.clock_offset_min;
    } catch {
      // Non-fatal — start times show as '—'.
    }
  }

  function fetchedText(ms: number): string {
    if (clockOffsetMin !== null) return formatClockTime(ms, clockOffsetMin).slice(0, 5);
    return new Date(ms).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }

  function sourceLabels(cn: number): string[] {
    const list = sources[String(cn)];
    // No entry: the card is only in the check-unit read (the edge lists
    // sources for every card seen by radio, a start read or the check unit
    // in the same list, but an older edge sends none).
    if (list === undefined) return [t('kvariskov.seenCheckunit')];
    return list.map((src) =>
      src.kind === 'radio'
        ? t('kvariskov.seenRadio', { code: src.code })
        : src.kind === 'read'
          ? t('kvariskov.seenRead')
          : t('kvariskov.seenCheckunit')
    );
  }

  /** A status set by hand is not a physical return: the card stays missing. */
  function isHandSet(cn: number): boolean {
    return handSetCards.has(cn) && !returnedCards.has(cn);
  }

  const checkunitReadAtMs = $derived(updated?.checkunit_read_at_ms ?? null);
  /** With a stored, missing or wrapped check-unit read, zero missing is never an all-clear. */
  const softClear = $derived(checkunitMode !== 'read' || overflow);

  /** The empty-read hint is about a fresh check-unit read only. */
  const showEmptyRead = $derived(startedCards.length === 0 && checkunitMode === 'read');
  const showCount = $derived(
    startedCards.length > 0 &&
      !loading &&
      !lastFetchFailed &&
      !(softClear && missingCards.length === 0)
  );

  function startText(ms: number | null): string {
    return ms == null || clockOffsetMin === null ? '—' : formatClockTime(ms, clockOffsetMin);
  }

  function markSafe(cardNumber: number): void {
    const next = new Set(confirmedSafe);
    next.add(cardNumber);
    confirmedSafe = next;
    try { sessionStorage.setItem(`fartola-safe-${competitionId}`, JSON.stringify([...next])); } catch {}
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

  $effect(() => {
    const timer = setInterval(() => {
      tick += 1;
    }, 60_000);
    return () => clearInterval(timer);
  });

  onMount(() => {
    void loadCompetitors();
    void loadClasses();
    void loadClock();
  });
</script>

{#snippet seenTags(cn: number)}
  <span class="tags">
    {#each sourceLabels(cn) as label, i (i)}
      <span class="tag" data-testid="kvariskov-seen">{label}</span>
    {/each}
    {#if noCheckCards.has(cn)}
      <span class="tag warn" data-testid="kvariskov-no-check"
        ><Icon name="alert-triangle" size={14} /> {t('kvariskov.noCheck')}</span
      >
    {/if}
    {#if isHandSet(cn)}
      <span class="tag warn" data-testid="kvariskov-hand-set"
        ><Icon name="edit" size={14} /> {t('kvariskov.handSet')}</span
      >
    {/if}
  </span>
{/snippet}

<div class="kvar" data-testid="kvariskov-view">
  <header class="hd">
    <h1 class="h0">{t('kvariskov.title')}</h1>
    <p class="muted">{t('kvariskov.hint')}</p>
  </header>

  <!-- How-to instructions (always visible — the wake step is easy to forget) -->
  <section class="sec box info" data-testid="kvariskov-instructions">
    <strong>{t('kvariskov.instructions')}</strong>
    <ol class="steps">
      <li>{t('kvariskov.step1')}</li>
      <li>{t('kvariskov.step2')}</li>
      <li>{t('kvariskov.step3')}</li>
    </ol>
  </section>

  <!-- Fetch button -->
  <section class="sec">
    <Button onclick={() => void fetchSnapshot()} disabled={loading} data-testid="kvariskov-fetch">
      {#if loading}
        {t('kvariskov.fetching')}
      {:else}
        {t('kvariskov.fetch')}
      {/if}
    </Button>
    {#if asleep}
      <div class="box warn" data-testid="kvariskov-asleep">
        <strong><Icon name="alert-triangle" size={18} /> {t('kvariskov.warnLabel')}</strong>
        {t('kvariskov.asleep')}
      </div>
    {:else if error !== null}
      <div class="box err" data-testid="kvariskov-error">
        <strong><Icon name="alert-triangle" size={18} /> {t('export.error')}</strong>
        {error}
      </div>
    {/if}
    {#if overflow}
      <div class="box warn" data-testid="kvariskov-overflow">
        <strong><Icon name="alert-triangle" size={18} /> {t('kvariskov.warnLabel')}</strong>
        {t('kvariskov.overflow')}
      </div>
    {/if}
  </section>

  {#if hasFetched}
    {#if checkunitMode === 'unavailable'}
      <div class="box warn" data-testid="kvariskov-unavailable">
        <strong><Icon name="alert-triangle" size={18} /> {t('kvariskov.warnLabel')}</strong>
        {t('kvariskov.unavailable')}
      </div>
    {/if}

    <!-- Summary banner -->
    {#if showEmptyRead || showCount}
    <section class="sec summary-banner" data-testid="kvariskov-summary">
      {#if showEmptyRead}
        <div class="box warn" data-testid="kvariskov-empty-read">
          <strong><Icon name="alert-triangle" size={18} /> {t('kvariskov.warnLabel')}</strong>
          {t('kvariskov.emptyRead')}
        </div>
      {:else}
        <div class="count-badge" class:urgent={missingCards.length > 0}>
          {t('kvariskov.result', { count: missingCards.length })}
        </div>
        <p class="summary-text" data-testid="kvariskov-summary-text">
          {t('kvariskov.summary', { missing: missingCards.length, back: backCards.length })}
        </p>
        {#if safetySummary}
          <Button variant="secondary" onclick={() => void copyToClipboard()} data-testid="kvariskov-copy">
            {#if copySuccess}
              {t('kvariskov.copied')}
            {:else}
              {t('kvariskov.copyClipboard')}
            {/if}
          </Button>
        {/if}
      {/if}
    </section>
    {/if}

    <!-- Table heading with fetch time -->
    <div class="fetch-row">
      <h2 class="h1">{t('kvariskov.missing')} — {t('kvariskov.started')}</h2>
      {#if fetchedAt !== null}
        <span class="fetched" data-testid="kvariskov-fetched-at"
          >{t('kvariskov.fetchedAt', { time: fetchedText(fetchedAt) })}</span
        >
      {/if}
      {#if checkunitReadAtMs !== null}
        <span class="fetched" data-testid="kvariskov-checkunit-read-at"
          >{t('kvariskov.checkunitReadAt', { time: fetchedText(checkunitReadAtMs) })}{#if checkunitMode === 'stored'}
            <span data-testid="kvariskov-stored">{t('kvariskov.storedRead')}</span>{/if}</span
        >
      {/if}
      {#if updated?.radio_enabled}
        <span class="fetched" data-testid="kvariskov-radio-last"
          >{t('kvariskov.radioLast', {
            time:
              updated.radio_last_punch_at_ms === null
                ? t('kvariskov.radioNone')
                : fetchedText(updated.radio_last_punch_at_ms),
          })}</span
        >
      {/if}
      <Button
        variant="secondary"
        onclick={() => void fetchSnapshot()}
        disabled={loading}
        data-testid="kvariskov-refetch"
      >
        {t('kvariskov.refetch')}
      </Button>
    </div>

    <!-- Missing runners table -->
    {#if missingKnown.length > 0}
      <section class="sec" data-testid="kvariskov-missing-table">
        <table class="tbl">
          <thead>
            <tr>
              <th>{t('kvariskov.name')}</th>
              <th>{t('kvariskov.club')}</th>
              <th>{t('kvariskov.class')}</th>
              <th>{t('kvariskov.startTime')}</th>
              <th>{t('kvariskov.elapsed')}</th>
              <th>{t('kvariskov.seenAt')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each missingKnown as competitor (competitor.id)}
              <tr data-testid="kvariskov-row">
                <td class="name">{competitor.name}</td>
                <td>{competitor.club ?? '—'}</td>
                <td>{className(competitor.class_id)}</td>
                <td>{startText(competitor.start_time_ms)}</td>
                <td>{elapsed(competitor.start_time_ms)}</td>
                <td>{@render seenTags(competitor.card_number!)}</td>
                <td>
                  <Button
                    variant="secondary"
                    size="sm"
                    onclick={() => markSafe(competitor.card_number!)}
                    data-testid="kvariskov-mark-safe"
                  >
                    {t('kvariskov.markSafe')}
                  </Button>
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
              {@render seenTags(cn)}
              <Button
                variant="secondary"
                size="sm"
                onclick={() => markSafe(cn)}
                data-testid="kvariskov-mark-unknown-safe"
              >
                {t('kvariskov.markSafe')}
              </Button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if startedCards.length > 0 && missingCards.length === 0 && !loading && !lastFetchFailed}
      {#if overflow}
        <div class="box warn" data-testid="kvariskov-none-missing-overflow">
          <strong><Icon name="alert-triangle" size={18} /> {t('kvariskov.warnLabel')}</strong>
          {t('kvariskov.noneMissingOverflow')}
        </div>
      {:else if checkunitMode === 'stored'}
        <div class="box warn" data-testid="kvariskov-stored-none-missing">
          <strong><Icon name="alert-triangle" size={18} /> {t('kvariskov.warnLabel')}</strong>
          {t('kvariskov.storedNoneMissing', {
            time: checkunitReadAtMs === null ? '—' : fetchedText(checkunitReadAtMs),
          })}
        </div>
      {:else if checkunitMode === 'unavailable'}
        <!-- The warning at the top says the check unit is unread; no all-clear here. -->
      {:else if markedCards.length === 0}
        <div class="box ok" data-testid="kvariskov-all-returned">
          <strong><Icon name="check" size={18} /> {t('kvariskov.allBack')}</strong>
        </div>
      {:else}
        <div class="box ok" data-testid="kvariskov-none-missing">
          <strong
            ><Icon name="check" size={18} />
            {t('kvariskov.noneMissing', { back: backCards.length, marked: markedCards.length })}</strong
          >
        </div>
      {/if}
    {/if}

    <!-- Marked safe (this computer only) -->
    {#if markedCards.length > 0}
      <section class="sec" data-testid="kvariskov-marked">
        <h2 class="h1">{t('kvariskov.markedHeading', { n: markedCards.length })}</h2>
        <p class="muted">{t('kvariskov.markedLocal')}</p>
        <ul class="card-list">
          {#each markedCards as cn (cn)}
            {@const c = competitorByCard.get(cn)}
            <li data-testid="kvariskov-marked-row">
              <span class="name">{c ? c.name : `#${cn}`}</span>
              {#if c}<span>#{cn}</span><span>{className(c.class_id)}</span>{/if}
            </li>
          {/each}
        </ul>
      </section>
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
    font-size: var(--fs-display);
    font-weight: 600;
  }
  .h1 {
    margin: 0;
    font-size: var(--fs-heading);
    font-weight: 600;
  }
  .sec {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .box {
    border-radius: var(--radius);
    padding: 12px 16px;
  }
  .box.err {
    border: 1px solid var(--dnf);
    background: var(--dnf-soft);
    color: var(--fg);
  }
  .box.warn {
    border: 1px solid var(--mp);
    background: var(--mp-soft);
    color: var(--mp-fg);
  }
  .box.info {
    background: var(--bg-elev);
    border: 1px solid var(--border);
  }
  .steps {
    margin: 6px 0 0;
    padding-left: 24px;
    color: var(--fg-muted);
    font-size: var(--fs-label);
  }
  .box.ok {
    background: color-mix(in srgb, var(--ok) 12%, transparent);
    border: 1px solid var(--ok);
  }
  .summary-banner {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px;
    gap: 12px;
  }
  .count-badge {
    font-size: var(--fs-heading);
    font-weight: 700;
  }
  .count-badge.urgent {
    color: var(--dnf);
  }
  .summary-text {
    font-size: var(--fs-body);
    margin: 0;
  }
  .tbl {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-label);
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
  }
  .fetch-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elev);
    color: var(--fg);
  }
  .tag.warn {
    border-color: var(--mp);
    background: var(--mp-soft);
    color: var(--mp-fg);
  }
  .fetched {
    color: var(--fg-muted);
    font-size: var(--fs-label);
  }
</style>
