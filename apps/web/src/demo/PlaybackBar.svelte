<!--
  Authored for fartola. Not ported from upstream.

  The speaker demo's playback bar: play/pause, the competition clock, the
  speed, and the day as a slider. Over the slider small bars show how much
  happens when, so the rushes can be found; a radio outage is hatched there
  and named on a button that jumps to it. The bar owns the tick: it reads
  the clock five times a second and hands the time up (bind:time).
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { formatClockTime } from '@fartola/shared-types';
  import { t } from '#lib/i18n/index.ts';
  import Icon from '#lib/ui/Icon.svelte';
  import type { PlaybackClock } from './playback.ts';

  interface Props {
    clock: PlaybackClock;
    /** Playback time, epoch ms. */
    time: number;
    offsetMin: number;
    /** Events in each equal part of the day. */
    density: number[];
    /** Radio outages, [from, to] in epoch ms. */
    outages: number[][];
  }

  let { clock, time = $bindable(), offsetMin, density, outages }: Props = $props();

  const SPEEDS = [1, 10, 60];
  /** Jump to a little before, so the last punches before the silence show. */
  const LEAD_MS = 60_000;

  let playing = $state(false);
  let speed = $state(1);
  let timer: ReturnType<typeof setInterval> | null = null;

  const peak = $derived(Math.max(1, ...density));
  const clockText = $derived(formatClockTime(time, offsetMin));
  const pct = (ms: number): number => ((ms - clock.startMs) / (clock.endMs - clock.startMs)) * 100;
  const hhmm = (ms: number): string => formatClockTime(ms, offsetMin).slice(0, 5);

  function sync(): void {
    time = clock.time();
    playing = clock.playing;
    speed = clock.speed;
  }

  onMount(() => {
    sync();
    timer = setInterval(sync, 200);
  });
  onDestroy(() => {
    if (timer) clearInterval(timer);
  });

  function toggle(): void {
    if (clock.playing) clock.pause();
    else clock.play();
    sync();
  }

  function setSpeed(next: number): void {
    clock.setSpeed(next);
    sync();
  }

  function seek(ms: number): void {
    clock.seek(ms);
    sync();
  }
</script>

<div class="bar" role="group" aria-label={t('demo.playback')} data-testid="demo-bar">
  <button type="button" class="btn" onclick={toggle} data-testid="demo-play">
    <Icon name={playing ? 'pause' : 'play'} />
    {playing ? t('demo.pause') : t('demo.play')}
  </button>
  <span class="clock" aria-label={t('demo.clock')} data-testid="demo-clock">{clockText}</span>
  <div class="speeds" role="group" aria-label={t('demo.speed')}>
    <span class="lbl">{t('demo.speed')}</span>
    {#each SPEEDS as x (x)}
      <button
        type="button"
        class="btn"
        aria-pressed={speed === x}
        onclick={() => setSpeed(x)}
        data-testid="demo-speed"
      >
        {#if speed === x}<Icon name="check" />{/if}
        {x}×
      </button>
    {/each}
  </div>
  <div class="line">
    <div class="dens" aria-hidden="true">
      {#each density as n, i (i)}
        <span class="d" style:height="{(n / peak) * 100}%"></span>
      {/each}
      {#each outages as [from, to] (from)}
        <span
          class="out"
          style:left="{pct(from!)}%"
          style:width="{pct(to!) - pct(from!)}%"
          data-testid="demo-outage-mark"
        ></span>
      {/each}
    </div>
    <input
      type="range"
      min={clock.startMs}
      max={clock.endMs}
      step="60000"
      value={time}
      oninput={(ev) => seek(Number(ev.currentTarget.value))}
      aria-label={t('demo.timeline')}
      aria-valuetext={clockText}
      data-testid="demo-seek"
    />
  </div>
  {#each outages as [from, to] (from)}
    <button
      type="button"
      class="btn"
      onclick={() => seek(from! - LEAD_MS)}
      data-testid="demo-outage"
    >
      <Icon name="alert-triangle" />
      {t('demo.outage', { from: hhmm(from!), to: hhmm(to!) })}
    </button>
  {/each}
</div>

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-md);
    border-top: 1px solid var(--border-strong);
    background: var(--bg-elev);
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: var(--hit);
    padding: 0 var(--space-md);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--bg-elev);
    color: var(--fg);
    font-size: var(--fs-body);
    white-space: nowrap;
  }
  .btn[aria-pressed='true'] {
    border: 2px solid var(--fg);
    font-weight: 700;
  }
  .clock {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum' 1;
    font-size: var(--fs-heading);
    font-weight: 700;
  }
  .speeds {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
  }
  .lbl {
    font-size: var(--fs-label);
    color: var(--fg-muted);
  }
  .line {
    flex: 1;
    min-width: 200px;
    display: flex;
    flex-direction: column;
  }
  /* The bars end where the slider's thumb can go (half a thumb in). */
  .dens {
    position: relative;
    display: flex;
    align-items: flex-end;
    height: 22px;
    margin: 0 8px;
  }
  .d {
    flex: 1;
    min-height: 1px;
    background: var(--fg-muted);
  }
  .out {
    position: absolute;
    top: 0;
    bottom: 0;
    border: 2px solid var(--fg);
    background: repeating-linear-gradient(
      -45deg,
      var(--fg) 0 2px,
      var(--bg-elev) 2px 6px
    );
  }
  /* With the bars above it the slider is a full-height touch target. */
  input[type='range'] {
    width: 100%;
    height: 22px;
    margin: 0;
    accent-color: var(--fg);
  }
</style>
