<!--
  Authored for fartola. Not ported from upstream.

  /competition/:id/kontroll — mounts PreRaceCheckView ("Kontroll inför
  tävlingen" and the Brickregister). Thin shell, as /hyrbrickor.
-->
<script lang="ts">
  import { page } from '$app/state';
  import PreRaceCheckView from '#lib/screens/PreRaceCheckView.svelte';

  const competitionId = $derived(page.params['id'] ?? '');
</script>

{#if competitionId}
  <PreRaceCheckView {competitionId} />
{:else}
  <p class="muted">…</p>
{/if}

<style>
  .muted {
    color: var(--fg-muted);
  }
</style>
