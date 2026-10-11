<!--
  Authored for fartola. Not ported from upstream.

  Wall-clock ticker. UI-SPEC §"Visual Anchors" — formats local time as
  HH:MM:SS in mono, ticks once per second via setInterval inside
  `$effect`. The cleanup return clears the interval on unmount so
  results-fullscreen mode (plan 14) which mounts/unmounts the clock
  doesn't leak timers.

  Phase 1 reads the laptop's `Date.now()` directly. The Phase 0 NDJSON
  events carry a bridge-derived event_time_ms but Phase 1 doesn't sync
  to it — the bridge IS the laptop here so clock-skew is zero by
  construction. Phase 2/3 LAN setups can add a sync path later.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../i18n/index.ts';

  let now = $state(new Date());

  function pad(n: number): string {
    return n.toString().padStart(2, '0');
  }

  const formatted = $derived(`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`);

  onMount(() => {
    const id = setInterval(() => {
      now = new Date();
    }, 1000);
    return () => clearInterval(id);
  });
</script>

<div class="clock mono" role="group" aria-label={t('clock.label')}>
  <span class="value">{formatted}</span>
</div>

<style>
  .clock {
    font-family: var(--font-mono);
    font-size: 15px;
    color: var(--fg);
    padding: 6px 10px;
    background: var(--bg-sunken);
    border-radius: 6px;
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
  }
</style>
