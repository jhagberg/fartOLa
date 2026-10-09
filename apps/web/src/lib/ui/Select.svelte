<!--
  Authored for fartola. Not ported from upstream.

  Thin wrapper around native <select>. Uses the same token-driven styling
  as Input.svelte so the readout-sidebar dropdowns (template picker,
  class picker) line up visually with the text inputs.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLSelectAttributes } from 'svelte/elements';

  interface Props extends HTMLSelectAttributes {
    value?: string | number;
    children?: Snippet;
  }

  let { value = $bindable(''), children, class: className = '', ...rest }: Props = $props();
</script>

<select class="select {className}" bind:value {...rest}>
  {@render children?.()}
</select>

<style>
  .select {
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
  .select:focus {
    outline: 2px solid var(--fg);
    outline-offset: 2px;
    border-color: var(--accent);
  }
</style>
