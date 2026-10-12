// Authored for fartola. Not ported from upstream.
//
// Module-scoped runes store for the operator's "active competition" —
// the workspace context for every comp-scoped surface (Avläsning, Anmälda,
// Resultat, Export, Hyrbrickor, Registrering). Backend already persists
// this in the `config` table; the store mirrors it so the sidebar nav
// and the pill switcher don't have to re-fetch on every render.
//
// Why this exists: clicking "Tävlingar" used to route to `/` and unset
// the URL-derived activeCompId, which silently disabled the rest of the
// nav. The pill makes the active competition explicit and survives that
// navigation. Per UX skill rule `back-stack-integrity` ("never silently
// reset the navigation stack or unexpectedly jump to home") and
// `empty-nav-state` ("explain why an unavailable destination is hidden,
// don't just hide it").
//
// Cross-tab consideration: a single laptop with a single browser tab
// is the supported configuration, so we don't ship a BroadcastChannel
// sync — if the operator opens a second tab, the second tab will hydrate
// from the same server state on mount.

import type { CompetitionDTO } from '@fartola/shared-types';
import {
  getActiveCompetition,
  setActiveCompetition,
  clearActiveCompetition,
  listCompetitions,
} from '../api/client.ts';

let _activeId = $state<string | null>(null);
let _list = $state<CompetitionDTO[]>([]);
let _initialized = $state(false);

export const activeCompetition = {
  get id(): string | null {
    return _activeId;
  },
  get value(): CompetitionDTO | null {
    if (_activeId === null) return null;
    return _list.find((c) => c.id === _activeId) ?? null;
  },
  get list(): CompetitionDTO[] {
    return _list;
  },
  get initialized(): boolean {
    return _initialized;
  },
  /** Fetch the persisted active competition + the full list from the
   * backend and populate the store. Idempotent — second call is a no-op
   * if already populated. Call this from +layout.svelte $effect so every
   * page sees the same hydrated state on first paint. */
  async init(): Promise<void> {
    if (_initialized) return;
    try {
      const [active, listed] = await Promise.all([getActiveCompetition(), listCompetitions()]);
      _list = listed.competitions;
      _activeId = active.competition_id;
    } catch {
      // Network error on first paint — the StationCard's reconnect path
      // already shows the operator that the edge is unreachable. Leave
      // the store empty; init() can be retried later.
    } finally {
      _initialized = true;
    }
  },
  /** Refresh the list (e.g. after creating a new competition). Keeps
   * the current activeId untouched. */
  async refreshList(): Promise<void> {
    try {
      const listed = await listCompetitions();
      _list = listed.competitions;
    } catch {
      // Soft fail — old list stays visible.
    }
  },
  /** Put a competition the backend just returned into the cached list (a
   * start, reset or undo), so the screen shows it without a list refetch
   * that may fail. */
  update(competition: CompetitionDTO): void {
    _list = _list.map((c) => (c.id === competition.id ? competition : c));
  },
  /** Switch the active competition. Calls the backend so the bridge
   * and other tabs see the same value. Throws on backend error so the
   * caller can surface a toast / disable the affected control. */
  async set(competitionId: string): Promise<void> {
    await setActiveCompetition(competitionId);
    _activeId = competitionId;
    // If the new id is not in our cached list (e.g. created in another
    // tab + selected from a deep link), refresh so the pill can render
    // its name.
    if (!_list.some((c) => c.id === competitionId)) {
      await this.refreshList();
    }
  },
  /** Clear the active competition. Used by the home picker when the
   * operator explicitly wants no scope (rare; mostly for tests). */
  async clear(): Promise<void> {
    await clearActiveCompetition();
    _activeId = null;
  },
  /** Sync the store from the URL when SvelteKit lands on a
   * /competition/:id/... route. Avoids a redundant server round-trip
   * if the id already matches. */
  async syncFromUrl(competitionId: string): Promise<void> {
    if (_activeId === competitionId) return;
    await this.set(competitionId);
  },
};
