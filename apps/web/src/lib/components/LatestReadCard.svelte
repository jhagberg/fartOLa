<!--
  Authored for fartola. Not ported from upstream.

  LatestReadCard — the active runner block at the top of the readout
  view. Three states:
    1. Empty: SI ▢ blinker + "Väntar på kort…" copy.
    2. Unknown card: card_number + DNF-coloured warning + "Registrera"
       CTA (calls onWalkup with the card_number).
    3. Known card: card_number, name, class/club/start, elapsed time,
       optional place + StatusPill. Below the runner row, the parent
       passes its PunchGrid / SplitsTable via the `controls` snippet.

  Manual-DNF popover (UI-SPEC §"Manual DNF override"):
    - The "Bryt" button toggles a confirm popover with a reason input.
    - Confirm fires onManualDnf(competitorId, reason).
    - If status is already DNF, the button surfaces as "Återkalla
      brytning" and fires onUnDnf(competitorId).
    - The parent re-fetches /readout on either action and the
      StatusPill flips in-place via the WS results_update broadcast.

  Locked by:
  - 01-13-PLAN.md task 2
  - 01-UI-SPEC.md §"Manual DNF override" (reversible; reason 1..500)
  - 01-UI-SPEC.md §"Readout view live behavior"
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '$lib/i18n/index.ts';
  import StatusPill from '$lib/ui/StatusPill.svelte';
  import PulseDot from '$lib/ui/PulseDot.svelte';

  interface Read {
    cardNumber: number;
    name: string | null;
    cls: string;
    club: string | null;
    startTime: string;
    readTime: string;
    elapsed: string;
    status: 'OK' | 'MP' | 'DNF' | 'PEND' | 'DNS' | 'DQ' | 'CANCEL' | 'MAX';
    /** Phase 2.1 (plan 13): non-null when the current status was asserted
     * by the operator via manual_status_set. null means auto-detected
     * (from card_read + course). Used to decide whether the clear button
     * should appear — auto-DNF shows an explanation popover instead. */
    manual_status: 'DNF' | 'DNS' | 'DQ' | 'CANCEL' | 'MAX' | null;
    place: number | null;
    unknown: boolean;
    /** Competitor id for the manual-DNF endpoint (null on unknown rows). */
    competitorId: string | null;
  }

  type ManualStatus = 'DNF' | 'DNS' | 'DQ' | 'CANCEL' | 'MAX';

  interface Props {
    /** null = waiting state. */
    read: Read | null;
    /** Bumped on each card_read; used as the `key` for flashIn animation. */
    flashKey?: string | null;
    /** Auto-print toggle state; disables the print button when true. */
    autoPrint?: boolean;
    onSimulate?: () => void;
    onPrint?: () => void;
    onWalkup?: (cardNumber: number) => void;
    onManualDnf?: (competitorId: string, reason: string) => void;
    onUnDnf?: (competitorId: string) => void;
    /** Phase 2.0 generalized override — preferred over onManualDnf when
     * supplied. The popover shows all five manual states (DNF/DNS/DQ/
     * CANCEL/MAX). Falls back to onManualDnf when status==='DNF'. */
    onManualStatus?: (competitorId: string, status: ManualStatus, reason: string) => void;
    /** Phase 2.0 clear-override — preferred over onUnDnf when supplied. */
    onClearManualStatus?: (competitorId: string) => void;
    onEdit?: (competitorId: string) => void;
    /** Snippet that renders either PunchGrid or SplitsTable (parent
     * owns the density toggle). */
    controls?: Snippet;
  }

  let {
    read,
    flashKey = null,
    autoPrint = false,
    onSimulate,
    onPrint,
    onWalkup,
    onManualDnf,
    onUnDnf,
    onManualStatus,
    onClearManualStatus,
    onEdit,
    controls,
  }: Props = $props();

  // Manual-status popover state. Defaults to DNF so the existing test path
  // (manual-dnf-btn → dnf-reason-input → dnf-confirm) keeps producing a DNF.
  const MANUAL_STATUSES: ManualStatus[] = ['DNF', 'DNS', 'DQ', 'CANCEL', 'MAX'];
  const REASON_BY_STATUS: Record<ManualStatus, string> = {
    DNF: 'Bröt loppet',
    DNS: 'Kom inte till start',
    DQ: 'Diskvalificerad',
    CANCEL: 'Återbud',
    MAX: 'Maxtid passerad',
  };

  let dnfOpen = $state(false);
  let dnfReason = $state('');
  let pickedStatus = $state<ManualStatus>('DNF');

  // True when the current row carries an OPERATOR-ASSERTED override.
  // Phase 2.1 fix: use manual_status (non-null = operator set) rather than
  // checking the computed status value — auto-DNF (manual_status=null,
  // status='DNF') should NOT show the clear button; only manual overrides
  // should show it (02-11 MEDIUM: auto-DNF vs manual-DNF distinction).
  function isOverridden(r: Read): boolean {
    return r.manual_status !== null;
  }

  function toggleDnf(): void {
    if (!read || !read.competitorId) return;
    if (isOverridden(read)) {
      // Single-click clear — preserves the pre-Phase-2.0 un-DNF gesture.
      if (onClearManualStatus) onClearManualStatus(read.competitorId);
      else onUnDnf?.(read.competitorId);
      return;
    }
    dnfOpen = !dnfOpen;
    if (dnfOpen) {
      pickedStatus = 'DNF';
      dnfReason = REASON_BY_STATUS.DNF;
    }
  }

  function pickStatus(s: ManualStatus): void {
    pickedStatus = s;
    // Pre-fill the reason field with a sensible default for the chosen
    // status; operator can edit before confirm.
    dnfReason = REASON_BY_STATUS[s];
  }

  function confirmDnf(): void {
    if (!read || !read.competitorId) return;
    const reason = dnfReason.trim();
    if (reason.length === 0) return;
    if (onManualStatus) {
      onManualStatus(read.competitorId, pickedStatus, reason);
    } else if (pickedStatus === 'DNF') {
      // Legacy single-state callback path — preserved so existing tests +
      // any pre-2.0 consumers keep working.
      onManualDnf?.(read.competitorId, reason);
    }
    dnfOpen = false;
    dnfReason = '';
    pickedStatus = 'DNF';
  }

  function cancelDnf(): void {
    dnfOpen = false;
    dnfReason = '';
    pickedStatus = 'DNF';
  }
