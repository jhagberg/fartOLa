<!--
  Authored for fartola. Not ported from upstream.

  Plan 02-05 — Hyrbricka finish-readout toast. Surfaces on a card_read
  when the matched competitor's card has an open hired_cards row (the
  /readout response's `hired_card_open` field is non-null). Shows the
  contact info MeOS lacks AND a one-tap "Returnerad" button — operator
  hands the card back, clicks, sets returned_at_ms = now().

  The "Ignorera" button dismisses the toast WITHOUT a server PATCH; the
  parent view's per-session returnedHiredCardNumbers Set suppresses a
  re-pop for the SAME card_number for the rest of this session.

  Structural analog: ConsentConfirmationToast.svelte (Phase 1 plan-14).
  We use a `--urgent` class with a red border + bold header instead of
  the consent toast's accent color — operator must see the rental flag
  on a busy readout screen.

  Locked by:
  - .planning/phases/02-4-klubbs-mvp/02-05-PLAN.md task 2
  - .planning/phases/02-4-klubbs-mvp/02-CONTEXT.md D-HB-2 (Returnerad
    button at finish-readout)
  - .planning/phases/02-4-klubbs-mvp/02-RESEARCH.md §"Pattern 6: ReadoutView
    Hyrbricka toast"
-->
<script lang="ts">
  import { t } from '#lib/i18n/index.ts';
  import Button from '#lib/ui/Button.svelte';

  interface Props {
    cardNumber: number;
    contactName: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    note: string | null;
    onReturn: (cardNumber: number) => void | Promise<void>;
    onDismiss: (cardNumber: number) => void;
  }

  let {
    cardNumber,
    contactName,
    contactPhone,
    contactEmail,
    note,
    onReturn,
    onDismiss,
  }: Props = $props();

  let pending = $state(false);

  async function handleReturn(): Promise<void> {
    pending = true;
    try {
      await onReturn(cardNumber);
    } finally {
      pending = false;
    }
  }

  function handleDismiss(): void {
    onDismiss(cardNumber);
  }
</script>

<div
  class="hyrbricka-toast urgent"
  role="alertdialog"
  aria-labelledby="hyrbricka-toast-title"
  data-testid="hyrbricka-toast"
>
  <h3 id="hyrbricka-toast-title" class="title">{t('readout.hyrbricka.title')}</h3>
  <p class="card-line" data-testid="hyrbricka-card">
    <span class="lbl">{t('ro.card')}:</span>
    <span class="mono">{cardNumber}</span>
  </p>
  <div class="contact">
    {#if contactName}
      <p class="row">
        <span class="lbl">{t('readout.hyrbricka.contact.name')}</span>
        <span data-testid="hyrbricka-contact-name">{contactName}</span>
      </p>
    {/if}
    {#if contactPhone}
      <p class="row">
        <span class="lbl">{t('readout.hyrbricka.contact.phone')}</span>
        <a href={`tel:${contactPhone}`} data-testid="hyrbricka-contact-phone">{contactPhone}</a>
      </p>
    {/if}
    {#if contactEmail}
      <p class="row">
        <span class="lbl">{t('readout.hyrbricka.contact.email')}</span>
        <a href={`mailto:${contactEmail}`} data-testid="hyrbricka-contact-email"
          >{contactEmail}</a
        >
      </p>
    {/if}
    {#if note}
      <p class="row">
        <span class="lbl">{t('readout.hyrbricka.contact.note')}</span>
        <span data-testid="hyrbricka-contact-note">{note}</span>
      </p>
    {/if}
  </div>
  <div class="actions">
    <Button
      variant="ghost"
      size="sm"
      onclick={handleDismiss}
      disabled={pending}
      data-testid="hyrbricka-dismiss"
    >
      {t('readout.hyrbricka.dismiss')}
    </Button>
    <Button
      variant="primary"
      size="sm"
      onclick={() => void handleReturn()}
      disabled={pending}
      data-testid="hyrbricka-return"
    >
      {t('readout.hyrbricka.returned')}
    </Button>
  </div>
</div>

<style>
  .hyrbricka-toast {
    position: fixed;
    right: max(24px, env(safe-area-inset-right));
    bottom: max(24px, env(safe-area-inset-bottom));
    width: min(420px, calc(100vw - 32px));
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-left: 4px solid var(--dnf);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    padding: 16px 18px;
    z-index: 90;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .hyrbricka-toast.urgent {
    border-left-color: var(--dnf);
  }
  .title {
    margin: 0;
    font-size: var(--fs-label);
    font-weight: 700;
    color: var(--dnf);
  }
  .card-line {
    margin: 0;
    font-size: 13px;
    color: var(--fg);
  }
  .contact {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .contact .row {
    margin: 0;
    font-size: 13px;
    color: var(--fg);
    display: flex;
    gap: 8px;
  }
  .lbl {
    color: var(--fg-muted);
    font-weight: 500;
  }
  .mono {
    font-family: var(--font-mono);
    font-feature-settings:
      'tnum' 1,
      'zero' 1;
  }
  a {
    color: var(--accent);
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 4px 6px;
    margin: -4px -6px;
    border-radius: 6px;
  }
  a:hover,
  a:focus-visible {
    background: var(--bg-sunken);
    text-decoration: underline;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
</style>
