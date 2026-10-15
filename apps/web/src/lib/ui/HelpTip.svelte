<!--
  Authored for fartola. Not ported from upstream.

  A "?" that opens a short explanation in place. A disclosure, not a
  tooltip: click or tap (also Enter/Space), no hover, so it works on a
  touch screen and for keyboard and screen-reader users (ADR-0016).
  `tr` is the SOFT rule number behind the explanation, shown first.
-->
<script lang="ts">
  import { t } from '#lib/i18n/index.ts';

  interface Props {
    /** Unique per page; the explanation's element id. */
    id: string;
    text: string;
    tr?: string;
    label?: string;
  }

  let { id, text, tr, label = t('help.why') }: Props = $props();
  let open = $state(false);
</script>

<span class="help">
  <button
    type="button"
    class="help-btn"
    aria-label={label}
    aria-expanded={open}
    aria-controls={id}
    data-testid="help-{id}"
    onclick={() => (open = !open)}
    onkeydown={(e) => {
      if (e.key === 'Escape') open = false;
    }}>?</button
  >
  <span {id} class="help-body" hidden={!open} data-testid={id}>
    {#if tr}<b>SOFT {tr}.</b>{/if}
    {text}
  </span>
</span>

<style>
  .help-btn {
    min-width: var(--hit);
    min-height: var(--hit);
    border: 1px solid var(--border-strong);
    border-radius: 50%;
    background: var(--bg-elev);
    color: var(--fg);
    font-size: var(--fs-body);
    font-weight: 600;
    cursor: pointer;
  }
  .help-btn[aria-expanded='true'] {
    border-color: var(--accent);
  }
  .help-body {
    display: block;
    font-size: var(--fs-caption);
    color: var(--fg-muted);
  }
  .help-body[hidden] {
    display: none;
  }
</style>
