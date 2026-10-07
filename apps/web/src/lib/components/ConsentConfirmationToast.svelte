<!--
  Authored for fartola. Not ported from upstream.

  C-M4 consent-confirmation toast. Surfaces on the FIRST card_read for a
  competitor whose consent_status === 'pending_first_read' (the default
  for EntryList-imported rows; plan 05). Operator confirms → PATCH
  /api/competitors/:id flips consent_status to 'confirmed_on_read' and
  stamps consent_at_ms. "Avfärda" hides the toast locally without a
  server flip; the parent view keeps a per-session
  dismissedConsentForCompetitorIds set so the SAME competitor doesn't
  re-trigger the toast on subsequent reads in this session.

  Locked by:
  - 01-14-PLAN.md task 1 (consent toast component)
  - 01-REVIEWS.md §C-M4 (consent-confirmation toast on first card_read)
  - REQ-PRIV-001 (consent literal flow)
-->
<script lang="ts">
  import { confirmConsent } from '#lib/api/client.ts';
  import { t } from '#lib/i18n/index.ts';
  import Button from '#lib/ui/Button.svelte';

  interface Props {
    competitorId: string;
    competitorName: string;
    className: string;
    onResolved: (action: 'confirmed' | 'dismissed') => void;
  }

  let { competitorId, competitorName, className, onResolved }: Props = $props();

  let pending = $state(false);
  let error = $state<string | null>(null);

  async function onConfirm(): Promise<void> {
    pending = true;
    error = null;
    const r = await confirmConsent(competitorId);
    pending = false;
    if (r.ok) {
      onResolved('confirmed');
      return;
    }
    // 422 'consent_not_pending' means another tab confirmed first — treat
    // as success from the operator's POV. The local state already reflects
    // 'confirmed_on_read' on the next refresh.
    if (r.status === 422 && r.data.error === 'consent_not_pending') {
      onResolved('confirmed');
      return;
    }
    error = r.data.message ?? r.data.error ?? t('err.network');
  }

  function onDismiss(): void {
    onResolved('dismissed');
  }
</script>

<div
  class="consent-toast"
  role="alertdialog"
  aria-labelledby="consent-toast-title"
  data-testid="consent-confirmation-toast"
>
  <h3 id="consent-toast-title" class="title">{t('consent.title')}</h3>
  <p class="body">
    {t('consent.body', { name: competitorName, className })}
  </p>
  {#if error}
    <p class="err" data-testid="consent-toast-error">{error}</p>
  {/if}
  <div class="actions">
    <Button
      variant="ghost"
      size="sm"
      onclick={onDismiss}
      disabled={pending}
      data-testid="consent-toast-dismiss"
    >
      {t('consent.dismiss')}
    </Button>
    <Button
      variant="primary"
      size="sm"
      onclick={() => void onConfirm()}
      disabled={pending}
      data-testid="consent-toast-confirm"
    >
      {t('consent.confirm')}
    </Button>
  </div>
</div>

<style>
  .consent-toast {
    position: fixed;
    right: 24px;
    bottom: 24px;
    width: min(380px, calc(100vw - 32px));
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-left: 4px solid var(--accent);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    padding: 16px 18px;
    z-index: 80;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .title {
    margin: 0;
    font-size: var(--fs-label);
    font-weight: 600;
  }
  .body {
    margin: 0;
    font-size: 13px;
    color: var(--fg-muted);
    line-height: 1.4;
  }
  .err {
    margin: 0;
    font-size: 12px;
    color: var(--dnf);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
