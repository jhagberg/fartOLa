<!--
  Authored for fartola. Not ported from upstream.

  /competition/:id/lottning — thin shell that forwards competitionId to
  LottningView, which owns all draw logic and state.

  Locked by 02.1-05-PLAN.md task 1.
-->
<script lang="ts">
  import { page } from '$app/state';
  import LottningView from '$lib/screens/LottningView.svelte';

  const competitionId = $derived(page.params['id'] ?? '');
</script>

{#if competitionId}
  <LottningView {competitionId} />
{:else}
  <p class="muted">Ingen tävling vald.</p>
{/if}

<style>
  .muted {
    color: var(--fg-muted);
  }
</style>
