<!--
  Authored for fartola. Not ported from upstream.

  ReceiptMirror — tab strip + ReceiptPaper containing the selected
  template. Klassisk is the default per UI-SPEC §"Receipt template
  DEFAULT". Picking a tab updates the local store; the parent decides
  whether to also PATCH the competition's `receipt_template` field
  (plan 15 wires the PATCH).

  Six templates: Classic, Standing, Detailed, Top4, Minimal, Kids. The
  tab order matches screens-readout.jsx (`['classic', 'standing', 'top4',
  'detailed', 'minimal', 'kids']`) — top4 comes before detailed so the
  operator can flip between the "race-broadcast" tabs first.

  Locked by:
  - 01-13-PLAN.md task 1
  - 01-UI-SPEC.md §"Receipt templates" (6 LOCKED arms)
-->
<script lang="ts">
  import { t } from '#lib/i18n/index.ts';
  import ReceiptPaper from './ReceiptPaper.svelte';
  import Classic from './receipt-templates/Classic.svelte';
  import Standing from './receipt-templates/Standing.svelte';
  import Detailed from './receipt-templates/Detailed.svelte';
  import Top4 from './receipt-templates/Top4.svelte';
  import Minimal from './receipt-templates/Minimal.svelte';
  import Kids from './receipt-templates/Kids.svelte';
  import type {
    ReceiptRead,
    ReceiptTemplate,
    ReceiptTopRow,
  } from './receipt-templates/types.ts';

  interface Props {
    read: ReceiptRead;
    selected?: ReceiptTemplate;
    /** Top-4 leaderboard slice, ignored by the other 5 templates. */
    classResults?: ReceiptTopRow[];
    /** Whether auto-print mode is ON — surfaces an AUTO badge in the head. */
    autoPrint?: boolean;
    onSelect?: (tpl: ReceiptTemplate) => void;
  }

  let {
    read,
    selected = 'classic',
    classResults = [],
    autoPrint = false,
    onSelect,
  }: Props = $props();

  // Tab order — matches the sketch (top4 before detailed so the operator
  // hits the broadcast tabs first).
  const TABS: ReceiptTemplate[] = ['classic', 'standing', 'top4', 'detailed', 'minimal', 'kids'];

  function pick(tpl: ReceiptTemplate): void {
    onSelect?.(tpl);
  }
</script>

<section class="receipt-mirror">
  <header class="head">
    <h3>{t('ro.printed')}</h3>
    <span class="meta">80mm thermal · ESC/POS</span>
    {#if autoPrint}
      <span class="auto-badge">AUTO</span>
    {/if}
    <div class="tpl-chooser" role="tablist" aria-label={t('rcpt.tpl')}>
      {#each TABS as tpl (tpl)}
        <button
          type="button"
          role="tab"
          class="tpl-tab"
          class:active={selected === tpl}
          aria-selected={selected === tpl}
          data-testid={`tpl-tab-${tpl}`}
          onclick={() => pick(tpl)}
        >
          {t(`rcpt.tpl.${tpl}`)}
        </button>
      {/each}
    </div>
  </header>
  <ReceiptPaper>
    {#if selected === 'classic'}
      <Classic {read} />
    {:else if selected === 'standing'}
      <Standing {read} />
    {:else if selected === 'detailed'}
      <Detailed {read} />
    {:else if selected === 'top4'}
      <Top4 {read} {classResults} />
    {:else if selected === 'minimal'}
      <Minimal {read} />
    {:else if selected === 'kids'}
      <Kids {read} />
    {/if}
  </ReceiptPaper>
</section>

<style>
  .receipt-mirror {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    flex-wrap: wrap;
    row-gap: 8px;
    border-bottom: 1px solid var(--border);
  }
  .head h3 {
    margin: 0;
    font-size: var(--fs-label);
    font-weight: 600;
  }
  .head .meta {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-faint);
  }
  .auto-badge {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 2px 6px;
    background: var(--accent-soft);
    color: var(--accent-strong);
    border-radius: 4px;
    font-weight: 600;
    letter-spacing: 0.05em;
  }
  .tpl-chooser {
    display: flex;
    gap: 2px;
    flex-wrap: wrap;
    background: var(--bg-sunken);
    padding: 3px;
    border-radius: 8px;
    border: 1px solid var(--border);
    margin-left: auto;
  }
  .tpl-tab {
    padding: 6px 10px;
    font-size: var(--fs-label);
    font-weight: 500;
    border: 0;
    background: transparent;
    color: var(--fg-muted);
    border-radius: 5px;
    min-height: var(--hit);
    cursor: pointer;
  }
  .tpl-tab:hover {
    color: var(--fg);
  }
  .tpl-tab.active {
    background: var(--bg-elev);
    color: var(--fg);
    box-shadow: var(--shadow-sm);
  }
</style>
