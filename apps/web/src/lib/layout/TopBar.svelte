<!--
  Authored for fartola. Not ported from upstream.

  Top bar — breadcrumb (callers feed via the `crumb` snippet),
  WS-connection PulseDot (variant bound to the prop), and the wall-clock
  Clock component. UI-SPEC §"Layout shell": 56px tall, --topbar-h.

  Brand mark lives in the sidebar; the topbar focuses on context +
  status. The PulseDot variant follows the readout convention:
    open    → green
    connecting → amber
    closed  → red
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import PulseDot from '../ui/PulseDot.svelte';
  import Icon from '../ui/Icon.svelte';
  import Clock from './Clock.svelte';
  import { t } from '../i18n/index.ts';

  type WsStatus = 'open' | 'connecting' | 'closed';

  interface Props {
    crumb?: Snippet | undefined;
    wsStatus?: WsStatus;
    showWs?: boolean;
    /** Mobile drawer trigger. When provided, a hamburger renders at the
     * left of the topbar but only at ≤1024px (CSS-gated). At desktop the
     * sidebar is permanently visible, so the hamburger is hidden even if
     * onMenu is set. */
    onMenu?: () => void;
    /** Two-way ref to the hamburger button. AppShell uses this for focus
     * restoration when the drawer closes — focus returns to the trigger
     * that opened the drawer (WCAG 2.4.3 + dialog pattern). */
    menuRef?: HTMLButtonElement | null;
  }

  let {
    crumb,
    wsStatus = 'closed',
    showWs = true,
    onMenu,
    menuRef = $bindable(null),
  }: Props = $props();

  const variant = $derived(
    wsStatus === 'open' ? 'green' : wsStatus === 'connecting' ? 'amber' : 'red'
  );

  const label = $derived(
    wsStatus === 'open' ? t('ro.online') : wsStatus === 'connecting' ? t('wiz.detecting') : t('ro.offline')
  );

  const color = $derived(
    wsStatus === 'open' ? 'var(--ok)' : wsStatus === 'connecting' ? 'var(--mp-fg)' : 'var(--dnf)'
  );
</script>

<header class="topbar">
  {#if onMenu}
    <button
      type="button"
      class="menu-btn"
      bind:this={menuRef}
      onclick={onMenu}
      aria-label={t('nav.menu')}
      data-testid="topbar-menu"
    >
      <Icon name="menu" size={22} />
    </button>
  {/if}
  {#if crumb}
    <div class="crumb">{@render crumb()}</div>
  {/if}
  <div class="spacer"></div>
  {#if showWs}
    <div class="ws-status" data-testid="ws-status">
      <PulseDot {variant} label={label} />
      <span class="ws-label" style="color: {color}">{label}</span>
    </div>
  {/if}
  <Clock />
</header>

<style>
  .topbar {
    height: var(--topbar-h);
    border-bottom: 1px solid var(--border);
    background: var(--bg-elev);
    padding: 0 var(--space-lg);
    display: flex;
    align-items: center;
    gap: var(--space-md);
    flex-shrink: 0;
  }
  /* Hamburger — appears only on viewports where AppShell collapses the
     sidebar. Keeps Settings reachable on mobile. */
  .menu-btn {
    display: none;
    width: 44px;
    height: 44px;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    color: var(--fg);
    border-radius: var(--radius);
    cursor: pointer;
    margin-left: calc(var(--space-lg) * -1 + var(--space-xs));
  }
  .menu-btn:hover,
  .menu-btn:focus-visible {
    background: var(--bg-sunken);
  }
  /* = DRAWER_MAX_PX in breakpoints.ts */
  @media (max-width: 1024px) {
    .topbar {
      padding: 0 var(--space-md);
    }
    .menu-btn {
      display: inline-flex;
    }
  }
  .crumb {
    font-size: var(--fs-label);
    color: var(--fg-muted);
  }
  :global(.crumb strong) {
    color: var(--fg);
    font-weight: 600;
  }
  .spacer {
    flex: 1;
  }
  .ws-status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .ws-label {
    font-weight: 500;
  }
</style>
