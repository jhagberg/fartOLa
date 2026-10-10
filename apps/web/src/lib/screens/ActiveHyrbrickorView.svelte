<!--
  Authored for fartola. Not ported from upstream.

  Plan 02-05 — Hyrbrickor admin backstop view. D-HB-2 mandates an
  end-of-event reconciliation surface where the operator can see every
  open rental in the competition and mark cards returned manually. The
  finish-readout HyrbrickaToast covers the typical happy path; this view
  catches everyone who walks out the door without scanning the finish.

  Lifecycle:
   - On mount: GET /api/competitions/:id/hired-cards → { open, returned }.
   - Per-row Returnerad button → PATCH /:cardNumber/return → splice the
     row out of `open` and onto `returned` with the new timestamp.
   - WS subscription is intentionally omitted for 2.0 scope — the view
     is short-lived (operator opens, scans, closes) and the manual
     refresh is the explicit affordance.

  Locked by:
  - .planning/phases/02-4-klubbs-mvp/02-05-PLAN.md task 3
  - .planning/phases/02-4-klubbs-mvp/02-CONTEXT.md D-HB-2
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '#lib/i18n/index.ts';
  import { listHiredCards, returnHiredCard } from '#lib/api/client.ts';
  import type { HiredCardRow } from '@fartola/shared-types';
  import Button from '#lib/ui/Button.svelte';

  interface Props {
    competitionId: string;
  }

  let { competitionId }: Props = $props();

  let open: HiredCardRow[] = $state([]);
  let returned: HiredCardRow[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  /** Set of card_numbers currently being PATCHed — disables the row's
   * Returnerad button so a double-tap can't double-PATCH (idempotent
   * server-side, but the UI feedback is cleaner). */
  let pendingCards: Set<number> = $state(new Set());

  onMount(() => {
    void fetchAll();
  });

  async function fetchAll(): Promise<void> {
    loading = true;
    error = null;
    try {
      const r = await listHiredCards(competitionId);
      open = r.open;
      returned = r.returned;
    } catch (e) {
      error = (e as Error).message || t('hyrbrickor.loadError');
    } finally {
      loading = false;
    }
  }

  /** Format an epoch-ms timestamp as HH:MM in the local timezone. */
  function formatTime(ms: number): string {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  async function onReturn(cardNumber: number): Promise<void> {
    // Set replacement form — Assumption A8 (Svelte 5 reactivity).
    pendingCards = new Set([...pendingCards, cardNumber]);
    try {
      const r = await returnHiredCard(competitionId, cardNumber);
      // Optimistic local update: move the row from open → returned
      // with the timestamp the server returned. Avoids a full refetch.
      const moved = open.find((row) => row.card_number === cardNumber);
      if (moved) {
        open = open.filter((row) => row.card_number !== cardNumber);
        returned = [{ ...moved, returned_at_ms: r.returned_at_ms }, ...returned];
      }
    } catch (e) {
      error = (e as Error).message || t('hyrbrickor.loadError');
    } finally {
      const next = new Set(pendingCards);
      next.delete(cardNumber);
      pendingCards = next;
    }
  }
</script>

<section class="hyrbrickor-view" data-testid="hyrbrickor-view">
  <header class="head">
    <h1 class="title">{t('hyrbrickor.title')}</h1>
  </header>

  {#if loading}
    <p class="muted" data-testid="hyrbrickor-loading">{t('hyrbrickor.loading')}</p>
  {:else if error}
    <p class="err" data-testid="hyrbrickor-error">{error}</p>
  {:else if open.length === 0 && returned.length === 0}
    <p class="muted" data-testid="hyrbrickor-empty">{t('hyrbrickor.empty')}</p>
  {:else}
    {#if open.length > 0}
      <section class="card open-card">
        <header class="section-head">
          <h2>{t('hyrbrickor.openSection')}</h2>
          <span class="badge">{open.length}</span>
        </header>
        <ul class="row-list">
          {#each open as row (row.card_number)}
            <li class="row" data-testid="hyrbrickor-open-row">
              <div class="card-line">
                <span class="mono lbl-card" data-testid="hyrbrickor-row-card"
                  >{row.card_number}</span
                >
                <span class="muted small"
                  >{t('hyrbrickor.markedAt', { time: formatTime(row.marked_at_ms) })}</span
                >
                {#if row.fee != null}
                  <span class="muted small fee" data-testid="hyrbrickor-row-fee"
                    >{t('hyrbrickor.fee', { fee: row.fee })}</span
                  >
                {/if}
              </div>
              <div class="contact-line">
                {#if row.contact_name}
                  <span data-testid="hyrbrickor-row-name">{row.contact_name}</span>
                {/if}
                {#if row.contact_phone}
                  <a href={`tel:${row.contact_phone}`} data-testid="hyrbrickor-row-phone"
                    >{row.contact_phone}</a
                  >
                {/if}
                {#if row.contact_email}
                  <a
                    href={`mailto:${row.contact_email}`}
                    data-testid="hyrbrickor-row-email">{row.contact_email}</a
                  >
                {/if}
              </div>
              {#if row.note}
                <p class="note muted small" data-testid="hyrbrickor-row-note">{row.note}</p>
              {/if}
              <div class="actions">
                <Button
                  variant="primary"
                  size="sm"
                  data-testid="hyrbrickor-row-return"
                  disabled={pendingCards.has(row.card_number)}
                  onclick={() => void onReturn(row.card_number)}
                >
                  {t('hyrbrickor.returnedBtn')}
                </Button>
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if returned.length > 0}
      <section class="card returned-card">
        <header class="section-head">
          <h2>{t('hyrbrickor.returnedSection')}</h2>
          <span class="badge muted-badge">{returned.length}</span>
        </header>
        <ul class="row-list">
          {#each returned as row (row.card_number)}
            <li class="row returned" data-testid="hyrbrickor-returned-row">
              <div class="card-line">
                <span class="mono lbl-card">{row.card_number}</span>
                <span class="muted small">
                  {t('hyrbrickor.markedAt', { time: formatTime(row.marked_at_ms) })}
                  ·
                  {#if row.returned_at_ms !== null}
                    {t('hyrbrickor.returnedAt', { time: formatTime(row.returned_at_ms) })}
                  {/if}
                </span>
              </div>
              {#if row.contact_name}
                <div class="contact-line">
                  <span>{row.contact_name}</span>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</section>

<style>
  .hyrbrickor-view {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    padding: var(--space-md);
    min-width: 0;
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: var(--space-sm);
  }
  .title {
    margin: 0;
    font-size: var(--fs-heading);
    font-weight: 600;
  }
  .muted {
    color: var(--fg-muted);
  }
  .small {
    font-size: 12px;
  }
  .err {
    color: var(--dnf);
  }
  .card {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .section-head {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  .section-head h2 {
    margin: 0;
    font-size: var(--fs-label);
    font-weight: 600;
  }
  .badge {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 11px;
    background: var(--dnf-soft);
    color: var(--dnf);
    padding: 2px 8px;
    border-radius: 999px;
  }
  .muted-badge {
    background: var(--bg-sunken);
    color: var(--fg-muted);
  }
  .row-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
  }
  .row.returned {
    opacity: 0.75;
  }
  .card-line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px;
  }
  .fee {
    white-space: nowrap;
  }
  .lbl-card {
    font-size: var(--fs-label);
    font-weight: 600;
  }
  .mono {
    font-family: var(--font-mono);
    font-feature-settings:
      'tnum' 1,
      'zero' 1;
  }
  .contact-line {
    display: flex;
    gap: 8px;
    font-size: 13px;
    flex-wrap: wrap;
    align-items: center;
  }
  .contact-line > span,
  .contact-line > a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 8px 10px;
    border-radius: 6px;
  }
  .contact-line > span {
    padding-left: 0;
  }
  a {
    color: var(--accent);
    text-decoration: none;
  }
  a:hover,
  a:focus-visible {
    background: var(--bg-sunken);
    text-decoration: underline;
  }
  .note {
    margin: 0;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 4px;
  }
</style>
