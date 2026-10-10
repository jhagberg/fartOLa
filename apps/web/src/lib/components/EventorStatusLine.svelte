<!--
  Authored for fartola. Not ported from upstream.

  One line telling whether Eventor works: key missing, cache fresh or
  stale, offline. Icon plus words, never colour alone (ADR-0016 rules 5
  and 7). The refresh button shows only in FARTOLA_DEV builds.
-->
<script lang="ts">
  import Button from '../ui/Button.svelte';
  import Icon from '../ui/Icon.svelte';
  import { t } from '../i18n/index.ts';
  import {
    getEventorStatus,
    refreshEventorStatus,
    triggerEventorRefresh,
  } from '../stores/eventorStatus.svelte.ts';

  const status = $derived(getEventorStatus());

  $effect(() => {
    void refreshEventorStatus();
  });

  const label = $derived.by(() => {
    const s = status;
    if (s.state === 'ready' && s.ageDays !== null)
      return t('settings.eventor.ready', { days: s.ageDays });
    if (s.state === 'stale') return t('settings.eventor.stale');
    if (s.state === 'offline') return t('settings.eventor.offline');
    if (s.state === 'no_key') return t('settings.eventor.no_key');
    if (s.state === 'refreshing') return t('settings.eventor.refreshing');
    return t('settings.eventor.unknown');
  });
  const ok = $derived(status.state === 'ready');
  const bad = $derived(status.state === 'offline' || status.state === 'no_key');
</script>

<div class="status" data-testid="eventor-status-row">
  <span class="ico" class:ok class:bad aria-hidden="true">
    <Icon name={ok ? 'check' : bad ? 'alert-triangle' : 'info'} size={18} />
  </span>
  <span class="label" data-testid="eventor-status-label">{label}</span>
  {#if status.fartola_dev}
    <Button
      variant="ghost"
      onclick={() => void triggerEventorRefresh()}
      data-testid="eventor-refresh-btn"
    >
      {t('settings.eventor.refreshButton')}
    </Button>
  {/if}
</div>

<style>
  .status {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    flex-wrap: wrap;
    min-height: var(--hit);
  }
  .label {
    font-size: var(--fs-label);
    color: var(--fg);
    flex: 1;
    min-width: 0;
  }
  .ico {
    display: inline-flex;
    color: var(--fg-muted);
  }
  .ico.ok {
    color: var(--accent-strong);
  }
  .ico.bad {
    color: var(--dnf);
  }
</style>
