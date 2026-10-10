<!--
  Authored for fartola. Not ported from upstream.

  PreRaceCheckView: "Kontroll inför tävlingen" and the Brickregister.

  Kontroll lists what is still wrong before the first start (GET
  …/pre-race-check; the rules are in the edge's projection/preRaceCheck.ts),
  one section per problem with the SOFT rule it rests on. A runner row
  opens EditCompetitorModal; saving runs the check again. MeOS has the same
  report as "Kör kontroll inför tävlingen..." (TabList.cpp:2933).

  Brickregister lists every card with its runner and rental state
  (card-register.ts), searchable on number, name or club.

  The tab and the register search are in the URL (?vy=brickor&q=…), so back
  and reload return to the same view (ADR-0016 rule 3).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { t } from '#lib/i18n/index.ts';
  import {
    getPreRaceCheck,
    listClasses,
    listCompetitors,
    listHiredCards,
    type PreRaceCheck,
  } from '#lib/api/client.ts';
  import type { ClassDTO, CompetitorDTO } from '@fartola/shared-types';
  import Button from '#lib/ui/Button.svelte';
  import Input from '#lib/ui/Input.svelte';
  import Icon from '#lib/ui/Icon.svelte';
  import EditCompetitorModal from '#lib/components/EditCompetitorModal.svelte';
  import { buildCardRows, filterCardRows, type CardRow } from './card-register.ts';

  interface Props {
    competitionId: string;
  }

  let { competitionId }: Props = $props();

  /** Rows shown per section before "Visa alla". */
  const SHOW = 20;

  let check = $state<PreRaceCheck | null>(null);
  let competitors = $state<CompetitorDTO[]>([]);
  let classes = $state<ClassDTO[]>([]);
  let cardRows = $state<CardRow[]>([]);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let expanded = $state<Set<string>>(new Set());
  let editTarget = $state<CompetitorDTO | null>(null);

  const tab = $derived(page.url.searchParams.get('vy') === 'brickor' ? 'cards' : 'check');
  const query = $derived(page.url.searchParams.get('q') ?? '');

  async function loadAll(): Promise<void> {
    loadError = null;
    try {
      const [checkRes, compRes, classRes, hiredRes] = await Promise.all([
        getPreRaceCheck(competitionId),
        listCompetitors(competitionId),
        listClasses(competitionId),
        listHiredCards(competitionId),
      ]);
      check = checkRes;
      competitors = compRes.competitors;
      classes = classRes.classes;
      cardRows = buildCardRows(compRes.competitors, hiredRes, classRes.classes);
    } catch {
      loadError = t('prerace.loadError');
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void loadAll();
  });

  function setParams(next: Record<string, string | null>): void {
    const u = new URL(page.url.href);
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '') u.searchParams.delete(k);
      else u.searchParams.set(k, v);
    }
    void goto(u.pathname + u.search, { replace: true, reset: false });
  }

  interface Row {
    key: string;
    competitorId: string | null;
    name: string;
    meta: string;
    card: number | null;
    detail: string | null;
  }
  interface Section {
    key: string;
    title: string;
    rule: string;
    rows: Row[];
    /** A warning, not a fault: shown with the info icon, not counted. */
    soft?: boolean;
    action?: { label: string; href: string };
  }

  const competitorById = $derived(new Map(competitors.map((c) => [c.id, c])));

  const sections = $derived.by((): Section[] => {
    if (check === null) return [];
    const runnerRows = (
      list: PreRaceCheck['no_card'],
      detail: (i: number) => string | null = () => null
    ): Row[] =>
      list.map((r, i) => ({
        key: r.competitor_id,
        competitorId: r.competitor_id,
        name: r.name.trim() === '' ? '–' : r.name,
        meta: [r.class_name, r.club].filter((s) => s).join(' · '),
        card: r.card_number,
        detail: detail(i),
      }));
    const base = `/competition/${encodeURIComponent(competitionId)}`;
    const classRows = (list: PreRaceCheck['classes_without_course']): Row[] =>
      list.map((c) => ({
        key: c.class_id,
        competitorId: null,
        name: c.class_name,
        meta: t('prerace.noCourse.runners', { count: c.runners }),
        card: null,
        detail: null,
      }));
    return [
      {
        key: 'noCard',
        title: t('prerace.noCard.title'),
        rule: t('prerace.noCard.rule'),
        rows: runnerRows(check.no_card),
      },
      {
        key: 'noStart',
        title: t('prerace.noStart.title'),
        rule: t('prerace.noStart.rule'),
        rows: runnerRows(check.no_start_time),
        action: { label: t('prerace.noStart.action'), href: `${base}/lottning` },
      },
      {
        key: 'startPunch',
        title: t('prerace.startPunch.title'),
        rule: t('prerace.startPunch.rule'),
        rows: classRows(check.start_punch_not_allowed),
        action: { label: t('prerace.noStart.action'), href: `${base}/lottning` },
      },
      {
        key: 'cardTooSmall',
        title: t('prerace.cardTooSmall.title'),
        rule: t('prerace.cardTooSmall.rule'),
        rows: runnerRows(check.card_too_small, (i) =>
          t('prerace.cardTooSmall.detail', {
            capacity: check!.card_too_small[i]!.capacity,
            controls: check!.card_too_small[i]!.controls,
          })
        ),
      },
      {
        key: 'splitsMissing',
        title: t('prerace.splitsMissing.title'),
        rule: t('prerace.splitsMissing.rule'),
        rows: runnerRows(check.splits_missing, (i) =>
          t('prerace.splitsMissing.detail', {
            timed: check!.splits_missing[i]!.timed,
            controls: check!.splits_missing[i]!.controls,
          })
        ),
        soft: true,
      },
      {
        key: 'noCourse',
        title: t('prerace.noCourse.title'),
        rule: t('prerace.noCourse.rule'),
        rows: classRows(check.classes_without_course),
        action: { label: t('prerace.noCourse.action'), href: `${base}/runners?import=1` },
      },
      {
        key: 'noName',
        title: t('prerace.noName.title'),
        rule: t('prerace.noName.rule'),
        rows: runnerRows(check.no_name),
      },
      {
        key: 'noClub',
        title: t('prerace.noClub.title'),
        rule: t('prerace.noClub.rule'),
        rows: runnerRows(check.no_club),
      },
    ];
  });

  const issueCount = $derived(sections.reduce((n, s) => n + (s.soft ? 0 : s.rows.length), 0));
  const visibleCards = $derived(filterCardRows(cardRows, query));

  function toggleAll(key: string): void {
    const next = new Set(expanded);
    next.add(key);
    expanded = next;
  }

  function openEdit(id: string | null): void {
    if (id !== null) editTarget = competitorById.get(id) ?? null;
  }

  function onEditSaved(): void {
    void loadAll();
  }
