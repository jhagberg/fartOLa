<!--
  Authored for fartola. Not ported from upstream.

  Scrim + dialog primitive. UI-SPEC §"Keyboard shortcuts" calls for Esc
  to dismiss; we wire the keydown listener at the document level so a
  modal that gains focus on a non-button element still picks it up.

  Three optional snippets: `head` (title + close affordance), `body`
  (content), `foot` (button row). The new-competition wizard, walk-up
  modal, and the future results-fullscreen overlay all compose on this.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    open: boolean;
    onClose?: (() => void) | undefined;
    head?: Snippet;
    body?: Snippet;
    foot?: Snippet;
    children?: Snippet;
  }

  let { open, onClose, head, body, foot, children }: Props = $props();

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && open) onClose?.();
  }

  function onScrimClick(): void {
    onClose?.();
  }
</script>

<svelte:window on:keydown={onKey} />

{#if open}
  <div class="modal-scrim" role="presentation" onclick={onScrimClick}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      tabindex={-1}
      onclick={(e) => e.stopPropagation()}
    >
      {#if head}
        <header class="modal-head">{@render head()}</header>
      {/if}
      <div class="modal-body">
        {#if body}{@render body()}{:else if children}{@render children()}{/if}
      </div>
      {#if foot}
        <footer class="modal-foot">{@render foot()}</footer>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-scrim {
    position: fixed;
    inset: 0;
    background: rgba(20, 20, 30, 0.32);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-lg);
    z-index: 50;
    backdrop-filter: blur(2px);
  }
  .modal {
    background: var(--bg-elev);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-lg);
    width: min(680px, 100%);
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .modal-head {
    padding: 18px 22px;
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    border-bottom: 1px solid var(--border);
  }
  .modal-body {
    padding: 22px;
    overflow: auto;
  }
  .modal-foot {
    padding: var(--space-md) 22px;
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    border-top: 1px solid var(--border);
    background: var(--bg-sunken);
  }
</style>
