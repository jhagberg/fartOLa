<!--
  Authored for fartola. Not ported from upstream.

  Competition route entry point. Two responsibilities in plan 12:
   1. If `id === '_new'` AND `?wizard=1`, render the new-competition
      wizard overlay. The wizard fires its own POST and navigates to
      `/competition/<real-id>/readout` on success (C-H3 atomic flow).
   2. Otherwise, redirect to `./readout` — the readout view is the
      canonical landing route per UI-SPEC §"Sidebar / Readout".

  Plan 13 lands the real readout component at `./readout/+page.svelte`;
  plan 12 only ships a placeholder there so the wizard's goto target
  resolves cleanly during e2e.

  Locked by:
  - 01-12-PLAN.md task 2
  - 01-13-PLAN.md (readout view authoritative implementation)
-->
<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import NewCompetitionWizard from '#lib/screens/NewCompetitionWizard.svelte';

  const id = $derived(page.params['id'] ?? '');
  const wizardFlag = $derived(page.url.searchParams.get('wizard') === '1');
  const isWizardRoute = $derived(id === '_new' && wizardFlag);

  $effect(() => {
    // Non-wizard navigation: bounce to readout. Avoid bouncing while
    // the wizard overlay is the intended view.
    if (!isWizardRoute && id && id !== '_new') {
      void goto(`/competition/${id}/readout`, { replace: true });
    }
  });
</script>

{#if isWizardRoute}
  <NewCompetitionWizard />
{:else if id && id !== '_new'}
  <p class="muted">…</p>
{:else}
  <p class="muted">Ingen tävling vald.</p>
{/if}

<style>
  .muted {
    color: var(--fg-muted);
  }
</style>
