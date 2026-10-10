<!--
  Authored for fartola. Not ported from upstream.

  Sidebar nav row. Active state adds an accent left-bar + soft background
  per 01-UI-SPEC sketch (.nav-item.active). Tap-target pinned to
  var(--hit). The badge slot renders the small mono badge (history count
  on Avläsning, "IOF 3.0" on Export, etc.).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    active?: boolean;
    disabled?: boolean;
    icon?: Snippet;
    badge?: Snippet;
    onclick?: () => void;
    children?: Snippet;
  }

  let { active = false, disabled = false, icon, badge, onclick, children }: Props = $props();
</script>

<button
  type="button"
  class="nav-item"
  class:active
  {disabled}
  aria-current={active ? 'page' : undefined}
  onclick={() => !disabled && onclick?.()}
>
  {#if icon}
    <span class="nav-icon">{@render icon()}</span>
  {/if}
  <span class="nav-label">{@render children?.()}</span>
  {#if badge}
    <span class="badge">{@render badge()}</span>
  {/if}
</button>

<style>
  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px var(--space-sm);
    border-radius: 6px;
    color: var(--fg-muted);
    border: 0;
    background: transparent;
    text-align: left;
    width: 100%;
    min-height: var(--hit);
    font-size: 14px;
    position: relative;
  }
  .nav-item:hover {
    background: var(--bg-sunken);
    color: var(--fg);
  }
  .nav-item.active {
    background: var(--bg-sunken);
    color: var(--fg);
    font-weight: 600;
  }
  .nav-item.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 8px;
    bottom: 8px;
    width: 3px;
    border-radius: 2px;
    background: var(--fg);
  }
  .nav-item:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .nav-icon {
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .nav-label {
    flex: 1;
  }
  .badge {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 11px;
    background: var(--bg-sunken);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 5px;
    color: var(--fg-muted);
  }
</style>
