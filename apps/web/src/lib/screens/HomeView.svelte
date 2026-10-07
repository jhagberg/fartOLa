<!--
  Authored for fartola. Not ported from upstream.

  HomeView (`/`) — hero + competition cards grid.

  Layout per 01-UI-SPEC.md §HomeView:
   - Hero box (gradient + brand-mark deco) holds the page H1 and the
     primary `+ Ny tävling` CTA.
   - Auto-fill grid below: `repeat(auto-fill, minmax(280px, 1fr))`.
   - Empty state replaces the grid with a centered prompt + same CTA.

  Data flow:
   - `$effect(() => { void load(); })` fires once on mount and re-runs
     when `loadKey` mutates (Phase 2 hook for results-projection-driven
     refresh; today the wizard `goto` away from `/` so there is no live
     reload to wire).
   - api.listCompetitions() returns `{ competitions: CompetitionDTO[] }`
     which we sort by date desc, then created_at_ms desc.
   - No starters/finished counts are joined yet — those land with the
     readout projection in plan 13. CompetitionCard already accepts
     `null` and renders `—` placeholders.

  Locked by:
  - 01-UI-SPEC.md §HomeView + §"Empty states"
  - 01-SKETCHES/.../screens-home.jsx HomeView structure
  - 01-12-PLAN.md task 1
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { listCompetitions } from '#lib/api/client.ts';
  import { t } from '#lib/i18n/index.ts';
  import type { CompetitionDTO } from '@fartola/shared-types';
  import CompetitionCard from '#lib/components/CompetitionCard.svelte';

  let competitions: CompetitionDTO[] = $state([]);
  let loaded = $state(false);
  let loadError: string | null = $state(null);

  async function load(): Promise<void> {
    try {
      const res = await listCompetitions();
      competitions = [...res.competitions].sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return b.created_at_ms - a.created_at_ms;
      });
      loaded = true;
    } catch (e) {
      loadError = (e as Error).message;
      loaded = true;
    }
  }

  $effect(() => {
    void load();
  });

  function openWizard(): void {
    void goto('/competition/_new?wizard=1');
  }

  function openCompetition(c: CompetitionDTO): void {
    void goto(`/competition/${c.id}/readout`);
  }
</script>

<section>
  <header class="hero">
    <div>
      <h1>{t('home.title')}</h1>
      <p>StorTuna OK</p>
    </div>
    <button
      type="button"
      class="cta"
      onclick={openWizard}
      data-testid="open-wizard"
    >
      {t('home.new')}
    </button>
  </header>

  {#if !loaded}
    <p class="muted">…</p>
  {:else if loadError}
    <div class="err-card" role="alert">
      <strong>{t('err.network')}</strong>
      <div class="mono small">{loadError}</div>
    </div>
  {:else if competitions.length === 0}
    <div class="empty" data-testid="home-empty">
      <h2>{t('home.empty.title')}</h2>
      <p>{t('home.empty.desc')}</p>
      <button
        type="button"
        class="cta"
        onclick={openWizard}
        data-testid="open-wizard-empty"
      >
        {t('home.new')}
      </button>
    </div>
  {:else}
    <div class="comp-grid" data-testid="comp-grid">
      {#each competitions as c (c.id)}
        <CompetitionCard competition={c} onclick={openCompetition} />
      {/each}
    </div>
  {/if}
</section>

<style>
  .hero {
    background: linear-gradient(135deg, var(--accent-soft), var(--bg-sunken));
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 32px 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 24px;
  }
  .hero h1 {
    margin: 0 0 4px;
    font-size: 26px;
    letter-spacing: -0.01em;
  }
  .hero p {
    margin: 0;
    color: var(--fg-muted);
  }
  .cta {
    height: 56px;
    min-height: var(--hit);
    padding: 0 22px;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--accent-fg);
    border: 1px solid var(--accent);
    font-size: var(--fs-body);
    font-weight: 600;
    cursor: pointer;
  }
  .cta:hover {
    background: var(--accent-strong);
  }
  .comp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 14px;
  }
  .empty {
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-lg);
    padding: 56px 24px;
    text-align: center;
    background: var(--bg-elev);
    display: grid;
    place-items: center;
    gap: 8px;
  }
  .empty h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
  }
  .empty p {
    margin: 0 0 12px;
    color: var(--fg-muted);
  }
  .err-card {
    background: var(--bg-elev);
    border: 1px solid var(--dnf);
    border-radius: var(--radius);
    padding: 16px;
    color: var(--dnf);
  }
  .err-card .mono {
    font-family: var(--font-mono);
    margin-top: 6px;
    color: var(--fg-muted);
  }
  .small {
    font-size: 12px;
  }
  .muted {
    color: var(--fg-muted);
  }
</style>
