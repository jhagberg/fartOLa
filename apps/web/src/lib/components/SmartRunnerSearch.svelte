<!--
  Authored for fartola. Not ported from upstream.

  SmartRunnerSearch — replaces the <datalist>-backed EventorAutocomplete
  for the manual-add flow (and any new picker). Two breakthroughs over
  the old component:

   1. Smart input dispatch — if the operator types digits only (≥3), we
      route to /api/eventor/lookup?si_card= for a single-card hit. If
      they type letters, we route to /api/eventor/lookup?q= for FTS5
      fuzzy matching (diacritic folded, word-order free).

   2. Custom popover (not <datalist>) so each row can render rich content:
      name + klubb + birth year + card chip. Datalist could only put it
      all into one <option value> string.

  Keyboard: ArrowDown/ArrowUp navigate, Enter picks, Esc closes. Touch:
  tap-to-pick. Outside-click closes. The popover is positioned absolutely
  below the input — caller supplies parent container with position: relative.

  Backed by /api/eventor/lookup (FTS5). 200ms debounce.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '#lib/i18n/index.ts';
  import {
    searchEventorCompetitors,
    lookupEventorBySiCard,
  } from '#lib/api/client.ts';
  import type { EventorNameSuggestion } from '@fartola/shared-types';

  interface Props {
    value: string;
    id?: string;
    placeholder?: string;
    /** Min characters before we start hitting the API for the name path.
     * Digits skip this gate (we hit si_card lookup as soon as ≥3 digits). */
    minLength?: number;
    /** Optional federation club narrowing. When set, the name path
     * passes club_id to the backend so a common name returns only
     * matches inside that club (drowns-by-rank fix for the Lägg-till
     * sheet when the operator has already picked a club). Null/undefined
     * = unscoped global search. */
    clubId?: number | null;
    /** Operator typed — keep upstream value in sync but don't auto-pick. */
    onValue: (next: string) => void;
    /** Operator picked a suggestion (mouse tap, keyboard Enter, or si_card
     * exact hit). Caller fills the form from the payload. */
    onPick: (s: EventorNameSuggestion) => void;
    /** Optional: render the "no results" empty state inside the popover. */
    showNoResults?: boolean;
  }

  let {
    value,
    id = 'smart-search',
    placeholder = '',
    minLength = 2,
    clubId = null,
    onValue,
    onPick,
    showNoResults = true,
  }: Props = $props();

  let suggestions = $state<EventorNameSuggestion[]>([]);
  let open = $state(false);
  let highlight = $state(-1);
  let loading = $state(false);
  let lastQuery = $state('');
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let inputEl: HTMLInputElement | null = $state(null);
  let popoverEl: HTMLDivElement | null = $state(null);
  let rootEl: HTMLDivElement | null = $state(null);

  function isDigitsOnly(s: string): boolean {
    return /^\d+$/.test(s);
  }

  function scheduleFetch(q: string): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void doFetch(q);
    }, 200);
  }

  async function doFetch(q: string): Promise<void> {
    const trimmed = q.trim();
    lastQuery = trimmed;
    if (trimmed.length === 0) {
      suggestions = [];
      open = false;
      return;
    }
    // Digit path — si_card lookup. 3+ digits keeps single-digit fat-fingers
    // out of the API while letting 4-digit SI cards (legacy, e.g. 9961) hit.
    if (isDigitsOnly(trimmed) && trimmed.length >= 3) {
      loading = true;
      try {
        const hit = await lookupEventorBySiCard(Number(trimmed));
        if (lastQuery !== trimmed) return; // stale response — caller typed more
        if (hit.hit === true) {
          suggestions = [
            {
              person_id: hit.person_id,
              family_name: hit.family_name,
              given_name: hit.given_name,
              club_name: hit.club_name,
              si_card: Number(trimmed),
              birth_year: hit.birth_year ?? null,
            },
          ];
          highlight = 0;
          open = true;
        } else if (hit.hit === 'many') {
          // si_card resolved to >1 candidate (family-shared / replacement
          // cards). Surface all of them so the operator picks the right
          // one — auto-picking the first row would silently mis-attribute.
          const card = Number(trimmed);
          suggestions = hit.candidates.map((c) => ({
            person_id: c.person_id,
            family_name: c.family_name,
            given_name: c.given_name,
            club_name: c.club_name,
            si_card: card,
            birth_year: c.birth_year ?? null,
          }));
          highlight = 0;
          open = true;
        } else {
          suggestions = [];
          open = showNoResults;
        }
      } catch {
        suggestions = [];
        open = false;
      } finally {
        if (lastQuery === trimmed) loading = false;
      }
      return;
    }
    // Letter path — FTS5 fuzzy. Gate < minLength to spare the backend.
    if (trimmed.length < minLength) {
      suggestions = [];
      open = false;
      return;
    }
    loading = true;
    try {
      const res = await searchEventorCompetitors(
        trimmed,
        50,
        clubId ?? undefined
      );
      if (lastQuery !== trimmed) return;
      suggestions = res.suggestions;
      highlight = suggestions.length > 0 ? 0 : -1;
      open = showNoResults || suggestions.length > 0;
    } catch {
      suggestions = [];
      open = false;
    } finally {
      if (lastQuery === trimmed) loading = false;
    }
  }

  function onInput(e: Event): void {
    const target = e.currentTarget as HTMLInputElement;
    const next = target.value;
    onValue(next);
    scheduleFetch(next);
  }

  function pick(s: EventorNameSuggestion): void {
    onPick(s);
    open = false;
    suggestions = [];
  }

  function onKey(e: KeyboardEvent): void {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      if (suggestions.length > 0) {
        open = true;
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlight = Math.min(highlight + 1, suggestions.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlight = Math.max(highlight - 1, 0);
    } else if (e.key === 'Enter') {
      const target = highlight >= 0 ? suggestions[highlight] : undefined;
      if (target !== undefined) {
        e.preventDefault();
        pick(target);
      }
    } else if (e.key === 'Escape') {
      open = false;
    }
  }

  function onDocClick(e: MouseEvent): void {
    if (!rootEl) return;
    if (!rootEl.contains(e.target as Node)) {
      open = false;
    }
  }

  onMount(() => {
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  });

  // Refetch when the club filter changes mid-flow. Operator typed "per"
  // unscoped, saw all clubs, then picked "Stora Tuna OK" — popover should
  // immediately narrow without forcing them to retype. We rely on the
  // 200ms debounce inside scheduleFetch to coalesce rapid clubId churn
  // (e.g. operator scrolling through SmartClubSearch options).
  $effect(() => {
    void clubId;
    if (lastQuery.length > 0 && !/^\d+$/.test(lastQuery)) {
      scheduleFetch(lastQuery);
    }
  });

  // Re-open if focus returns to the input and we already have results.
  function onFocus(): void {
    if (suggestions.length > 0) open = true;
  }
</script>

<div class="smart-search" bind:this={rootEl}>
  <input
    class="input"
    type="text"
    {id}
    bind:this={inputEl}
    {placeholder}
    {value}
    oninput={onInput}
    onkeydown={onKey}
    onfocus={onFocus}
    autocomplete="off"
    autocorrect="off"
    autocapitalize="off"
    spellcheck="false"
    data-testid={id}
    aria-expanded={open}
    aria-haspopup="listbox"
    aria-controls={open ? `${id}-listbox` : undefined}
    aria-activedescendant={highlight >= 0 ? `${id}-opt-${highlight}` : undefined}
    role="combobox"
  />

  {#if open}
    <div
      bind:this={popoverEl}
      class="popover"
      role="listbox"
      id={`${id}-listbox`}
      data-testid="smart-search-popover"
    >
      {#if suggestions.length === 0 && !loading}
        <div class="empty">{t('smartSearch.noResults', { q: lastQuery })}</div>
      {:else}
        {#each suggestions as s, i (s.person_id)}
          <button
            type="button"
            role="option"
            id={`${id}-opt-${i}`}
            class="opt"
            class:active={i === highlight}
            aria-selected={i === highlight}
            onclick={() => pick(s)}
            onmouseenter={() => (highlight = i)}
            data-testid="smart-search-opt"
          >
            <div class="opt-main">
              <span class="opt-name">
                {s.family_name}, {s.given_name}
              </span>
              <span class="opt-sub">
                {s.club_name ?? t('smartSearch.noClub')}
              </span>
            </div>
            {#if s.si_card !== null}
              <span class="opt-card mono">{s.si_card}</span>
            {/if}
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .smart-search {
    position: relative;
    width: 100%;
  }
  .input {
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
  .input:focus {
    outline: 2px solid var(--fg);
    outline-offset: 2px;
    border-color: var(--accent);
  }
  .popover {
    position: absolute;
    top: calc(var(--hit) + 4px);
    left: 0;
    right: 0;
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    z-index: 60;
    max-height: 320px;
    overflow-y: auto;
    overscroll-behavior: contain;
    display: flex;
    flex-direction: column;
    padding: 4px;
  }
  .empty {
    padding: 12px 14px;
    color: var(--fg-muted);
    font-style: italic;
    font-size: 13px;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: 10px 12px;
    background: transparent;
    border: 0;
    border-radius: calc(var(--radius) - 2px);
    text-align: left;
    cursor: pointer;
    min-height: 48px;
    color: var(--fg);
  }
  .opt:hover,
  .opt.active {
    background: var(--bg-sunken);
  }
  .opt-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .opt-name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .opt-sub {
    color: var(--fg-muted);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .opt-card {
    font-family: var(--font-mono);
    font-feature-settings:
      'tnum' 1,
      'zero' 1;
    font-size: 12px;
    padding: 3px 8px;
    background: var(--bg-sunken);
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--fg);
  }
  .mono {
    font-family: var(--font-mono);
  }
</style>
