<!--
  Authored for fartola. Not ported from upstream.

  Label + control wrapper. Six-pixel gap per UI-SPEC §"Field rows" so
  the wizard form, the walk-up modal, and the receipt-template panel all
  use the exact same vertical rhythm.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    htmlFor?: string;
    hint?: string;
    children?: Snippet;
  }

  let { label, htmlFor, hint, children }: Props = $props();
</script>

<div class="field">
  <label for={htmlFor}>{label}</label>
  {@render children?.()}
  {#if hint}
    <small class="hint">{hint}</small>
  {/if}
</div>

<style>
  .field {
    display: grid;
    gap: 6px;
  }
  label {
    font-size: var(--fs-label);
    color: var(--fg);
    font-weight: 500;
  }
  .hint {
    font-size: var(--fs-caption);
    color: var(--fg-muted);
  }
</style>
