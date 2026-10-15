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
  import { onMount, onDestroy } from 'svelte';
  import { t } from '#lib/i18n/index.ts';
  import {
    ApiError,
    listHiredCards,
    returnHiredCard,
    updateHiredContact,
  } from '#lib/api/client.ts';
  import { emailValid, phoneValid } from '@fartola/shared-types';
  import type { HiredCardRow, HiredCardsListResponse } from '@fartola/shared-types';
  import Button from '#lib/ui/Button.svelte';
  import { canTapToCall } from '#lib/ui/canTapToCall.ts';
  import HiredContactFields from '#lib/components/HiredContactFields.svelte';
  import LoadError from '#lib/ui/LoadError.svelte';

  interface Props {
    competitionId: string;
  }

  let { competitionId }: Props = $props();

  let open: HiredCardRow[] = $state([]);
  let returned: HiredCardRow[] = $state([]);
  let paid: HiredCardsListResponse['paid_on_site'] = $state(undefined);
  /** One state for the single response that carries both lists. A failed
   * reload after data was shown keeps the cached lists ('stale'). */
  let load: 'loading' | 'loaded' | 'error' | 'stale' = $state('loading');
  /** Set of card_numbers currently being PATCHed — disables the row's
   * button so a double-tap can't double-PATCH. */
  let pendingCards: Set<number> = $state(new Set());
  let rowErrors: Record<number, string> = $state({});
  let toastMessage: string | null = $state(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped by every load and every return: a response that is no longer
   * the latest must not overwrite newer data. */
  let seq = 0;
  /** A retry from 'stale' is running: the warning gives way to a busy line. */
  let reloading = $state(false);

  const tapToCall = canTapToCall();

  /** The row being edited (card number) and its form. */
  let editing: number | null = $state(null);
  let editName = $state('');
  let editPhone = $state('');
  let editEmail = $state('');
  let editNote = $state('');
  let editSubmitted = $state(false);
  let editError: string | null = $state(null);
  let saving = $state(false);

  onMount(() => {
    void fetchAll();
  });
  onDestroy(() => {
    if (toastTimer) clearTimeout(toastTimer);
  });

  async function fetchAll(): Promise<void> {
    const mine = ++seq;
    if (load !== 'stale' && load !== 'loaded') load = 'loading';
    reloading = load === 'stale';
    try {
      const r = await listHiredCards(competitionId);
      if (mine !== seq) return;
      open = r.open;
      returned = r.returned;
      paid = r.paid_on_site;
      load = 'loaded';
      reloading = false;
    } catch {
      if (mine !== seq) return;
      load = load === 'loaded' || load === 'stale' ? 'stale' : 'error';
      reloading = false;
    }
  }

  function toast(msg: string): void {
    toastMessage = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastMessage = null), 3000);
  }

  /** Format an epoch-ms timestamp as HH:MM in the local timezone. */
  function formatTime(ms: number): string {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function startEdit(row: HiredCardRow): void {
    editing = row.card_number;
    editName = row.contact_name ?? '';
    editPhone = row.contact_phone ?? '';
    editEmail = row.contact_email ?? '';
    editNote = row.note ?? '';
    editSubmitted = false;
    editError = null;
  }

  async function saveEdit(): Promise<void> {
    if (editing === null) return;
    editSubmitted = true;
    editError = null;
    const phone = editPhone.trim();
    const email = editEmail.trim();
    if (phone === '' && email === '') {
      editError = t('walk.err.hyrbrickaContact');
      return;
    }
    if ((phone !== '' && !phoneValid(phone)) || (email !== '' && !emailValid(email))) return;
    const orNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());
    const contact = {
      name: orNull(editName),
      phone: orNull(phone),
      email: orNull(email),
      note: orNull(editNote),
    };
    const card = editing;
    const marked = open.find((r) => r.card_number === card)?.marked_at_ms ?? 0;
    saving = true;
    try {
      await updateHiredContact(competitionId, card, { marked_at_ms: marked, ...contact });
      open = open.map((r) =>
        r.card_number === card
          ? {
              ...r,
              contact_name: contact.name,
              contact_phone: contact.phone,
              contact_email: contact.email,
              note: contact.note,
            }
          : r
      );
      editing = null;
    } catch (e) {
      console.error('hired contact save failed', e);
      if (e instanceof ApiError && e.status === 409) {
        // The card was returned or hired out again meanwhile: drop the stale form.
        editing = null;
        toast(t('hyrbrickor.changed'));
        void fetchAll();
      } else {
        editError = t('hyrbrickor.editError');
      }
    } finally {
      saving = false;
    }
  }

  async function onReturn(cardNumber: number): Promise<void> {
    // Set replacement form — Assumption A8 (Svelte 5 reactivity).
    pendingCards = new Set([...pendingCards, cardNumber]);
    const { [cardNumber]: _gone, ...rest } = rowErrors;
    rowErrors = rest;
    try {
      const r = await returnHiredCard(competitionId, cardNumber);
      // Move the row from open → returned with the server's timestamp, then
      // reload to reconcile. Bumping seq drops any older load still in flight.
      const moved = open.find((row) => row.card_number === cardNumber);
      if (moved) {
        open = open.filter((row) => row.card_number !== cardNumber);
        returned = [{ ...moved, returned_at_ms: r.returned_at_ms }, ...returned];
      }
      toast(t('hyrbrickor.returnedToast', { card: cardNumber }));
      seq++;
      void fetchAll();
    } catch (e) {
      rowErrors = {
        ...rowErrors,
        [cardNumber]: e instanceof ApiError ? t('hyrbrickor.returnError') : t('common.unknownError'),
      };
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

  {#if paid && paid.total > 0}
    <p data-testid="hyrbrickor-paid">
      {t('hyrbrickor.paid', { total: paid.total, cash: paid.cash, swish: paid.swish })}
    </p>
  {/if}

  {#if load === 'loading'}
    <p class="muted" data-testid="hyrbrickor-loading">{t('hyrbrickor.loading')}</p>
  {:else if load === 'error'}
    <div data-testid="hyrbrickor-error">
      <LoadError message={t('hyrbrickor.loadError')} onretry={() => void fetchAll()} />
    </div>
  {:else}
    {#if load === 'stale' && reloading}
      <p class="muted" data-testid="hyrbrickor-reloading">{t('hyrbrickor.loading')}</p>
    {:else if load === 'stale'}
      <div data-testid="hyrbrickor-reload-error">
        <LoadError message={t('hyrbrickor.reloadError')} onretry={() => void fetchAll()} />
      </div>
    {/if}
    {#if open.length === 0 && returned.length === 0}
      <p class="muted" data-testid="hyrbrickor-empty">{t('hyrbrickor.empty')}</p>
    {/if}
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
              {#if editing === row.card_number}
                <form
                  class="edit-form"
                  onsubmit={(e) => {
                    e.preventDefault();
                    void saveEdit();
                  }}
                >
                  <HiredContactFields
                    bind:name={editName}
                    bind:phone={editPhone}
                    bind:email={editEmail}
                    bind:note={editNote}
                    prefix="hyrbrickor-edit"
                    submitted={editSubmitted}
                  />
                  {#if editError}
                    <p class="row-error" role="alert" data-testid="hyrbrickor-edit-error">
                      {editError}
                    </p>
                  {/if}
                  <div class="actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid="hyrbrickor-edit-cancel"
                      disabled={saving}
                      onclick={() => (editing = null)}>{t('hyrbrickor.editCancel')}</Button
                    >
                    <Button
                      variant="primary"
                      size="sm"
                      type="submit"
                      data-testid="hyrbrickor-edit-save"
                      disabled={saving}>{t('hyrbrickor.editSave')}</Button
                    >
                  </div>
                </form>
              {:else}
                <div class="contact-line">
                  {#if row.contact_name}
                    <span data-testid="hyrbrickor-row-name">{row.contact_name}</span>
                  {/if}
                  {#if row.contact_phone}
                    {#if tapToCall}
                      <a href={`tel:${row.contact_phone}`} data-testid="hyrbrickor-row-phone"
                        >{row.contact_phone}</a
                      >
                    {:else}
                      <span data-testid="hyrbrickor-row-phone">{row.contact_phone}</span>
                    {/if}
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
              {/if}
              {#if rowErrors[row.card_number]}
                <p class="row-error" role="alert" data-testid="hyrbrickor-row-error">
                  {rowErrors[row.card_number]}
                </p>
              {/if}
              <div class="actions">
                {#if editing !== row.card_number}
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="hyrbrickor-row-edit"
                    disabled={saving}
                    onclick={() => startEdit(row)}>{t('hyrbrickor.edit')}</Button
                  >
                {/if}
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
          <span class="badge">{returned.length}</span>
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

{#if toastMessage !== null}
  <div class="toast" role="status" data-testid="hyrbrickor-toast">{toastMessage}</div>
{/if}

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
    font-size: var(--fs-label);
  }
  .row-error {
    margin: 0;
    color: var(--dnf);
  }
  .toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--fg);
    color: var(--bg-elev);
    padding: 10px 18px;
    border-radius: var(--radius);
    font-size: var(--fs-label);
    box-shadow: var(--shadow-lg);
    z-index: 100;
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
    font-size: var(--fs-label);
    background: var(--bg-sunken);
    color: var(--fg);
    padding: 2px 8px;
    border-radius: 999px;
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
    color: var(--fg-muted);
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
    font-size: var(--fs-label);
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
  .edit-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .actions {
    display: flex;
    gap: var(--space-xs);
    justify-content: flex-end;
    margin-top: 4px;
  }
</style>
