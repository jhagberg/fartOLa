<!--
  Authored for fartola. Not ported from upstream.

  /competition/:id/hyrbrickor — mounts the ActiveHyrbrickorView screen.
  Thin shell: reads `id` from $page.params and forwards it to the view,
  which owns the REST + render logic.

  Locked by:
  - .planning/phases/02-4-klubbs-mvp/02-05-PLAN.md task 3
  - .planning/phases/02-4-klubbs-mvp/02-CONTEXT.md D-HB-2 (admin backstop view)
-->
<script lang="ts">
  import { page } from '$app/state';
  import ActiveHyrbrickorView from '#lib/screens/ActiveHyrbrickorView.svelte';

  const competitionId = $derived(page.params['id'] ?? '');
</script>

{#if competitionId}
  <ActiveHyrbrickorView {competitionId} />
{:else}
  <p class="muted">…</p>
{/if}

<style>
  .muted {
    color: var(--fg-muted);
  }
</style>
