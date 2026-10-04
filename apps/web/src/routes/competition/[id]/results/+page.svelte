<!--
  Authored for fartola. Not ported from upstream.

  /competition/:id/results — thin shell. Forwards $page.params.id to
  ResultsView, which owns all WS + REST wiring (UI-SPEC §"Live results
  auto-update").

  Locked by:
  - 01-14-PLAN.md task 2
  - REQ-EVT-CMP-007 (live results page on localhost)
-->
<script lang="ts">
  import { page } from '$app/state';
  import ResultsView from '#lib/screens/ResultsView.svelte';

  const competitionId = $derived(page.params['id'] ?? '');
</script>

{#if competitionId}
  <ResultsView {competitionId} />
{:else}
  <p class="muted">…</p>
{/if}

<style>
  .muted {
    color: var(--fg-muted);
  }
</style>
