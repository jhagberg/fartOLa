<!--
  Authored for fartola. Not ported from upstream.

  /competition/:id/runners — canonical "Anmälda" surface. Thin shell that
  forwards competitionId to RunnersListView, which owns search/filter/edit
  state + opens the import sheet on ?import=1.

  The former /import route now redirects here with ?import=1 so deep links
  continue to work (e.g. the new-competition wizard's first landing target).
-->
<script lang="ts">
  import { page } from '$app/state';
  import RunnersListView from '#lib/screens/RunnersListView.svelte';

  const competitionId = $derived(page.params['id'] ?? '');
</script>

{#if competitionId}
  <RunnersListView {competitionId} />
{:else}
  <p class="muted">Ingen tävling vald.</p>
{/if}

<style>
  .muted {
    color: var(--fg-muted);
  }
</style>
