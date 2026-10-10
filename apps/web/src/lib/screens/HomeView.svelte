<!--
  Authored for fartola. Not ported from upstream.

  HomeView (`/`) — hero + competition cards grid.

  Layout per 01-UI-SPEC.md §HomeView:
   - Flat hero box holds the page H1 and the primary `Ny tävling` CTA
     (hidden while the empty state shows its own).
   - Auto-fill grid below: `repeat(auto-fill, minmax(280px, 1fr))`.
   - Empty state replaces the grid with a centered prompt + same CTA.

  Data flow:
   - `$effect(() => { void load(); })` fires once on mount and re-runs
     when `loadKey` mutates (Phase 2 hook for results-projection-driven
     refresh; today the wizard `goto` away from `/` so there is no live
     reload to wire).
   - api.listCompetitions() returns `{ competitions: CompetitionDTO[] }`
     which we sort by date desc, then created_at_ms desc.
   - A failed load shows LoadError with a retry; load() clears it first.

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
  import Button from '#lib/ui/Button.svelte';
  import Icon from '#lib/ui/Icon.svelte';
  import LoadError from '#lib/ui/LoadError.svelte';

  let competitions: CompetitionDTO[] = $state([]);
  let loaded = $state(false);
  let loadError: string | null = $state(null);

  async function load(): Promise<void> {
    // A retry shows the placeholder, never "no competitions", until it answers.
    loaded = false;
    loadError = null;
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
</script>

<section>
  <header class="hero">
    <h1>{t('home.title')}</h1>
    {#if !(loaded && !loadError && competitions.length === 0)}
      <Button size="lg" onclick={openWizard} data-testid="open-wizard">
        <Icon name="plus" />{t('home.new')}
      </Button>
    {/if}
  </header>

  {#if !loaded}
    <p class="muted">…</p>
  {:else if loadError}
    <LoadError message={t('home.loadError')} onretry={load} />
  {:else if competitions.length === 0}
    <div class="empty" data-testid="home-empty">
      <h2>{t('home.empty.title')}</h2>
      <p>{t('home.empty.desc')}</p>
      <Button size="lg" onclick={openWizard} data-testid="open-wizard-empty">
        <Icon name="plus" />{t('home.new')}
      </Button>
    </div>
  {:else}
    <div class="comp-grid" data-testid="comp-grid">
      {#each competitions as c (c.id)}
        <CompetitionCard competition={c} />
      {/each}
    </div>
  {/if}
</section>

<style>
  .hero {
    background: var(--bg-elev);
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
    margin: 0;
    font-size: 26px;
    letter-spacing: -0.01em;
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
  .muted {
    color: var(--fg-muted);
  }
</style>
