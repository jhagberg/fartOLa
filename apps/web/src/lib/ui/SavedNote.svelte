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

{#if noteState === 'error'}
  <span class="note err" role="alert">
    <Icon name="alert-triangle" />
    <span>{error || t('common.unknownError')}</span>
  </span>
{:else if noteState === 'saving'}
  <span class="note" role="status">{t('common.saving')}</span>
{:else if noteState === 'saved' && !faded}
  <span class="note ok" role="status">
    <Icon name="check" />
    <span>{t('common.saved')}</span>
  </span>
{/if}

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
