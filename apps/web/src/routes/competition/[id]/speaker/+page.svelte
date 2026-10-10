<!--
  Authored for fartola. Not ported from upstream.

  /competition/:id/speaker — thin shell; SpeakerView owns the REST + WS
  wiring (todo 2026-10-07-speaker-view, REQ-UI-009).
-->
<script lang="ts">
  import { page } from '$app/state';
  import SpeakerView from '#lib/screens/SpeakerView.svelte';

  const competitionId = $derived(page.params['id'] ?? '');
</script>

<!-- Keyed: another competition id is a fresh view (board, choice, socket). -->
{#if competitionId}
  {#key competitionId}
    <SpeakerView {competitionId} />
  {/key}
{/if}