</script>

<section
  class="card latest"
  data-testid="latest-read"
  data-flash={flashKey ?? ''}
>
  <header class="head">
    <h3>{t('ro.latest')}</h3>
    <PulseDot variant="green" />
    <span class="meta mono">{t('ro.feed.live')}</span>
    <div class="actions">
      <button type="button" class="btn ghost" data-testid="simulate-btn" onclick={() => onSimulate?.()}>
        ↳ {t('ro.simulate')}
      </button>
    </div>
  </header>

  {#if !read}
    <div class="body">
      <div class="ro-empty">
        <div class="blink mono">SI ▢</div>
        <div class="empty-title">{t('ro.waiting')}</div>
        <div class="empty-sub">{t('ro.waiting.desc')}</div>
      </div>
    </div>
  {:else if read.unknown}
    <div class="body">
      <div class="runner-row">
        <div class="runner-info">
          <div class="card-num mono" data-testid="card-number">{read.cardNumber}</div>
          <h2 class="runner-name warn">⚠ {t('ro.unknownCard')}</h2>
          <div class="runner-meta">
            <span>{t('ro.card')} <b class="mono">{read.cardNumber}</b></span>
            <span>{t('ro.time')} <b class="mono">{read.readTime}</b></span>
          </div>
        </div>
        <div class="result-col">
          <button
            type="button"
            class="btn primary lg"
            data-testid="walkup-cta"
            onclick={() => onWalkup?.(read.cardNumber)}
          >
            {t('ro.register')}
          </button>
        </div>
      </div>
    </div>
  {:else}
    <div class="body">
      <div class="runner-row">
        <div class="runner-info">
          <div class="card-num mono" data-testid="card-number">{read.cardNumber}</div>
          <h2 class="runner-name" data-testid="runner-name">{read.name}</h2>
          <div class="runner-meta">
            <span>{t('ro.class')} <b>{read.cls}</b></span>
            {#if read.club}
              <span>{t('ro.club')} <b>{read.club}</b></span>
            {/if}
            <span>{t('ro.start')} <b class="mono">{read.startTime}</b></span>
          </div>
        </div>
        <div class="result-col">
          <div class="elapsed mono" data-testid="elapsed">{read.elapsed}</div>
          <div class="place">
            {#if read.place}
              {t('ro.place')} <b class="mono">{read.place}</b> ·
            {/if}
            <StatusPill status={read.status} />
          </div>
        </div>
      </div>

      {@render controls?.()}
    </div>

    <div class="foot">
      <button
        type="button"
        class="btn primary"
        data-testid="print-btn"
        disabled={autoPrint}
        onclick={() => onPrint?.()}
      >
        🖨 {t('ro.print')}
      </button>
      {#if read.competitorId}
        <button
          type="button"
          class="btn ghost"
          data-testid="edit-competitor-btn"
          onclick={() => read.competitorId && onEdit?.(read.competitorId)}
        >
          ✎ {t('ro.edit')}
        </button>
        <div class="dnf-wrap">
          <button
            type="button"
            class="btn ghost"
            data-testid="manual-dnf-btn"
            onclick={toggleDnf}
          >
            {isOverridden(read) ? t('ro.undnf') : t('ro.dnf')}
          </button>
          {#if dnfOpen}
            <div class="dnf-pop" role="dialog">
              <div class="status-picker" role="radiogroup" aria-label={t('ro.dnf')}>
                {#each MANUAL_STATUSES as s (s)}
                  <button
                    type="button"
                    class="status-chip"
                    class:active={pickedStatus === s}
                    data-testid={`status-pick-${s}`}
                    aria-checked={pickedStatus === s}
                    role="radio"
                    onclick={() => pickStatus(s)}
                  >
                    {t(`status.${s}`)}
                  </button>
                {/each}
              </div>
              <label class="dnf-label" for="dnf-reason">{t(`status.${pickedStatus}`)}</label>
              <input
                id="dnf-reason"
                type="text"
                class="dnf-input"
                data-testid="dnf-reason-input"
                bind:value={dnfReason}
                maxlength="500"
              />
              <div class="dnf-actions">
                <button
                  type="button"
                  class="btn ghost sm"
                  data-testid="dnf-cancel"
                  onclick={cancelDnf}
                >
                  {t('wiz.cancel')}
                </button>
                <button
                  type="button"
                  class="btn primary sm"
                  data-testid="dnf-confirm"
                  disabled={dnfReason.trim().length === 0}
                  onclick={confirmDnf}
                >
                  {t('walk.save')}
                </button>
              </div>
            </div>
          {/if}
        </div>
      {/if}
      <span class="autoprint-hint">
        <span class="kbd">P</span>
        <span class="faint">skriv ut</span>
      </span>
    </div>
  {/if}
</section>

<style>
  .card {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .latest[data-flash]:not([data-flash='']) {
    animation: flashIn 1.6s ease-out;
  }
  @keyframes flashIn {
    0% {
      background: var(--accent-soft);
    }
    100% {
      background: var(--bg-elev);
    }
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  .head h3 {
    margin: 0;
    font-size: var(--fs-label);
    font-weight: 600;
  }
  .meta {
    font-size: 12px;
    color: var(--fg-muted);
  }
  .actions {
    margin-left: auto;
  }
  .body {
    padding: 16px 18px;
  }
  .ro-empty {
    display: grid;
    place-items: center;
    text-align: center;
    height: 280px;
    color: var(--fg-faint);
  }
  .ro-empty .blink {
    width: 96px;
    height: 96px;
    border-radius: 50%;
    border: 2px dashed var(--border-strong);
    display: grid;
    place-items: center;
    margin: 0 auto 18px;
    color: var(--fg-faint);
    font-family: var(--font-mono);
  }
  .empty-title {
    font-size: 16px;
    color: var(--fg);
  }
  .empty-sub {
    font-size: 13px;
    margin-top: 4px;
  }
  .runner-row {
    display: flex;
    align-items: flex-start;
    gap: 18px;
    flex-wrap: wrap;
  }
  .runner-info {
    min-width: 0;
    flex: 1;
  }
  .card-num {
    font-family: var(--font-mono);
    font-size: 44px;
    font-weight: 500;
    letter-spacing: -0.02em;
    color: var(--accent-strong);
    line-height: 1;
  }
  .runner-name {
    font-size: 26px;
    font-weight: 600;
    letter-spacing: -0.01em;
    margin: 0;
  }
  .runner-name.warn {
    color: var(--dnf);
  }
  .runner-meta {
    display: flex;
    gap: 18px;
    font-size: 14px;
    color: var(--fg-muted);
    margin-top: 4px;
    flex-wrap: wrap;
  }
  .runner-meta b {
    color: var(--fg);
    font-weight: 600;
  }
  .result-col {
    margin-left: auto;
    text-align: right;
  }
  .elapsed {
    font-size: 36px;
    font-weight: 500;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .place {
    font-size: 13px;
    color: var(--fg-muted);
    margin-top: 6px;
  }
  .foot {
    padding: 14px 18px;
    border-top: 1px solid var(--border);
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
    position: relative;
  }
  .btn {
    height: var(--hit);
    min-height: var(--hit);
    padding: 0 18px;
    border-radius: var(--radius);
    border: 1px solid var(--border-strong);
    background: var(--bg-elev);
    color: var(--fg);
    font-weight: 600;
    font-size: var(--fs-body);
    cursor: pointer;
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-fg);
  }
  .btn.primary:hover:not(:disabled) {
    background: var(--accent-strong);
  }
  .btn.ghost {
    background: transparent;
  }
  .btn.ghost:hover {
    background: var(--bg-sunken);
  }
  .btn.lg {
    height: 56px;
    padding: 0 24px;
    font-size: 17px;
  }
  .btn.sm {
    height: 32px;
    padding: 0 12px;
    font-size: 13px;
  }
  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .dnf-wrap {
    position: relative;
  }
  .dnf-pop {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    padding: 12px;
    box-shadow: var(--shadow-md);
    display: grid;
    gap: 8px;
    min-width: 320px;
    z-index: 10;
  }
  .status-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .status-chip {
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--bg-elev);
    color: var(--fg-muted);
    font-size: 12px;
    font-weight: 600;
    font-family: var(--font-mono);
    letter-spacing: 0.02em;
    cursor: pointer;
  }
  .status-chip:hover {
    background: var(--bg-sunken);
  }
  .status-chip.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-fg);
  }
  .dnf-label {
    font-size: 12px;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .dnf-input {
    height: 36px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    padding: 0 10px;
    font-family: var(--font-ui);
  }
  .dnf-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  .autoprint-hint {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .kbd {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 2px 6px;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    background: var(--bg-sunken);
    color: var(--fg-muted);
  }
  .faint {
    color: var(--fg-faint);
    font-size: 12px;
  }
  .mono {
    font-family: var(--font-mono);
    font-feature-settings:
      'tnum' 1,
      'zero' 1;
  }
</style>
