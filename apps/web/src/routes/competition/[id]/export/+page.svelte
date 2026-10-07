<!--
  Authored for fartola. Not ported from upstream.

  /competition/:id/export — thin shell. Forwards $page.params.id to
  ExportView, which owns all REST + download wiring (UI-SPEC §"Export
  IOF XML 3.0 ResultList").

  Locked by:
  - 01-16-PLAN.md task 2
  - REQ-EVT-CMP-008 + REQ-STD-002 (IOF XML 3.0 export)
-->
<script lang="ts">
  import { page } from '$app/state';
  import ExportView from '#lib/screens/ExportView.svelte';

  const competitionId = $derived(page.params['id'] ?? '');
</script>

{#if competitionId}
  <ExportView {competitionId} />
{:else}
  <p class="muted">…</p>
{/if}

<style>
  .muted {
    color: var(--fg-muted);
  }
</style>
