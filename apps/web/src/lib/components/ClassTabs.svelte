<!--
  Authored for fartola. Not ported from upstream.

  Per-class tab strip for the live-results view. The "All" tab aggregates
  every class. Each tab shows the row count to give the operator (or
  spectator) a quick read on class size at a glance.

  Locked by:
  - 01-14-PLAN.md task 2
  - 01-UI-SPEC.md §"Visual Anchors" — tab strip lives below the h1, above
    the table
-->
<script lang="ts">
  interface ClassTabItem {
    id: string;
    name: string;
    count: number;
  }

  interface Props {
    classes: ClassTabItem[];
    /** Total row count across all classes — drives the All tab. */
    totalCount: number;
    /** Currently-active tab id; 'ALL' for the aggregate. */
    activeId: string;
    onSelect: (id: string) => void;
  }

  let { classes, totalCount, activeId, onSelect }: Props = $props();
</script>

<div class="res-tabs" role="tablist" data-testid="class-tabs">
  <button
    class="res-tab"
    class:active={activeId === 'ALL'}
    type="button"
    role="tab"
    aria-selected={activeId === 'ALL'}
    onclick={() => onSelect('ALL')}
    data-testid="class-tab-all"
  >
    Alla
    <span class="count">{totalCount}</span>
  </button>
  {#each classes as c (c.id)}
    <button
      class="res-tab"
      class:active={activeId === c.id}
      type="button"
      role="tab"
      aria-selected={activeId === c.id}
      onclick={() => onSelect(c.id)}
      data-testid="class-tab"
    >
      {c.name}
      <span class="count">{c.count}</span>
    </button>
  {/each}
</div>

<style>
  .res-tabs {
    display: flex;
    gap: var(--space-xs);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
  }
  .res-tab {
    padding: 12px 16px;
    border: 0;
    background: transparent;
    color: var(--fg-muted);
    font-size: 14px;
    font-weight: 500;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    white-space: nowrap;
    min-height: var(--hit);
    cursor: pointer;
    font-family: inherit;
  }
  .res-tab .count {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    margin-left: 6px;
    color: var(--fg-muted);
  }
  .res-tab.active {
    color: var(--fg);
    border-color: var(--fg);
    font-weight: 600;
  }
  .res-tab:hover:not(.active) {
    color: var(--fg);
    background: var(--bg-sunken);
  }
</style>
