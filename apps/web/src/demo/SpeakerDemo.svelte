<!--
  Authored for fartola. Not ported from upstream.

  The public speaker demo: the real speaker view (SpeakerView, the screen
  at /competition/[id]/speaker) fed by a recorded day and a playback clock
  instead of the server. Built on its own (vite.demo.config.ts) and
  published on the project site; it is not part of the installed app.
  Starts by itself a little before the first finish in the classes shown,
  at ten times the speed, where something happens every few seconds.
-->
<script lang="ts">
  import { t } from '#lib/i18n/index.ts';
  import SpeakerView from '#lib/screens/SpeakerView.svelte';
  import { applyTweaksToRoot, tweaks } from '#lib/stores/tweaks.svelte.ts';
  import Icon from '#lib/ui/Icon.svelte';
  import { DEMO_CLASSES, demoData } from './dataset.ts';
  import PlaybackBar from './PlaybackBar.svelte';
  import { boardSource, createClock, demoMs, density, eventTimes, firstFinishMs } from './playback.ts';

  // Placeholder: the demo feedback form the project site already links to.
  // A speaker may have no GitHub account; the maintainer decides the address.
  const FEEDBACK_URL =
    'https://github.com/jhagberg/fartOLa/issues/new?labels=demo-feedback&template=demo-feedback.yml&title=%5Bspeakerdemo%5D';
  const LEAD_MS = 2 * 60_000;
  const BARS = 120;

  const times = eventTimes(demoData);
  const firstStart = Math.min(...demoData.runners.flatMap((r) => (r[3] === null ? [] : [r[3] as number])));
  // Whole minutes at both ends: the slider steps a minute at a time and
  // must be able to reach the end.
  const MIN = 60_000;
  const clock = createClock(
    Math.floor(Math.min(times[0]!, demoMs(demoData, firstStart)) / MIN) * MIN - MIN,
    Math.ceil(times.at(-1)! / MIN) * MIN + MIN
  );
  const source = boardSource(demoData);
  clock.seek((firstFinishMs(demoData, DEMO_CLASSES) ?? clock.startMs) - LEAD_MS);
  clock.setSpeed(10);
  clock.play();

  let time = $state(clock.time());
  const board = $derived(source(time));

  // The view's "Starkt ljus" button flips the same setting as in the app.
  $effect(() => applyTweaksToRoot(document.documentElement));
</script>

<div class="page">
  <p class="note" data-testid="demo-note">
    <Icon name="info" />
    <span>{t('demo.note')}</span>
    <a href={FEEDBACK_URL}>{t('demo.feedback')}</a>
    <a href="?lang={tweaks.locale === 'sv' ? 'en' : 'sv'}">{t('demo.lang')}</a>
  </p>
  <div class="stage">
    <SpeakerView
      competitionId="demo"
      feed={{ name: demoData.name, board, nowMs: time, classes: DEMO_CLASSES }}
    />
  </div>
  <PlaybackBar
    {clock}
    bind:time
    offsetMin={demoData.clock_offset_min}
    density={density(times, clock.startMs, clock.endMs, BARS)}
    outages={demoData.radio_outages.map((w) => w.map((s) => demoMs(demoData, s)))}
  />
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: 100dvh;
  }
  .note {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    margin: 0;
    padding: var(--space-xs) var(--space-md);
    border-bottom: 1px solid var(--border-strong);
    background: var(--bg-elev);
  }
  .note a {
    color: var(--fg);
    font-weight: 700;
  }
  /* contain: the view's full-screen layout (position: fixed) fills this
     box, not the window, so the note and the playback bar stay in sight. */
  .stage {
    flex: 1;
    min-height: 0;
    padding: var(--space-sm) var(--space-md);
    contain: layout;
  }
</style>
