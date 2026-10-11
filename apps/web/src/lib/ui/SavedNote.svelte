<!--
  Authored for fartola. Not ported from upstream.

  Inline note next to a field that saves on change: Sparar… / Sparat /
  the error. Saved fades after 3 s; the error stays until the next change.
-->
<script lang="ts">
  import Icon from './Icon.svelte';
  import { t } from '#lib/i18n/index.ts';

  let {
    state: noteState,
    error = '',
  }: { state: 'idle' | 'saving' | 'saved' | 'error'; error?: string } = $props();

  let faded = $state(false);

  $effect(() => {
    faded = false;
    if (noteState !== 'saved') return;
    const timer = setTimeout(() => (faded = true), 3000);
    return () => clearTimeout(timer);
  });
</script>

<span class="wrap" aria-live={noteState === 'error' ? 'assertive' : 'polite'} aria-atomic="true">
  {#if noteState === 'error'}
    <span class="note err">
      <Icon name="alert-triangle" />
      <span>{error || t('common.unknownError')}</span>
    </span>
  {:else if noteState === 'saving'}
    <span class="note">{t('common.saving')}</span>
  {:else if noteState === 'saved' && !faded}
    <span class="note ok">
      <Icon name="check" />
      <span>{t('common.saved')}</span>
    </span>
  {/if}
</span>

<style>
  .note {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--fs-label);
    color: var(--fg-muted);
  }
  .ok {
    color: var(--ok);
  }
  .err {
    color: var(--dnf);
  }
</style>
