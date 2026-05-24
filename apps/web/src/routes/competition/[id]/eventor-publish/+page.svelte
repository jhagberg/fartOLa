<!--
  Authored for fartola. Not ported from upstream.

  /competition/:id/eventor-publish — thin shell forwarding to
  EventorPublishView (Plan 02.1-08 task 2).
-->
<script lang="ts">
  import { page } from '$app/state';
  import EventorPublishView from '$lib/screens/EventorPublishView.svelte';

  const competitionId = $derived(page.params['id'] ?? '');
</script>

{#if competitionId}
  <EventorPublishView {competitionId} />
{:else}
  <p class="muted">…</p>
{/if}

<style>
  .muted {
    color: var(--fg-muted);
  }
</style>
