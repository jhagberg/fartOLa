<!--
  Authored for fartola. Not ported from upstream.

  SmartClubSearch — federation-club picker backed by /api/eventor/clubs?q=.
  FTS5 matches across name + short_name + media_name so an operator can
  type "stk" / "stora tuna" / "stortuna" and find Stora Tuna OK.

  Companion to SmartRunnerSearch — same popover affordances, same keyboard
  contract, same outside-click dismissal. The two components stay
  separate (rather than a single generic) because the row content + the
  picked-value normalisation differ enough that abstracting it adds
  more friction than it removes.

  Picking a row sets the input to the canonical `name` field, ignoring
  short_name / media_name (those are only there to broaden the MATCH,
  not to be displayed).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '#lib/i18n/index.ts';
  import { searchEventorClubs } from '#lib/api/client.ts';
  import type { EventorClubSuggestion } from '@fartola/shared-types';

  interface Props {
    value: string;
    id?: string;
    placeholder?: string;
    minLength?: number;
    /** Disables the input — used when the parent's Klubblös toggle is on. */
    disabled?: boolean;
    onValue: (next: string) => void;
    onPick: (s: EventorClubSuggestion) => void;
  }

  let {
    value,
    id = 'smart-club',
    placeholder = '',
    minLength = 2,
    disabled = false,
    onValue,
    onPick,
  }: Props = $props();

  let suggestions = $state<EventorClubSuggestion[]>([]);
  let open = $state(false);
  let highlight = $state(-1);
  let lastQuery = $state('');
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let rootEl: HTMLDivElement | null = $state(null);

  function scheduleFetch(q: string): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void doFetch(q);
    }, 200);
  }

  async function doFetch(q: string): Promise<void> {
    const trimmed = q.trim();
    lastQuery = trimmed;
    if (trimmed.length < minLength) {
      suggestions = [];
      open = false;
      return;
    }
    try {
      const res = await searchEventorClubs(trimmed, 8);
      if (lastQuery !== trimmed) return;
      suggestions = res.suggestions;
      highlight = suggestions.length > 0 ? 0 : -1;
      open = true;
    } catch {
      suggestions = [];
      open = false;
    }
  }

  function onInput(e: Event): void {
    const target = e.currentTarget as HTMLInputElement;
    onValue(target.value);
    scheduleFetch(target.value);
  }

  function pick(s: EventorClubSuggestion): void {
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

  function onFocus(): void {
    if (suggestions.length > 0) open = true;
  }
</script>

<div class="smart-club" bind:this={rootEl}>
  <input
    class="input"
    type="text"
    {id}
    {placeholder}
    {value}
    {disabled}
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

  {#if open && !disabled}
    <div
      class="popover"
      role="listbox"
      id={`${id}-listbox`}
      data-testid="smart-club-popover"
    >
      {#if suggestions.length === 0}
        <div class="empty">{t('smartSearch.noResults', { q: lastQuery })}</div>
      {:else}
        {#each suggestions as s, i (s.club_id)}
          <button
            type="button"
            role="option"
            id={`${id}-opt-${i}`}
            class="opt"
            class:active={i === highlight}
            aria-selected={i === highlight}
            onclick={() => pick(s)}
            onmouseenter={() => (highlight = i)}
            data-testid="smart-club-opt"
          >
            <div class="opt-main">
              <span class="opt-name">{s.name}</span>
              {#if s.short_name && s.short_name !== s.name}
                <span class="opt-sub">{s.short_name}</span>
              {/if}
            </div>
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .smart-club {
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
    outline: 2px solid var(--accent);
    outline-offset: -1px;
    border-color: var(--accent);
  }
  .input:disabled {
    background: var(--bg-sunken);
    color: var(--fg-faint);
    cursor: not-allowed;
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
    max-height: 280px;
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
    min-height: 44px;
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
</style>
