<!--
  Authored for fartola. Not ported from upstream.

  Free-text club input backed by a <datalist> populated from /api/clubs?prefix=.
  Used by the walk-up modal (UI-SPEC §"Walk-up modal"). The DOM-native
  <datalist> gives us the keyboard-arrow + filter UX for free; we only
  refetch suggestions on each keystroke after a 200ms debounce so the
  edge doesn't get hammered on rapid typing.

  Locked by:
  - 01-14-PLAN.md task 1 (Walk-up modal + ClubAutocomplete)
  - 01-UI-SPEC.md §"Walk-up modal" — free-text + autocomplete from past entries
-->
<script lang="ts">
  import { listClubs } from '#lib/api/client.ts';

  interface Props {
    value: string;
    id?: string;
    placeholder?: string;
    onValue: (next: string) => void;
  }

  let { value, id = 'club-input', placeholder = '', onValue }: Props = $props();

  let suggestions: string[] = $state([]);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const listId = $derived(`${id}-list`);

  function scheduleFetch(prefix: string): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void doFetch(prefix);
    }, 200);
  }

  async function doFetch(prefix: string): Promise<void> {
    try {
      const trimmed = prefix.trim();
      const res = trimmed.length > 0 ? await listClubs(trimmed, 50) : await listClubs(undefined, 50);
      suggestions = res.clubs.map((c) => c.name);
    } catch {
      // Soft fail — autocomplete is non-essential.
      suggestions = [];
    }
  }

  function onInput(e: Event): void {
    const target = e.currentTarget as HTMLInputElement;
    onValue(target.value);
    scheduleFetch(target.value);
  }

  // Prime the list with the most-recent clubs on first render so the
  // operator sees suggestions without having to type first.
  void doFetch('');
</script>

<input
  class="input"
  type="text"
  {id}
  list={listId}
  data-testid="walkup-club"
  {placeholder}
  {value}
  oninput={onInput}
  autocomplete="off"
/>
<datalist id={listId}>
  {#each suggestions as name (name)}
    <option value={name}></option>
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
    outline: 2px solid var(--fg);
    outline-offset: 2px;
    border-color: var(--accent);
  }
</style>
