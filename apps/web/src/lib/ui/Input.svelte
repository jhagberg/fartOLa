<!--
  Authored for fartola. Not ported from upstream.

  Native <input> wrapper. UI-SPEC §"Inputs" — height pinned to var(--hit)
  for the operator's tap-target contract, 16px font so iOS Safari doesn't
  zoom on focus (Phase 2 LAN demo will care; Phase 1 doesn't but the
  cost is zero).

  type='date' is intentionally NOT specially handled — UI-SPEC §"Date inputs"
  uses plain text + ISO format (YYYY-MM-DD) so the receipt and the form
  agree without an extra normalization step.
-->
<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends HTMLInputAttributes {
    value?: string | number;
  }

  let { value = $bindable(''), class: className = '', ...rest }: Props = $props();
</script>

<input class="input {className}" bind:value {...rest} />

<style>
  .input {
    height: var(--hit);
    min-height: var(--hit);
    padding: 0 var(--space-sm);
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    font-size: var(--fs-body);
    width: 100%;
    color: var(--fg);
  }
  .input:focus {
    outline: 2px solid var(--fg);
    outline-offset: 2px;
    border-color: var(--accent);
  }
</style>
