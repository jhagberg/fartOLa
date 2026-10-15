<!--
  Authored for fartola. Not ported from upstream.

  Label + control wrapper. Six-pixel gap per UI-SPEC §"Field rows" so
  the wizard form, the walk-up modal, and the receipt-template panel all
  use the exact same vertical rhythm.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    htmlFor?: string;
    hint?: string;
    children?: Snippet;
  }

  let { label, htmlFor, hint, children }: Props = $props();

  const hintId = $derived(htmlFor ? `${htmlFor}-hint` : undefined);

  // The control is the caller's, so add the hint id to its aria-describedby
  // here, next to any error id it already has. The observer re-adds it when
  // the caller's binding rewrites the attribute.
  $effect(() => {
    if (!hint || !htmlFor || !hintId) return;
    const el = document.getElementById(htmlFor);
    if (!el) return;
    const id = hintId;
    const add = () => {
      const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
      if (!ids.includes(id)) el.setAttribute('aria-describedby', [...ids, id].join(' '));
    };
    add();
    const obs = new MutationObserver(add);
    obs.observe(el, { attributes: true, attributeFilter: ['aria-describedby'] });
    return () => {
      obs.disconnect();
      const rest = (el.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .filter((x) => x && x !== id);
      if (rest.length) el.setAttribute('aria-describedby', rest.join(' '));
      else el.removeAttribute('aria-describedby');
    };
  });
</script>

<div class="field">
  <label for={htmlFor}>{label}</label>
  {@render children?.()}
  {#if hint}
    <small class="hint" id={hintId}>{hint}</small>
  {/if}
</div>

<style>
  .field {
    display: grid;
    gap: 6px;
  }
  label {
    font-size: var(--fs-label);
    color: var(--fg);
    font-weight: 500;
  }
  .hint {
    font-size: var(--fs-caption);
    color: var(--fg-muted);
  }
</style>
