<!--
  Authored for fartola.

  Competition info / edit route. Thin route wrapper — the actual screen
  lives at $lib/screens/CompetitionInfoView.svelte so it's testable
  without a SvelteKit shell.
-->
<script lang="ts">
  import { page } from '$app/state';
  import CompetitionInfoView from '#lib/screens/CompetitionInfoView.svelte';

  const competitionId = $derived(page.params['id'] ?? '');
</script>

{#if competitionId}
  <CompetitionInfoView {competitionId} />
{/if}
