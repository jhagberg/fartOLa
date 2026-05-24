<!--
  Authored for fartola. Not ported from upstream.

  /competition/:id/kvar-i-skogen — thin shell that forwards competitionId
  to KvarISkovenView, which owns all safety-readout logic and state.

  Locked by 02.1-06-PLAN.md task 2.
-->
<script lang="ts">
  import { page } from '$app/state';
  import KvarISkovenView from '$lib/screens/KvarISkovenView.svelte';

  const competitionId = $derived(page.params['id'] ?? '');
</script>

{#if competitionId}
  <KvarISkovenView {competitionId} />
{:else}
  <p class="muted">Ingen tävling vald.</p>
{/if}

<style>
  .muted {
    color: var(--fg-muted);
  }
</style>