</script>

<section class="prerace" data-testid="prerace-view">
  <header class="head">
    <h1 class="title">{t('prerace.title')}</h1>
    <div class="tabs" role="tablist" aria-label={t('prerace.title')}>
      <button
        type="button"
        role="tab"
        class="tab"
        aria-selected={tab === 'check'}
        onclick={() => setParams({ vy: null, q: null })}
        data-testid="prerace-tab-check">{t('prerace.tab.check')}</button
      >
      <button
        type="button"
        role="tab"
        class="tab"
        aria-selected={tab === 'cards'}
        onclick={() => setParams({ vy: 'brickor' })}
        data-testid="prerace-tab-cards">{t('prerace.tab.cards')}</button
      >
    </div>
  </header>

  {#if loading}
    <p class="muted">{t('prerace.loading')}</p>
  {:else if loadError}
    <p class="err" role="alert">{loadError}</p>
  {:else if tab === 'check'}
    <div class="summary">
      <p class="muted">{t('prerace.hint')}</p>
      <p class="summary-line" data-testid="prerace-summary">
        {#if issueCount === 0}
          <Icon name="check" size={20} />
          {t('prerace.summary.ok')}
        {:else}
          <Icon name="alert-triangle" size={20} />
          {t('prerace.summary.issues', { count: issueCount })}
        {/if}
      </p>
      <Button variant="primary" onclick={() => void loadAll()} data-testid="prerace-rerun">
        {t('prerace.rerun')}
      </Button>
    </div>

    {#each sections as s (s.key)}
      {@const shown = expanded.has(s.key) ? s.rows : s.rows.slice(0, SHOW)}
      <section class="card" data-testid={`prerace-section-${s.key}`}>
        <header
          class="section-head"
          class:clear={s.rows.length === 0}
          class:soft={s.soft && s.rows.length > 0}
        >
          <Icon
            name={s.rows.length === 0 ? 'check' : s.soft ? 'info' : 'alert-triangle'}
            size={20}
          />
          <h2>{s.title}: <span class="mono" data-testid="prerace-count">{s.rows.length}</span></h2>
        </header>
        {#if s.rows.length > 0}
          <p class="rule">{s.rule}</p>
          <ul class="rows">
            {#each shown as r (r.key)}
              <li>
                {#if r.competitorId !== null}
                  <button type="button" class="row" onclick={() => openEdit(r.competitorId)}>
                    <span class="row-main">
                      <span class="name">{r.name}</span>
                      <span class="meta">{r.meta}</span>
                    </span>
                    {#if r.detail}<span class="meta">{r.detail}</span>{/if}
                    {#if r.card !== null}<span class="mono">{r.card}</span>{/if}
                    <Icon name="chevron-right" size={16} />
                  </button>
                {:else}
                  <div class="row static">
                    <span class="row-main">
                      <span class="name">{r.name}</span>
                      <span class="meta">{r.meta}</span>
                    </span>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
          {#if shown.length < s.rows.length || s.action}
          <div class="section-foot">
            {#if shown.length < s.rows.length}
              <Button variant="secondary" onclick={() => toggleAll(s.key)}>
                {t('prerace.showAll', { count: s.rows.length })}
              </Button>
            {/if}
            {#if s.action}
              <a class="link" href={s.action.href}>{s.action.label}</a>
            {/if}
          </div>
          {/if}
        {/if}
      </section>
    {/each}
  {:else}
    <div class="search-wrap">
      <span class="search-icon" aria-hidden="true"><Icon name="search" size={18} /></span>
      <Input
        data-testid="prerace-cards-search"
        type="search"
        inputmode="search"
        value={query}
        oninput={(e: Event) => setParams({ q: (e.currentTarget as HTMLInputElement).value })}
        placeholder={t('prerace.cards.search')}
        aria-label={t('prerace.cards.search')}
      />
    </div>
    {#if cardRows.length === 0}
      <p class="muted">{t('prerace.cards.empty')}</p>
    {:else}
      <p class="muted" data-testid="prerace-cards-count">
        {t('prerace.cards.count', { count: visibleCards.length })}
      </p>
      {#if visibleCards.length === 0}
        <p class="muted">{t('prerace.cards.noResults')}</p>
      {:else}
        <ul class="rows card" data-testid="prerace-cards">
          {#each visibleCards as c (c.card_number)}
            {@const who = c.competitor}
            <li>
              {#if who}
                <button
                  type="button"
                  class="row"
                  onclick={() => (editTarget = who)}
                  data-testid="prerace-card-row"
                >
                  <span class="mono card-no">{c.card_number}</span>
                  <span class="row-main">
                    <span class="name">{who.name}</span>
                    <span class="meta">{[c.class_name, who.club].filter((s) => s).join(' · ')}</span>
                  </span>
                  {#if c.hire}
                    <span class="hire"
                      ><Icon name="key" size={16} />
                      {t(c.hire === 'open' ? 'prerace.cards.hire' : 'prerace.cards.returned')}</span
                    >
                  {/if}
                  <Icon name="chevron-right" size={16} />
                </button>
              {:else}
                <div class="row static" data-testid="prerace-card-row">
                  <span class="mono card-no">{c.card_number}</span>
                  <span class="row-main">
                    <span class="name muted">{t('prerace.cards.noRunner')}</span>
                  </span>
                  {#if c.hire}
                    <span class="hire"
                      ><Icon name="key" size={16} />
                      {t(c.hire === 'open' ? 'prerace.cards.hire' : 'prerace.cards.returned')}</span
                    >
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  {/if}
</section>

<EditCompetitorModal
  open={editTarget !== null}
  competitor={editTarget}
  {competitionId}
  {classes}
  onClose={() => (editTarget = null)}
  onSaved={onEditSaved}
/>

<style>
  .prerace {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    padding: var(--space-md);
    max-width: 880px;
    min-width: 0;
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }
  .title {
    margin: 0;
    font-size: var(--fs-heading);
    font-weight: 600;
  }
  .tabs {
    display: flex;
    gap: var(--space-xs);
  }
  .tab {
    min-height: var(--hit);
    padding: 0 var(--space-md);
    font-size: var(--fs-label);
    font-weight: 500;
    background: var(--bg-elev);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: 999px;
    cursor: pointer;
  }
  .tab[aria-selected='true'] {
    background: var(--fg);
    border-color: var(--fg);
    color: var(--bg-elev);
  }
  .muted {
    color: var(--fg-muted);
    margin: 0;
  }
  .err {
    color: var(--dnf);
    margin: 0;
  }
  .summary {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-sm);
  }
  .summary-line {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    margin: 0;
    font-size: var(--fs-body);
    font-weight: 600;
  }
  .card {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .section-head {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-sm) var(--space-md);
    color: var(--mp-fg);
  }
  .section-head.clear {
    color: var(--ok);
  }
  .section-head.soft {
    color: var(--fg-muted);
  }
  .section-head h2 {
    margin: 0;
    font-size: var(--fs-body);
    font-weight: 600;
    color: var(--fg);
  }
  .rule {
    margin: 0;
    padding: 0 var(--space-md) var(--space-sm);
    color: var(--fg-muted);
    font-size: var(--fs-label);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .rows li + li,
  .rule + .rows {
    border-top: 1px solid var(--border);
  }
  .row {
    width: 100%;
    min-height: var(--hit);
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-md);
    background: transparent;
    border: 0;
    color: var(--fg);
    text-align: left;
    font: inherit;
    cursor: pointer;
  }
  .row.static {
    cursor: default;
  }
  .row:hover:not(.static) {
    background: var(--bg-sunken);
  }
  .row-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    color: var(--fg-muted);
    font-size: var(--fs-label);
  }
  .mono {
    font-family: var(--font-mono);
    font-feature-settings:
      'tnum' 1,
      'zero' 1;
  }
  .card-no {
    min-width: 8ch;
  }
  .hire {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-sunken);
    border: 1px solid var(--border-strong);
    font-size: var(--fs-label);
    white-space: nowrap;
  }
  .section-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-top: 1px solid var(--border);
  }
  .link {
    color: var(--fg);
    font-weight: 600;
    min-height: var(--hit);
    display: inline-flex;
    align-items: center;
  }
  .search-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }
  .search-wrap :global(input) {
    padding-left: 36px;
    width: 100%;
    min-height: var(--hit);
  }
  .search-icon {
    position: absolute;
    left: 10px;
    color: var(--fg-muted);
    pointer-events: none;
    display: inline-flex;
  }
  @media (max-width: 480px) {
    .prerace {
      padding: var(--space-sm);
    }
  }
</style>
