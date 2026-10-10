<!--
  Authored for fartola. Not ported from upstream.

  One class on the speaker screen (todo 2026-10-07-speaker-view): who is on
  the way in, then every runner with a time (place and time behind at each
  radio control and the finish; the leader at a point is its "1."), and the
  rest folded into counts. Scrolls only inside itself; names wrap, never cut.
-->
<script lang="ts">
  import type { SpeakerClass, SpeakerRunner, SpeakerSplit } from '@fartola/shared-types';
  import { formatClockTime } from '@fartola/shared-types';
  import { t } from '#lib/i18n/index.ts';
  import { formatElapsed } from '#lib/screens/readout-types.ts';
  import { passedCounts, speakerPanel } from '#lib/screens/speaker.ts';

  interface Props {
    cls: SpeakerClass;
    nowMs: number;
    offsetMin: number;
  }

  let { cls, nowMs, offsetMin }: Props = $props();

  const panel = $derived(speakerPanel(cls, nowMs));
  const passed = $derived(passedCounts(cls));
  const finished = $derived(passed.at(-1) ?? 0);
  const out = $derived(
    panel.inForest + panel.rows.filter((r) => !r.finish && r.radio_finish_ms === null).length
  );
  const pointLabel = (code: number | null): string =>
    code === null ? t('spk.finish') : t('spk.control', { code });
  const behind = (s: SpeakerSplit): string =>
    s.behind_ms === 0 ? '' : `+${formatElapsed(s.behind_ms)}`;
  const lastPassing = (r: SpeakerRunner): { code: number; s: SpeakerSplit } | null => {
    const j = r.passings.findLastIndex((p) => p !== null);
    return j < 0 ? null : { code: cls.controls[j]!, s: r.passings[j]! };
  };
</script>

<!-- A scrolling region must take focus so the keyboard can scroll it. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<section
  class="panel"
  tabindex="0"
  aria-labelledby="spk-h-{cls.class_id}"
  data-testid="spk-panel"
>
  <header class="head">
    <h2 id="spk-h-{cls.class_id}">{cls.class_name}</h2>
    <p class="counts">
      {t('spk.finishedCount', { n: finished })} · {t('spk.inForest', { n: out })}
    </p>
  </header>

  {#if panel.onWay.length > 0}
    <div class="onway">
      <h3>{t('spk.onWay')}</h3>
      <ul>
        {#each panel.onWay as r (r.competitor_id)}
          {@const lp = lastPassing(r)}
          <li>
            <span class="nm" data-testid="spk-name">{r.name}</span>
            {#if r.club}<span class="club">{r.club}</span>{/if}
            {#if lp}
              <span class="mono">
                {pointLabel(lp.code)}
                {lp.s.place}. {behind(lp.s)}
              </span>
            {/if}
            {#if r.expected_finish_ms !== null}
              <span class="mono exp">
                {t('spk.expected', { time: formatClockTime(r.expected_finish_ms, offsetMin) })}
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if panel.rows.length > 0}
    <table class="tbl">
      <thead>
        <tr>
          <th scope="col">{t('spk.name')}</th>
          {#each [...cls.controls, null] as code, i (code ?? 'finish')}
            <th scope="col" class="num">
              {pointLabel(code)}
              <span class="bh">{t('spk.passed', { n: passed[i] })}</span>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each panel.rows as r (r.competitor_id)}
          <tr data-testid="spk-row">
            <th scope="row" class="who">
              <span class="nm" data-testid="spk-name">{r.name}</span>
              {#if r.club}<span class="club">{r.club}</span>{/if}
            </th>
            {#each r.passings as p, i (i)}
              <td class="num">
                {#if p}
                  <span class="plc">{p.place}.</span>
                  {formatElapsed(p.elapsed_ms)}
                  <span class="bh">{behind(p)}</span>
                {/if}
              </td>
            {/each}
            <td class="num">
              {#if r.finish}
                <span class="plc">{r.finish.place}.</span>
                {formatElapsed(r.finish.elapsed_ms)}
                <span class="bh">{behind(r.finish)}</span>
              {:else if r.radio_finish_ms !== null}
                {formatElapsed(r.radio_finish_ms)}
                <span class="bh">{t('spk.notRead')}</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <p class="muted">{t('spk.noTimes')}</p>
  {/if}

  {#if panel.notStarted.length > 0 || panel.out.length > 0}
    <details class="folded" data-testid="spk-folded">
      <summary>
        {#if panel.notStarted.length > 0}
          <span>{t('spk.notStarted')} {panel.notStarted.length}</span>
        {/if}
        {#each panel.out as g (g.status)}
          <span>{t(`status.${g.status}`)} {g.runners.length}</span>
        {/each}
      </summary>
      {#if panel.notStarted.length > 0}
        <p>
          <strong>{t('spk.notStarted')}:</strong>
          {panel.notStarted.map((r) => r.name).join(', ')}
        </p>
      {/if}
      {#each panel.out as g (g.status)}
        <p>
          <strong>{t(`status.${g.status}`)}:</strong>
          {g.runners.map((r) => r.name).join(', ')}
        </p>
      {/each}
    </details>
  {/if}
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: var(--space-md);
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    font-size: 18px;
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }
  h2 {
    margin: 0;
    font-size: var(--fs-display);
    font-weight: 700;
  }
  h3 {
    margin: 0 0 4px;
    font-size: var(--fs-body);
    font-weight: 700;
  }
  .counts,
  .muted {
    margin: 0;
    color: var(--fg-muted);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .onway li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px var(--space-sm);
    padding: 4px 0;
    border-bottom: 1px solid var(--border);
  }
  .onway {
    padding: var(--space-xs) var(--space-sm);
    border: 2px solid var(--fg);
    border-radius: var(--radius);
  }
  .onway .exp {
    margin-left: auto;
    font-weight: 700;
  }
  .who {
    display: flex;
    flex-direction: column;
    text-align: left;
    font-weight: 400;
  }
  .nm {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .club {
    font-size: var(--fs-label);
    color: var(--fg-muted);
    overflow-wrap: anywhere;
  }
  .mono,
  .num {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum' 1;
  }
  .tbl {
    width: 100%;
    border-collapse: collapse;
  }
  .tbl th,
  .tbl td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  .tbl thead th {
    font-size: var(--fs-label);
    color: var(--fg-muted);
    text-align: left;
  }
  .tbl .num {
    text-align: right;
    white-space: nowrap;
  }
  .plc {
    font-weight: 700;
  }
  .bh {
    display: block;
    font-size: var(--fs-label);
    color: var(--fg-muted);
  }
  .folded summary {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-sm);
    min-height: var(--hit);
    align-items: center;
    cursor: pointer;
    color: var(--fg-muted);
  }
  .folded p {
    margin: 4px 0;
    overflow-wrap: anywhere;
  }
</style>
