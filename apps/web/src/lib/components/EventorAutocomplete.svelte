<!--
  Authored for fartola. Not ported from upstream.

  Free-text name input backed by a <datalist> populated from
  /api/eventor/lookup?prefix=. Used by WalkupModal as the name-field
  autocomplete source. Mirror of ClubAutocomplete.svelte's structure —
  the only differences are:

    1. minLength gate of 2. The Eventor cache holds ~252 919 names; a
       single-character prefix would dominate the wire AND the picker
       UX, so the typing experience is gated server-cheap.
    2. The picker carries the FULL EventorNameSuggestion (incl. club_name
       + si_card) so the parent (WalkupModal) can side-effect-populate
       the klubb field on selection. The visible <option value> renders
       "Family, Given (Klubb)" so the operator sees disambiguation; the
       parent reads onPick(suggestion) for the structured payload.

  Locked by:
  - .planning/phases/02-4-klubbs-mvp/02-02-PLAN.md task 3
  - .planning/phases/02-4-klubbs-mvp/02-RESEARCH.md §"Pattern 5: WalkupModal
    Hyrbricka extension" (minLength 2 gate; debounced fetch)
-->
<script lang="ts">
  import { lookupEventorByPrefix } from '#lib/api/client.ts';
  import type { EventorNameSuggestion } from '@fartola/shared-types';

  interface Props {
    value: string;
    id?: string;
    placeholder?: string;
    /** Operator typed into the input — parent updates its own name state. */
    onValue: (next: string) => void;
    /** Operator picked a suggestion — parent reads club_name etc. to
     * pre-fill the rest of the form. */
    onPick?: (suggestion: EventorNameSuggestion) => void;
  }

  let { value, id = 'eventor-input', placeholder = '', onValue, onPick }: Props = $props();

  let suggestions: EventorNameSuggestion[] = $state([]);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const listId = $derived(`${id}-list`);

  /** Build the display value for a suggestion row. The value attribute
   * is what populates the input on selection, so we keep "Family, Given"
   * canonical; the (Klubb) suffix is decorative but datalist surfaces
   * the value as-is. */
  function displayValue(s: EventorNameSuggestion): string {
    const base = `${s.family_name}, ${s.given_name}`;
    return s.club_name ? `${base} (${s.club_name})` : base;
  }

  function scheduleFetch(prefix: string): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void doFetch(prefix);
    }, 200);
  }

  async function doFetch(prefix: string): Promise<void> {
    const trimmed = prefix.trim();
    // minLength 2 gate — see header comment.
    if (trimmed.length < 2) {
      suggestions = [];
      return;
    }
    try {
      const res = await lookupEventorByPrefix(trimmed, 20);
      suggestions = res.suggestions;
    } catch {
      // Soft fail — autocomplete is non-essential.
      suggestions = [];
    }
  }

  function onInput(e: Event): void {
    const target = e.currentTarget as HTMLInputElement;
    const next = target.value;
    onValue(next);
    // Detect a "pick from datalist" event: the typed value exactly
    // matches one of the rendered display values. This is the only
    // reliable cross-browser signal for a datalist selection — there is
    // no native `pickedfromlist` event.
    const matched = suggestions.find((s) => displayValue(s) === next);
    if (matched && onPick) {
      // Normalise the input value to the canonical "Family, Given" form
      // so the (Klubb) decoration doesn't leak into the form payload.
      const canonical = `${matched.family_name}, ${matched.given_name}`;
      if (canonical !== next) {
        onValue(canonical);
      }
      onPick(matched);
      return;
    }
    scheduleFetch(next);
  }
</script>

<input
  class="input"
  type="text"
  {id}
  list={listId}
  data-testid="walkup-name"
  {placeholder}
  {value}
  oninput={onInput}
  autocomplete="off"
/>
<datalist id={listId}>
  {#each suggestions as s (s.person_id)}
    <option value={displayValue(s)}></option>
  {/each}
</datalist>

<style>
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
</style>
