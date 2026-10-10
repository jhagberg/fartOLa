<!--
  Authored for fartola. Not ported from upstream.

  A failed load says what failed and offers a retry (ADR-0016 r6, audit
  RG-1, TV-2, HI-1). Used where a screen fetched nothing.
-->
<script lang="ts">
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  import { t } from '#lib/i18n/index.ts';

  let { message, onretry }: { message: string; onretry: () => void } = $props();
</script>

<p class="load-error" role="alert">
  <Icon name="alert-triangle" />
  <span>{message}</span>
  <Button variant="secondary" size="sm" onclick={onretry}>{t('common.retry')}</Button>
</p>

<style>
  .load-error {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin: 0;
    padding: 8px 12px;
    border: 1px solid var(--dnf);
    background: var(--dnf-soft);
    border-radius: var(--radius);
    color: var(--fg);
  }
</style>
