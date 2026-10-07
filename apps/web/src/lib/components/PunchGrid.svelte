<!--
  Authored for fartola. Not ported from upstream.

  PunchGrid — auto-fill tile grid showing the runner's controls in
  course order. Three states per tile: `ok` (green soft fill), `miss`
  (red dashed), `finish` (accent solid; "M"). Each tile shows
  ordinal index, code, and split.

  Port of the `.punch-grid` block in screens-readout.jsx (~lines 48-73).

  Renders when Tweaks density is 'low' or 'med'; SplitsTable replaces
  it when density='high' (the ReadoutView owns that toggle).

  Locked by:
  - 01-13-PLAN.md task 2
  - 01-UI-SPEC.md §"Visual Anchors" — punch grid is the default surface
-->
<script lang="ts">
  import type { ReceiptPunch } from './receipt-templates/types.ts';
  import { punchLabel, punchNo } from './receipt-templates/punchLabels.ts';

  interface Props {
    punches: ReceiptPunch[];
  }

  let { punches }: Props = $props();
</script>

<div class="punch-grid" data-testid="punch-grid">
  {#each punches as p, i (i)}
    <div
      class="punch"
      class:ok={!p.finish && !p.kind && p.ok}
      class:miss={!p.finish && !p.kind && !p.ok}
      class:struck={p.kind === 'struck'}
      class:extra={p.kind === 'extra' || p.kind === 'order'}
      class:finish={p.finish}
    >
      <span class="idx mono">{p.kind || p.finish ? '' : punchNo(punches, i).replace('.', '')}</span>
      <span class="code mono">{#if p.finish}M{:else if p.kind === 'struck'}<s>{p.code}</s>{:else}{p.code}{/if}</span>
      <span class="split mono">{punchLabel(p) ?? p.split}</span>
    </div>
  {/each}
</div>

<style>
  .punch-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
    gap: 6px;
    margin-top: 4px;
  }
  .punch {
    aspect-ratio: 1;
    border: 1px solid var(--border);
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-size: 13px;
    background: var(--bg-elev);
    position: relative;
  }
  .punch .code {
    font-weight: 600;
  }
  .punch .split {
    font-size: 10px;
    color: var(--fg-muted);
    margin-top: 2px;
  }
  .punch.ok {
    background: var(--ok-soft);
    border-color: color-mix(in srgb, var(--ok) 40%, transparent);
    color: var(--ok);
  }
  .punch.ok .split {
    color: color-mix(in srgb, var(--ok) 80%, var(--fg));
  }
  .punch.miss {
    background: var(--dnf-soft);
    border-color: color-mix(in srgb, var(--dnf) 40%, transparent);
    color: var(--dnf);
    border-style: dashed;
  }
  /* Struck and extra tiles are told apart by their label text and border
     style, not by colour (ADR-0016 rule 7). */
  .punch.extra {
    background: var(--bg-sunken);
    border-style: dashed;
    color: var(--fg-muted);
  }
  .punch.struck {
    background: var(--bg-sunken);
    border-style: dotted;
    color: var(--fg-muted);
  }
  .punch.extra .split,
  .punch.struck .split {
    font-size: 9px;
    font-weight: 600;
    color: var(--fg-muted);
  }
  .punch.finish {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-strong);
    font-weight: 600;
  }
  .punch .idx {
    position: absolute;
    top: 2px;
    left: 4px;
    font-size: 9px;
    color: var(--fg-faint);
  }
  .mono {
    font-family: var(--font-mono);
    font-feature-settings:
      'tnum' 1,
      'zero' 1;
  }
</style>
