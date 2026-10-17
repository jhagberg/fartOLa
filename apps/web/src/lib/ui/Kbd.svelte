<!--
  Authored for fartola. Not ported from upstream.

  Keyboard-key hint, used in UI-SPEC §"Keyboard shortcuts" footers and
  inline help. Monospace, small, with a subtle border so it reads as a
  printable key on the receipt-template legend rows.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children?: Snippet;
  }

  let { children }: Props = $props();
</script>

<kbd class="kbd">{@render children?.()}</kbd>

<style>
  .kbd {
    font-family: var(--font-mono);
    font-size: var(--fs-caption);
    padding: 1px 7px;
    background: var(--bg-sunken);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--fg-muted);
  }
</style>
