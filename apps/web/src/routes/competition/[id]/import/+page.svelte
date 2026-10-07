<!--
  Authored for fartola. Not ported from upstream.

  /competition/:id/import — kept as a deep-linkable URL so the existing
  wizard goto target + any external bookmarks survive the move. Forwards
  to /competition/:id/runners?import=1 where the Importera sheet is
  mounted over the canonical roster screen.

  See ROUTERS-RUNNERS-IMPORT note in RunnersListView for the sheet
  contract.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';

  const competitionId = $derived(page.params['id'] ?? '');

  onMount(() => {
    if (competitionId) {
      void goto(`/competition/${competitionId}/runners?import=1`, { replace: true });
    }
  });
</script>

{#if !competitionId}
  <p class="muted">Ingen tävling vald.</p>
{/if}

<style>
  .muted {
    color: var(--fg-muted);
  }
</style>
