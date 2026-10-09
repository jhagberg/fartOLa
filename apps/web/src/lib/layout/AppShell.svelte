<!--
  Authored for fartola. Not ported from upstream.

  Two-column app shell. Locked dimensions:
    grid-template-columns: var(--sidebar-w) 1fr  (240px sidebar)
    topbar: var(--topbar-h)                       (56px topbar)
  per 01-UI-SPEC.md §"Layout shell" + sketches/app.jsx lines 100-145.

  Drawer mode (≤1024px, phones and tablets): sidebar collapses to an
  off-canvas drawer triggered by a hamburger in TopBar. This restores Settings + TweaksPanel access on
  phones (without it, the entire /installningar route was unreachable +
  high-contrast bright-sun mode was a desktop-only toggle).

  AppShell owns drawer state because it sits between the route-level
  +layout.svelte (which owns Nav callbacks) and the structural Sidebar /
  TopBar children.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Sidebar from './Sidebar.svelte';
  import TopBar from './TopBar.svelte';
  import Icon from '../ui/Icon.svelte';
  import { t } from '../i18n/index.ts';
  import { DRAWER_QUERY } from './breakpoints.ts';

  type WsStatus = 'open' | 'connecting' | 'closed';
  type StationStatus = 'online' | 'offline' | 'connecting';

  interface Props {
    route?: string;
    onNavigate?: (route: string) => void;
    onOpenSettings?: () => void;
    wsStatus?: WsStatus;
    stationStatus?: StationStatus;
    stationSerial?: string;
    readoutBadge?: number | null;
    /** Forwarded to Sidebar so competition-scoped nav items (Avläsning,
     * Anmälda, Resultat, Export, Hyrbrickor) can disable when null. */
    activeCompId?: string | null;
    crumb?: Snippet;
    children?: Snippet;
  }

  let {
    route = 'home',
    onNavigate,
    onOpenSettings,
    wsStatus = 'closed',
    stationStatus = 'offline',
    stationSerial = '—',
    readoutBadge = null,
    activeCompId = null,
    crumb,
    children,
  }: Props = $props();

  let drawerOpen = $state(false);
  /** True in drawer mode; the closed drawer is then inert (no Tab stops
   * in an off-screen sidebar, WCAG 2.4.3). */
  let narrow = $state(false);
  $effect(() => {
    const mq = window.matchMedia(DRAWER_QUERY);
    narrow = mq.matches;
    const onChange = (e: MediaQueryListEvent) => {
      narrow = e.matches;
      // Widening past the breakpoint hides the drawer; a drawer left open
      // would keep <main> inert with no visible way to close it.
      if (!e.matches) drawerOpen = false;
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  });
  /** Element refs for focus management. When the drawer opens we move
   * focus to the close button so screen readers + keyboard users land
   * inside the drawer instead of on the hidden-behind-scrim hamburger.
   * On close we restore focus to wherever it was. */
  let hamburgerRef: HTMLButtonElement | null = $state(null);
  let drawerCloseRef: HTMLButtonElement | null = $state(null);

  function openDrawer(): void {
    drawerOpen = true;
    // Defer until after the {#if} block renders the close button.
    queueMicrotask(() => drawerCloseRef?.focus());
  }
  function closeDrawer(): void {
    drawerOpen = false;
    // Return focus to the hamburger so subsequent Tab continues from a
    // sane spot. queueMicrotask is unnecessary here — the button stays
    // mounted; we just need to focus it.
    hamburgerRef?.focus();
  }

  /** Wrap nav callbacks so a tap on a drawer item navigates AND closes
   * the drawer in one shot (the drawer is decoration, not a destination). */
  function handleNavigate(r: string): void {
    closeDrawer();
    onNavigate?.(r);
  }
  function handleOpenSettings(): void {
    closeDrawer();
    onOpenSettings?.();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && drawerOpen) closeDrawer();
  }
</script>

<svelte:window on:keydown={onKey} />

<a href="#main" class="skip-link">{t('a11y.skipToContent')}</a>

<div class="app" class:drawer-open={drawerOpen}>
  <div class="sidebar-slot" inert={narrow && !drawerOpen}>
    <Sidebar
      {route}
      onNavigate={handleNavigate}
      onOpenSettings={handleOpenSettings}
      {stationStatus}
      {stationSerial}
      {readoutBadge}
      {activeCompId}
    />
  </div>

  <!-- Mobile-only scrim. role=presentation so screen readers don't see it
       as content; the dialog semantics ride on the .sidebar-slot above
       (the Sidebar's <aside> already announces correctly). -->
  {#if drawerOpen}
    <div
      class="drawer-scrim"
      role="presentation"
      onclick={closeDrawer}
      data-testid="drawer-scrim"
    ></div>
    <button
      type="button"
      class="drawer-close"
      bind:this={drawerCloseRef}
      onclick={closeDrawer}
      aria-label={t('nav.close')}
      data-testid="drawer-close"
    >
      <Icon name="x" size={22} />
    </button>
  {/if}

  <!-- inert when drawer open: prevents Tab leaking back into the readout
       behind the scrim (WCAG 2.4.3). The hamburger lives inside TopBar
       which lives inside <main>, so opening the drawer also inert's the
       trigger — fine, because focus has already moved to the drawer's
       close button via openDrawer's queueMicrotask. closeDrawer restores
       focus to hamburgerRef AFTER drawerOpen=false re-enables main. -->
  <main class="main" id="main" inert={drawerOpen ? true : undefined}>
    <TopBar {crumb} {wsStatus} onMenu={openDrawer} bind:menuRef={hamburgerRef} />
    <div class="content">
      {@render children?.()}
    </div>
  </main>
</div>

<style>
  .app {
    display: grid;
    grid-template-columns: var(--sidebar-w) 1fr;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
  }
  .sidebar-slot {
    display: contents;
  }
  .main {
    overflow: auto;
    display: flex;
    flex-direction: column;
  }
  .content {
    padding: var(--space-lg);
    flex: 1;
    overflow: auto;
  }

  /* Mobile drawer mode. Sidebar lifts out of the grid into a fixed off-
     canvas position so we can slide it in over the content. The TopBar
     hamburger is gated by the same breakpoint. */
  /* = DRAWER_MAX_PX in breakpoints.ts */
  @media (max-width: 1024px) {
    .app {
      /* Single source-of-truth width — used by sidebar-slot AND
         drawer-close so they stay in sync if we ever bump the size. */
      --drawer-w: min(280px, 80vw);
      grid-template-columns: 1fr;
    }
    .sidebar-slot {
      display: block;
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      width: var(--drawer-w);
      z-index: 60;
      transform: translateX(-100%);
      transition: transform 220ms ease-out;
      background: var(--bg-elev);
      box-shadow: var(--shadow-lg);
    }
    .app.drawer-open .sidebar-slot {
      transform: translateX(0);
    }
    .drawer-scrim {
      position: fixed;
      inset: 0;
      background: rgba(20, 20, 30, 0.32);
      z-index: 55;
      backdrop-filter: blur(2px);
    }
    .drawer-close {
      position: fixed;
      top: 8px;
      left: calc(var(--drawer-w) + 12px);
      z-index: 65;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: 0;
      background: var(--bg-elev);
      color: var(--fg);
      box-shadow: var(--shadow-md);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .content {
      padding: var(--space-md);
    }
  }
</style>
