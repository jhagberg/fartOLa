<!--
  Authored for fartola. Not ported from upstream.

  Status pill rendering one of the eight projected outcomes
  (UI-SPEC §"Status colors"):
    Phase 1 (auto-detected from card_read + course):
      OK     — clean run, all controls in order
      MP     — finish punch present but punches mismatched
      DNF    — no finish punch (or operator-flagged DNF)
      PEND   — no card_read yet (waiting for finish)
    Phase 2.0 (operator-asserted via manual_status_set, 2026-05-18):
      DNS    — Did Not Start (no-show on race day)
      DQ     — Disqualified (operator rule decision)
      CANCEL — Återbud (pre-race withdrawal)
      MAX    — Maxtid (exceeded class time cap)

  Soft fill + same-hue foreground; the leading dot is `currentColor` so the
  high-contrast bright-sun mode picks up the bordered fallback per
  tokens.css. Tooltip text is sourced from i18n (rcpt.status.tooltip.<code>)
  so operators get the explanation on hover (desktop), long-press (touch),
  or via screen reader (aria-describedby).
-->
<script lang="ts">
  import { t } from '$lib/i18n/index.ts';

  type Status = 'OK' | 'MP' | 'DNF' | 'PEND' | 'DNS' | 'DQ' | 'CANCEL' | 'MAX';

  interface Props {
    status: Status;
    label?: string;
    small?: boolean;
    /** When true (default) the pill carries title + aria-describedby with the
     * i18n tooltip prose. Set to false when the consumer wraps the pill in
     * its own tooltip surface and the duplicate label would be noisy. */
    tooltip?: boolean;
  }

  // Per-instance counter for unique aria-describedby IDs. Multiple pills on
  // the same page (e.g. ResultsTable with 40 runners) previously all shared
  // id="status-tip-{status}" — any two OK pills pointed at the same <span>,
  // which violates the uniqueness contract of `id`. Using a module-level
  // incrementing counter gives each instance its own ID regardless of how
  // many pills share the same status value.
  let instanceCount = 0;

  let { status, label, small = false, tooltip = true }: Props = $props();

  // Capture this instance's id suffix at construction time.
  const instanceId = ++instanceCount;

  // Class is lower-case to match the sketch CSS hooks; that keeps the
  // contrast-high mode's `border: 1.5px solid currentColor;` overlay
  // simple to retain.
  const klass = $derived(`status ${status.toLowerCase()} ${small ? 'small' : ''}`);
  const tipText = $derived(
    tooltip ? t(`rcpt.status.tooltip.${status.toLowerCase()}`) : ''
  );
  const describedBy = $derived(tooltip ? `status-tip-${instanceId}` : undefined);
</script>

<span class={klass} title={tipText || undefined} aria-describedby={describedBy}>
  {label ?? status}
</span>
{#if tooltip && tipText}
  <span class="sr-only" id={describedBy}>{tipText}</span>
{/if}

<style>
  .status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: var(--fs-caption);
    font-weight: 600;
    font-family: var(--font-mono);
    letter-spacing: 0.02em;
  }
  .status::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
  .status.ok {
    background: var(--ok-soft);
    color: var(--ok);
  }
  .status.mp {
    background: var(--mp-soft);
    color: oklch(0.45 0.12 70);
  }
  .status.dnf {
    background: var(--dnf-soft);
    color: var(--dnf);
  }
  .status.pend {
    background: var(--pend-soft);
    color: var(--fg-muted);
  }
  .status.dns {
    background: var(--dns-soft);
    color: var(--dns);
  }
  .status.dq {
    background: var(--dq-soft);
    color: var(--dq);
  }
  .status.cancel {
    background: var(--cancel-soft);
    color: var(--cancel);
  }
  .status.max {
    background: var(--max-soft);
    color: var(--max);
  }
  :global(.contrast-high) .status {
    border: 1.5px solid currentColor;
  }
  .status.small {
    padding: 2px 8px;
    font-size: 11px;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
