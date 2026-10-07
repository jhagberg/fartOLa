<!--
  Authored for fartola. Not ported from upstream.

  /competition/:id/readout — mounts the ReadoutView screen. The route
  itself is a thin shell: it reads `id` from `$page.params` and forwards
  it to ReadoutView, which owns all WS + REST wiring.

  C-M3 LOCKED: when the URL carries `?walkup=<cardNumber>`, plan 14
  mounts <WalkupModal /> AS AN OVERLAY on this same route. There is no
  separate /walkup route file anywhere in the codebase. Plan 14 will
  extend this page (or ReadoutView) to render the overlay; for plan 13
  the URL contract is the only commitment — the auto-redirect from
  ReadoutView is the producer side of that contract.

  Locked by:
  - 01-12-PLAN.md (wizard goto target = /readout)
  - 01-13-PLAN.md task 2
  - 01-REVIEWS.md §C-M3 (?walkup= variant, no /walkup route)
-->
<script lang="ts">
  import { page } from '$app/state';
  import ReadoutView from '#lib/screens/ReadoutView.svelte';

  const competitionId = $derived(page.params['id'] ?? '');
</script>

{#if competitionId}
  <ReadoutView {competitionId} />
{:else}
  <p class="muted">…</p>
{/if}

<style>
  .muted {
    color: var(--fg-muted);
  }
</style>
