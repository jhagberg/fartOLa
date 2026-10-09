<!--
  Authored for fartola. Not ported from upstream.

  Card primitive matching `.card` from 01-SKETCHES/.../styles.css. Two
  optional named snippets (`head` + `body`); when neither is provided
  the default `children` slot fills the card body directly so casual
  callers don't have to spell out the snippets.

  UI-SPEC §"Component Inventory" lists Card as the basis for the readout
  current-read panel, history rows, results table, and the wizard steps.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    head?: Snippet;
    body?: Snippet;
    children?: Snippet;
    class?: string;
  }

  let { head, body, children, class: className = '' }: Props = $props();
</script>

<section class="card {className}">
  {#if head}
    <header class="card-head">{@render head()}</header>
  {/if}
  {#if body}
    <div class="card-body">{@render body()}</div>
  {:else if children}
    <div class="card-body">{@render children()}</div>
  {/if}
</section>

<style>
  .card {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }
  .card-head {
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }
  .card-body {
    padding: 18px;
  }
</style>
