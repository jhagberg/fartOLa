<!--
  Authored for fartola. Not ported from upstream.

  /competition/:id/registration — the registration-desk operator surface.
  Thin shell mounting RegistrationView. Mirrors the readout/+page.svelte
  pattern verbatim.

  Locked by:
  - 02-02b-PLAN.md task 4
  - .planning/phases/02-4-klubbs-mvp/02-CONTEXT.md lines 45-71
    (Registration-desk section)
-->
<script lang="ts">
  import { page } from '$app/state';
  import RegistrationView from '#lib/screens/RegistrationView.svelte';

  interface Props {
    data?: { competitionId?: string };
  }
  let { data }: Props = $props();
  const competitionId = $derived(data?.competitionId ?? page.params['id'] ?? '');
</script>

{#if competitionId}
  <RegistrationView {competitionId} />
{:else}
  <p class="muted">…</p>
{/if}

<style>
  .muted {
    color: var(--fg-muted);
  }
</style>
