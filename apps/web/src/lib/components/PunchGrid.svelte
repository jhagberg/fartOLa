<!--
  Authored for fartola. Not ported from upstream.

  PunchGrid — the runner's controls in course order, then appended
  punches, then the finish. Each state differs in lightness, border, icon
  and word, so it reads without colour (design-lab spec "Punch tiles";
  ADR-0016 rule 7): ok, miss ("saknas"), order ("fel ordn."), extra,
  struck ("struken"), finish. Without a course (`verdict` false) tiles
  are plain punches: nothing claims correct or missing.

  Size follows course length: large up to 20 course controls (struck
  included, appended punches and finish not), medium above, so a long
  course keeps the action bar in view at 768 px.

  Renders when Tweaks density is 'low' or 'med'; SplitsTable replaces it
  at 'high' (ReadoutView owns that toggle).
-->
<script lang="ts">
  import type { ReceiptPunch } from './receipt-templates/types.ts';
  import { punchLabel, punchNo } from './receipt-templates/punchLabels.ts';
  import Icon, { type IconName } from '../ui/Icon.svelte';
  import { t } from '#lib/i18n/index.ts';

  interface Props {
    punches: ReceiptPunch[];
    /** False when the runner's class has no course. */
    verdict?: boolean;
  }

  let { punches, verdict = true }: Props = $props();

  const LARGE_MAX = 20;
  const courseCount = $derived(
    punches.filter((p) => !p.finish && (p.kind === undefined || p.kind === 'struck')).length
  );
  const size = $derived(courseCount > LARGE_MAX ? 'medium' : 'large');

  type State = 'ok' | 'miss' | 'order' | 'extra' | 'struck' | 'finish' | 'plain';
  const ICON: Partial<Record<State, IconName>> = {
    ok: 'check',
    miss: 'x',
    order: 'arrow-left-right',
    extra: 'plus',
    struck: 'minus',
  };

  function stateOf(p: ReceiptPunch): State {
    if (p.finish) return 'finish';
    if (p.kind) return p.kind;
    if (!verdict) return 'plain';
    return p.ok ? 'ok' : 'miss';
  }

  function bottomText(p: ReceiptPunch, s: State): string {
    if (s === 'miss') return t('ro.missing');
    if (s === 'order' || s === 'extra' || s === 'struck') return punchLabel(p) ?? '';
    return p.split;
  }
</script>

<div class="punch-grid {size}" data-testid="punch-grid" data-size={size}>
  {#each punches as p, i (i)}
    {@const s = stateOf(p)}
    {@const icon = ICON[s]}
    <div class="punch {s}" data-state={s}>
      <div class="top">
        <span class="idx mono">{p.finish ? '' : punchNo(punches, i).replace('.', '')}</span>
        {#if icon}<Icon name={icon} size={size === 'large' ? 20 : 16} />{/if}
      </div>
      <span class="code mono">
        {#if p.finish}M{:else if s === 'struck'}<s>{p.code}</s>{:else}{p.code}{/if}
      </span>
      <span class={s === 'ok' || s === 'finish' || s === 'plain' ? 'split mono' : 'label'}>{bottomText(p, s)}</span>
    </div>
  {/each}
</div>

<style>
  .punch-grid {
    display: grid;
    gap: 7px;
    margin-top: 4px;
  }
  .punch-grid.large {
    grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  }
  .punch-grid.medium {
    grid-template-columns: repeat(auto-fill, minmax(62px, 1fr));
    gap: 6px;
  }
  .punch {
    border: 1.5px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--bg-elev);
    color: var(--fg);
    padding: 5px 7px;
    display: grid;
    grid-template-rows: auto 1fr auto;
  }
  .large .punch {
    min-height: 80px;
  }
  .medium .punch {
    min-height: 66px;
    padding: 4px 6px;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: var(--fs-label);
    font-weight: 600;
  }
  .idx {
    color: var(--fg-muted);
    font-weight: 500;
  }
  .code {
    font-weight: 600;
    align-self: center;
    line-height: 1.1;
  }
  .large .code {
    font-size: 24px;
  }
  .medium .code {
    font-size: 20px;
  }
  .split {
    font-size: 15px;
  }
  .medium .split {
    font-size: var(--fs-label);
  }
  .label {
    font-family: var(--font-ui);
    font-size: var(--fs-label);
    font-weight: 600;
    white-space: nowrap;
  }
  .medium .label {
    font-size: 13px;
  }
  .punch.ok {
    background: var(--punch-ok-fill);
    border-color: var(--punch-ok-line);
    color: var(--punch-ok-line);
  }
  .punch.ok .code,
  .punch.ok .split {
    color: var(--fg);
  }
  .punch.miss {
    background: var(--punch-miss-fill);
    border-color: var(--punch-miss-fill);
    color: var(--punch-miss-fg);
  }
  .punch.miss .idx {
    color: var(--punch-miss-fg);
  }
  .punch.order {
    background: var(--punch-order-fill);
    border: 3px solid var(--punch-order-line);
    color: var(--punch-order-line);
  }
  .punch.order .code {
    color: var(--fg);
  }
  .punch.extra {
    background: var(--bg-sunken);
    border: 2px dashed var(--border-strong);
    color: var(--fg-muted);
  }
  .punch.extra .code {
    color: var(--fg);
  }
  .punch.struck {
    background: var(--bg-sunken);
    border: 2px dotted var(--border-strong);
    color: var(--fg-muted);
  }
  .punch.struck .code s {
    text-decoration-thickness: 2px;
  }
  .punch.finish {
    border: 3px solid var(--fg);
  }
  .mono {
    font-family: var(--font-mono);
    font-feature-settings:
      'tnum' 1,
      'zero' 1;
  }
</style>
