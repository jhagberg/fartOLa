<!--
  Authored for fartola. Not ported from upstream.

  Root SvelteKit layout. Plan 11 lands the visual baseline:
    - imports the design tokens + font stack so every route sees the same
      CSS variable surface
    - bootstraps i18next synchronously (RESEARCH §Pitfall 10 — avoid the
      flash-of-English on first paint) by importing the i18n bootstrap
      module for its side effect
    - wraps the route slot in <AppShell> so the 240px sidebar + 56px topbar
      + content grid is the default visual chrome
    - mounts a TweaksPanel (toggled from the sidebar Inställningar item)
      so locale/density/accent/contrast/font-pair changes are operator-
      reachable from any route
    - reacts to tweaks-store mutations via $effect — applyTweaksToRoot
      writes data-accent / data-density / data-font-pair attributes on
      <html> so tokens.css attribute selectors pick the right overrides

  Plans 12-14 add real routing + WS-status wiring; for now the AppShell's
  WS PulseDot stays in its 'closed' default and the SI bridge card shows
  'offline' — the +page.svelte walking-skeleton view owns its own WS
  client because the walking-skeleton uses a synthetic competition_id.
-->
<script lang="ts">
  import '../lib/styles/fonts.css';
  import '../lib/tokens.css';
  // Side-effect import — runs i18next.init() at module-load before any child
  // component calls t(). Locked by RESEARCH §Pitfall 10.
  import '../lib/i18n/index.ts';
  import AppShell from '../lib/layout/AppShell.svelte';
  import TweaksPanel from '../lib/components/TweaksPanel.svelte';
  import { tweaks, applyTweaksToRoot } from '../lib/stores/tweaks.svelte.ts';
  import {
    bridgeStatus,
    toStationStatus,
    toWsStatus,
  } from '../lib/stores/bridgeStatus.svelte.ts';
  import { activeCompetition } from '../lib/stores/activeCompetition.svelte.ts';
  import { getBridgeStatus } from '../lib/api/client.ts';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';

  let { children } = $props();

  let tweaksOpen = $state(false);

  // Active competition id: prefer the URL when we're inside
  // /competition/[id]/... so deep-links and bookmarks stay authoritative.
  // Fall back to the activeCompetition store (which mirrors the backend
  // session pointer) so navigating to "Tävlingar" (path '/') no longer
  // unsets scope and silently disables every comp-scoped nav item. The
  // store is initialised in the $effect below; until it resolves the
  // URL value is the only source.
  const urlCompId = $derived.by(() => {
    const m = page.url.pathname.match(/^\/competition\/([^/]+)/);
    return m?.[1] ?? null;
  });
  const activeCompId = $derived(urlCompId ?? activeCompetition.id);

  // Map URL → sidebar route prop so the active item highlights correctly.
  // /import is a deep-link redirect that lands on /runners with the import
  // sheet open — highlight the same sidebar item the redirect lands on.
  const navRoute = $derived.by(() => {
    const p = page.url.pathname;
    if (p === '/') return 'home';
    if (p.endsWith('/readout')) return 'readout';
    if (p.endsWith('/runners') || p.endsWith('/import')) return 'runners';
    if (p.endsWith('/registration')) return 'registration';
    if (p.endsWith('/lottning')) return 'lottning';
    if (p.endsWith('/results')) return 'results';
    if (p.endsWith('/export')) return 'export';
    if (p.endsWith('/hyrbrickor')) return 'hyrbrickor';
    if (p.endsWith('/eventor-publish')) return 'eventor-publish';
    if (p.endsWith('/kvar-i-skogen')) return 'kvariskov';
    if (p.endsWith('/info')) return 'info';
    return 'home';
  });

  function handleNavigate(route: string): void {
    if (route === 'home') {
      void goto('/');
      return;
    }
    if (activeCompId === null) {
      // No competition selected — fall back to the home picker.
      void goto('/');
      return;
    }
    if (route === 'readout') void goto(`/competition/${activeCompId}/readout`);
    else if (route === 'runners') void goto(`/competition/${activeCompId}/runners`);
    else if (route === 'registration')
      void goto(`/competition/${activeCompId}/registration`);
    else if (route === 'lottning') void goto(`/competition/${activeCompId}/lottning`);
    else if (route === 'results') void goto(`/competition/${activeCompId}/results`);
    else if (route === 'export') void goto(`/competition/${activeCompId}/export`);
    else if (route === 'hyrbrickor') void goto(`/competition/${activeCompId}/hyrbrickor`);
    else if (route === 'eventor-publish')
      void goto(`/competition/${activeCompId}/eventor-publish`);
    else if (route === 'kvariskov')
      void goto(`/competition/${activeCompId}/kvar-i-skogen`);
    else if (route === 'info') void goto(`/competition/${activeCompId}/info`);
  }

  // Mirror the tweaks store onto <html> attributes whenever any preference
  // changes. The accessor patterns (`tweaks.accent` etc.) make Svelte 5's
  // signal tracker subscribe; the effect re-runs on any mutation.
  $effect(() => {
    if (typeof document === 'undefined') return;
    // Read every field so $effect tracks them all.
    void tweaks.accent;
    void tweaks.density;
    void tweaks.font_pair;
    void tweaks.contrast_high;
    applyTweaksToRoot(document.documentElement);
  });

  // Hydrate the activeCompetition store on first paint. Subsequent
  // navigation to /competition/X/... syncs the URL id back into the
  // store so the sidebar pill always mirrors the current workspace.
  $effect(() => {
    if (typeof document === 'undefined') return;
    void activeCompetition.init();
  });
  $effect(() => {
    if (urlCompId !== null && activeCompetition.initialized) {
      void activeCompetition.syncFromUrl(urlCompId);
    }
  });

  // Global SI-bridge connection poll. ReadoutView gets sub-second updates
  // via its WS connection_changed handler; every OTHER page (e.g. /import,
  // /settings, /) used to sit at the initial 'closed' value because nothing
  // wrote to the store. Polling /api/bridge/status every 2s closes that gap
  // so the sidebar StationCard + topbar PulseDot mirror real hardware state
  // regardless of route. Pause when the tab is hidden to avoid background
  // chatter; resume on visibilitychange.
  $effect(() => {
    if (typeof document === 'undefined') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick(): Promise<void> {
      if (cancelled) return;
      try {
        const bs = await getBridgeStatus();
        bridgeStatus.set(bs.state);
      } catch {
        // Edge unreachable → treat as closed so the StationCard shows the
        // right visual state and the Reconnect button is offered.
        bridgeStatus.set('closed');
      }
      if (cancelled) return;
      timer = setTimeout(tick, 2000);
    }
    function onVisibility(): void {
      if (document.hidden) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      } else if (timer === null && !cancelled) {
        void tick();
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  });
</script>

<AppShell
  onOpenSettings={() => (tweaksOpen = true)}
  onNavigate={handleNavigate}
  route={navRoute}
  {activeCompId}
  stationStatus={toStationStatus(bridgeStatus.value)}
  wsStatus={toWsStatus(bridgeStatus.value)}
>
  {@render children()}
</AppShell>

<TweaksPanel open={tweaksOpen} onClose={() => (tweaksOpen = false)} />
