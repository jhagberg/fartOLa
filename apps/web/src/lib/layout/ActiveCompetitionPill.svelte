<!--
  Authored for fartola. Not ported from upstream.

  Sidebar workspace switcher. Renders the operator's currently-active
  competition (name + date) as a tappable pill; clicking opens a dropdown
  with a search field + the full competition list, recent-first. Selecting
  an option calls activeCompetition.set(id) and navigates to that
  competition's readout.

  Pattern: Slack/Linear/Notion-style workspace switcher. The pill IS the
  context indicator AND the switcher in one widget. Per UX skill rules:

    - `nav-state-active` — always visible scope indicator (critical for
      rotating-operator desks where the next person needs to see which
      competition the bridge is bound to BEFORE reading a card)
    - `back-stack-integrity` — switching context never "jumps to home"
      silently; the operator chose this destination explicitly
    - `empty-nav-state` — when no competition is set yet, the pill says
      so plainly ("Välj tävling") instead of just disabling the rest
      of the nav with no explanation

  The full "Tävlingar" picker route is still available as a primary nav
  item below; this widget is the fast path for the common case ("switch
  while staying in the same view").
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { activeCompetition } from '../stores/activeCompetition.svelte.ts';
  import Icon from '../ui/Icon.svelte';
  import { t } from '../i18n/index.ts';

  let open = $state(false);
  let query = $state('');
  let switchError: string | null = $state(null);
  let triggerRef: HTMLButtonElement | null = $state(null);
  let panelRef: HTMLDivElement | null = $state(null);
  let searchRef: HTMLInputElement | null = $state(null);

  const active = $derived(activeCompetition.value);
  const list = $derived(activeCompetition.list);

  // Recent-first ordering. Created_at_ms is monotonic per row so this
  // gives a stable, no-locale-dependent sort. Filter by case-insensitive
  // substring on name + ISO date (the date format is fixed so a substring
  // match works without parsing).
  const filtered = $derived.by(() => {
    const sorted = [...list].sort((a, b) => b.created_at_ms - a.created_at_ms);
    const q = query.trim().toLowerCase();
    if (q.length === 0) return sorted;
    return sorted.filter((c) => c.name.toLowerCase().includes(q) || c.date.includes(q));
  });

  function toggle(): void {
    open = !open;
    if (open) {
      // Focus the search field after the panel renders so typing
      // starts filtering immediately. queueMicrotask waits for the
      // {#if open} block to mount.
      queueMicrotask(() => searchRef?.focus());
    }
  }

  function close(): void {
    if (!open) return;
    open = false;
    query = '';
    switchError = null;
    // Return focus to the trigger so subsequent Tab continues from a
    // predictable spot.
    triggerRef?.focus();
  }

  async function selectComp(id: string): Promise<void> {
    switchError = null;
    try {
      await activeCompetition.set(id);
      open = false;
      query = '';
      void goto(`/competition/${id}/readout`);
    } catch (e) {
      switchError = (e as Error).message;
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  function onWindowPointer(e: MouseEvent): void {
    if (!open) return;
    const target = e.target as Node | null;
    if (target === null) return;
    if (panelRef?.contains(target)) return;
    if (triggerRef?.contains(target)) return;
    close();
  }
</script>

<svelte:window on:keydown={onKey} on:pointerdown={onWindowPointer} />

<div class="pill-wrap">
  <button
    type="button"
    bind:this={triggerRef}
    class="pill"
    class:empty={active === null}
    onclick={toggle}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={active === null ? t('active.choose') : t('active.switch')}
    data-testid="active-comp-pill"
  >
    <div class="pill-inner">
      <span class="label">{t('active.label')}</span>
      {#if active === null}
        <span class="name muted">{t('active.empty')}</span>
        <span class="date muted">—</span>
      {:else}
        <span class="name" title={active.name}>{active.name}</span>
        <span class="date">{active.date}</span>
      {/if}
    </div>
    <Icon name="chevron-down" size={16} />
  </button>

  {#if open}
    <div
      bind:this={panelRef}
      class="panel"
      role="dialog"
      aria-label={t('active.switch')}
      data-testid="active-comp-panel"
    >
      <div class="search-row">
        <Icon name="search" size={14} />
        <input
          bind:this={searchRef}
          bind:value={query}
          type="search"
          class="search-input"
          placeholder={t('active.search.placeholder')}
          aria-label={t('active.search.placeholder')}
        />
      </div>

      {#if filtered.length === 0}
        <div class="empty-state">
          {query.length === 0 ? t('active.empty.list') : t('active.no.matches')}
        </div>
      {:else}
        <ul class="list" role="listbox" aria-label={t('active.switch')}>
          {#each filtered as comp (comp.id)}
            <li>
              <button
                type="button"
                class="row"
                class:current={comp.id === active?.id}
                onclick={() => void selectComp(comp.id)}
                role="option"
                aria-selected={comp.id === active?.id}
              >
                <span class="row-name">{comp.name}</span>
                <span class="row-date">{comp.date}</span>
                {#if comp.id === active?.id}
                  <span class="row-check"><Icon name="check" size={16} /></span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      {#if switchError}
        <div class="switch-error" role="alert">{switchError}</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .pill-wrap {
    position: relative;
    padding: 0 var(--space-sm) var(--space-sm);
  }
  .pill {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-xs);
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
    text-align: left;
    min-height: 44px;
  }
  .pill:hover {
    background: var(--bg-hover, var(--bg-elev));
  }
  .pill:focus-visible {
    outline: 2px solid var(--fg);
    outline-offset: 2px;
  }
  .pill[aria-expanded='true'] {
    border-color: var(--mp);
  }
  .pill-inner {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: baseline;
    gap: 2px var(--space-xs);
    min-width: 0;
    flex: 1;
  }
  .label {
    grid-column: 1 / -1;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
    font-weight: 600;
    line-height: 1;
  }
  .name {
    font-size: 13px;
    font-weight: 600;
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .name.muted {
    color: var(--fg-muted);
    font-weight: 500;
  }
  .date {
    font-size: 11px;
    color: var(--fg-faint);
    font-family: var(--font-mono);
    font-feature-settings: 'tnum' 1;
  }
  .date.muted {
    color: var(--fg-faint);
  }

  .panel {
    position: absolute;
    top: calc(100% + 4px);
    left: var(--space-sm);
    right: var(--space-sm);
    z-index: 70;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.15));
    max-height: 320px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .search-row {
    display: flex;
    align-items: center;
    gap: var(--space-2xs);
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    color: var(--fg-muted);
  }
  .search-input {
    flex: 1;
    border: 0;
    background: transparent;
    color: var(--fg);
    font: inherit;
    font-size: var(--fs-label);
    min-height: var(--hit);
  }
  .search-input::placeholder {
    color: var(--fg-faint);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    overflow: auto;
    flex: 1;
  }
  .row {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: baseline;
    gap: var(--space-xs);
    padding: 8px 10px;
    border: 0;
    background: transparent;
    color: var(--fg);
    font: inherit;
    font-size: var(--fs-label);
    text-align: left;
    cursor: pointer;
    min-height: var(--hit);
  }
  .row:hover,
  .row:focus-visible {
    background: var(--bg-hover, rgba(120, 120, 140, 0.08));
  }
  .row.current {
    background: rgba(120, 120, 200, 0.08);
  }
  .row-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  .row-date {
    font-size: 11px;
    color: var(--fg-faint);
    font-family: var(--font-mono);
    font-feature-settings: 'tnum' 1;
  }
  .row-check {
    color: var(--mp);
    font-size: 10px;
  }
  .empty-state {
    padding: var(--space-md) var(--space-sm);
    text-align: center;
    font-size: 12px;
    color: var(--fg-faint);
  }
  .switch-error {
    padding: 8px 10px;
    border-top: 1px solid var(--border);
    color: var(--dnf);
    font-size: 11px;
    word-break: break-word;
  }
</style>
