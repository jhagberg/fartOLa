<!--
  Authored for fartola. Not ported from upstream.

  RegistrationView — the registration-desk operator surface
  (/competition/:id/registration). Mounts the same Plan-02 WalkupModal
  overlay on a clean registration-themed shell so one operator can run
  the kids-line registration without the results-display surface
  ReadoutView mixes in.

  Design (plan 02-02b):
   - cardSubscription with onUnknown=cardQueue.push routes every
     card_read to the FIFO queue (no projection lookup — every read is
     a registration candidate). When the modal is already open for an
     earlier card, the new card lands in the queue + the "N i kö"
     badge updates.
   - On WalkupModal close (Save success OR Avbryt), pop the next
     queued card and re-mount the modal for it. Empty queue → modal
     stays closed; empty state visible.
   - Dedupe-on-card_number: same SI bricka beeped twice (currently
     open OR already queued) surfaces a toast and is otherwise
     dropped. No crash, no double-enqueue.
   - Late finish punches during registration are queued like any
     unknown card — the operator sees "okänd bricka" in the modal
     and decides late-registrant vs. already-registered-finishing.

  Locked by:
  - 02-02b-PLAN.md task 3
  - .planning/phases/02-4-klubbs-mvp/02-CONTEXT.md lines 45-71
    (Registration-desk section + D-LIM-1)
-->
<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { t } from '$lib/i18n/index.ts';
  import { cardQueue, type QueuedCard } from '$lib/stores/cardQueue.svelte.ts';
  import { createCardSubscription } from '$lib/services/cardSubscription.ts';
  import {
    getCompetition,
    lookupEventorBySiCard,
    lookupCompetitorByCard,
    setManualStatus,
    setActiveCompetition,
  } from '$lib/api/client.ts';
  import WalkupModal from '$lib/screens/WalkupModal.svelte';
  import AddRunnerSheet from '$lib/components/AddRunnerSheet.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import type { ClassDTO, EventorLookupHit, EventorLookupMany, CompetitorDTO } from '@fartola/shared-types';

  interface Props {
    competitionId: string;
    /** Pre-loaded classes from the +page.ts data loader. When the
     * route's load function returns early (or is skipped), the empty-
     * default lets RegistrationView fetch them via getCompetition on
     * mount — same pattern Phase 1 ReadoutView uses (fetches its own
     * data; the route shell is thin). */
    classes?: ClassDTO[];
  }

  let { competitionId, classes = [] }: Props = $props();
  let resolvedClasses: ClassDTO[] = $state(untrack(() => classes));

  // --- state ----------------------------------------------------------------
  /** Card currently mounted in the WalkupModal. Distinct from
   * cardQueue.current because we lift it OUT of the queue when the
   * modal opens; the queue holds only PENDING cards (the "N i kö" badge
   * is keyed off cardQueue.count, not currentCard). */
  let currentCard: QueuedCard | null = $state(null);
  /** Eventor pre-fill for the currently-mounted card, fetched async
   * after handleIncomingCard pops. Null while the lookup is in-flight
   * or returned hit=false. Code-review F-003 (codex) HIGH fix —
   * /registration must match /readout's Eventor-prefill ergonomics so
   * the 3-5s/kid throughput target holds at 4-klubbs. */
  let currentEventorHint: EventorLookupHit | EventorLookupMany | null = $state(null);
  /** Card beeped that resolved to an already-registered competitor.
   * When set, we show the "already registered" banner instead of
   * opening the walk-up form (which would just show empty fields and
   * confuse the operator). */
  let knownCard: { card: number; competitor: CompetitorDTO } | null = $state(null);
  let cancelBusy = $state(false);
  let cancelErr: string | null = $state(null);
  let toastMessage: string | null = $state(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let subscription: ReturnType<typeof createCardSubscription> | null = null;

  // --- lifecycle ------------------------------------------------------------

  onMount(() => {
    // Carry-over from a prior mount — if the user navigated back and the
    // queue still has entries, open the modal immediately. Rare in
    // practice (we drain on unmount below) but harmless to handle.
    if (currentCard === null && cardQueue.count > 0) {
      currentCard = cardQueue.pop();
    }
    // Fetch competition + classes when the route shell didn't pre-load
    // them (mirrors the Phase 1 ReadoutView pattern — thin shell, the
    // view fetches its own data). Also claim active-competition so the
    // bridge routes card_reads to this competition's readout channel
    // (same as ReadoutView's mountReadout).
    if (resolvedClasses.length === 0) {
      void (async () => {
        try {
          const res = await getCompetition(competitionId);
          resolvedClasses = res.classes;
        } catch {
          // Soft fail — the WalkupModal will still mount with an empty
          // class list; operator sees no Bana options and the line halts
          // (correct behavior — no silent registration without a class).
        }
      })();
    }
    // Claim active competition so card_reads route here. Soft-fail so a
    // server hiccup doesn't break the page mount.
    void setActiveCompetition(competitionId).catch(() => {
      /* soft fail */
    });
    subscription = createCardSubscription({
      competitionId,
      // classifyCard splits the dispatch: 'known' → show already-
      // registered banner (no walkup); 'unknown' → enqueue for walkup.
      // We piggyback the lookup result via cardHolderHint so the banner
      // gets the competitor name without a second fetch.
      classifyCard: async (cardNumber) => {
        try {
          const res = await lookupCompetitorByCard(competitionId, cardNumber);
          const hit = res.competitors[0] ?? null;
          if (hit) {
            return { isUnmatched: false, cardHolderHint: hit.name };
          }
        } catch {
          /* fall through to unmatched on lookup failure */
        }
        return { isUnmatched: true, cardHolderHint: null };
      },
      onCardRead: (cardNumber, hint, classification) => {
        if (classification === 'known') {
          handleKnownCard(cardNumber);
          return;
        }
        handleIncomingCard(cardNumber, hint);
      },
      // F-002 (codex) BLOCKER guard: when the operator opens
      // /registration after some readout activity, the server replays
      // the last N card_reads on connect. Those are historical and
      // must NOT enqueue as fresh registration candidates here. /readout
      // still wants them (for its recent-reads history strip).
      ignoreReplayCardReads: true,
    });
    subscription.connect();
  });

  onDestroy(() => {
    // Drain the queue on unmount so stale entries don't carry across
    // navigation to /readout (which has different semantics — it
    // doesn't enqueue at all). Defensive against tab close without
    // explicit pop().
    cardQueue.clear();
    if (subscription) subscription.disconnect();
    if (toastTimer) clearTimeout(toastTimer);
  });

  // --- card-arrival handling ------------------------------------------------

  /** Re-beep of a card already bound to a competitor. Skip the queue;
   * fetch the bound row and surface a banner with the competitor name +
   * a Cancel-Registration CTA (writes manual_status=CANCEL → "Återbud"
   * in the readout). */
  function handleKnownCard(cardNumber: number): void {
    // If the banner is already showing for this card, do nothing.
    if (knownCard !== null && knownCard.card === cardNumber) return;
    cancelErr = null;
    void lookupCompetitorByCard(competitionId, cardNumber)
      .then((res) => {
        const hit = res.competitors[0] ?? null;
        if (hit) {
          knownCard = { card: cardNumber, competitor: hit };
        } else {
          // Race: card was unbound between classifyCard and this fetch.
          // Fall back to the queue path.
          handleIncomingCard(cardNumber, null);
        }
      })
      .catch(() => {
        handleIncomingCard(cardNumber, null);
      });
  }

  async function onCancelKnownRegistration(): Promise<void> {
    if (knownCard === null) return;
    cancelBusy = true;
    cancelErr = null;
    try {
      await setManualStatus(competitionId, knownCard.competitor.id, 'CANCEL', 'Återbud');
      toast(t('registration.cancelToast', { name: knownCard.competitor.name }));
      knownCard = null;
    } catch (e) {
      cancelErr = (e as Error).message;
    } finally {
      cancelBusy = false;
    }
  }

  function onDismissKnownCard(): void {
    knownCard = null;
    cancelErr = null;
  }

  function handleIncomingCard(cardNumber: number, hint: string | null): void {
    // Dedupe against the currently-open modal AND the queue. Same card
    // beeped twice while one of those holds it → toast + drop.
    if (currentCard !== null && currentCard.cardNumber === cardNumber) {
      toast(t('registration.dedupeToast', { card: cardNumber }));
      return;
    }
    if (!cardQueue.push(cardNumber, hint)) {
      // push() returns false when the queue already contains this card.
      toast(t('registration.dedupeToast', { card: cardNumber }));
      return;
    }
    // If no modal is currently open, pop the just-pushed card and mount.
    // F-003 race-fix: pop returns null when the queue is empty (e.g. two
    // events landed in the same microtask and both `if`-checked currentCard
    // before either popped). Only assign when pop actually yielded a card,
    // otherwise the next assign would clobber an already-mounted modal
    // with null. Pre-fix this could drop the first mount on two-cards-
    // in-one-tick.
    if (currentCard === null) {
      const next = cardQueue.pop();
      if (next !== null) mountCard(next);
    }
  }

  function mountCard(card: QueuedCard): void {
    currentCard = card;
    // Reset previous Eventor hint immediately so the modal doesn't see
    // stale data while the new lookup is in-flight.
    currentEventorHint = null;
    // Fire-and-forget Eventor lookup — same pattern as ReadoutView's
    // walkup-overlay handler. The modal mounts with cardHolderHint first;
    // when the lookup resolves, eventorHint takes over via WalkupModal's
    // $effect that reacts to late-arriving eventorHint props.
    void lookupEventorBySiCard(card.cardNumber, competitionId)
      .then((res) => {
        // Guard: another card could have been popped in the meantime
        // (operator hit Spara before the lookup resolved). Only apply
        // the hint if we still own this card.
        if (currentCard?.cardNumber !== card.cardNumber) return;
        // Pass hit: true (single resolved) and hit: 'many' (same-competition
        // shared card). WalkupModal auto-opens picker for 'many'.
        if (res.hit !== false) currentEventorHint = res;
      })
      .catch(() => {
        /* offline / 5xx — leave the firmware-hint path active */
      });
  }

  function onWalkupClose(_saved: boolean): void {
    // Cancel = discard, regardless of saved/not-saved. An earlier draft
    // pushed the current card back into the queue on !saved, which created
    // an infinite cancel-loop: with an empty queue, push-back + pop just
    // re-mounted the same card, so the operator couldn't dismiss without
    // completing the form. With multiple queued cards it cycled between
    // them indefinitely.
    //
    // The data-loss concern (Eventor pre-fill or operator typing being
    // discarded on a scrim tap) is already handled inside WalkupModal:
    // its `dirty` $derived covers name / club / classId / cardNumber /
    // hyrbricka fields, and a scrim tap on a dirty form shows the
    // 2-step "kasta?" confirm popover. The Avbryt button is the explicit-
    // discard path and skips the confirm by design — that's the operator
    // saying "I'm done with this card".
    //
    // The saved param stays in the signature so a future flow that wants
    // to differentiate save-vs-cancel still can.
    const next = cardQueue.pop();
    if (next !== null) {
      mountCard(next);
    } else {
      currentCard = null;
      currentEventorHint = null;
    }
  }

  function toast(msg: string): void {
    toastMessage = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastMessage = null;
    }, 3000);
  }

  // --- manual card entry (phone path: no SI reader, volunteer types the
  //     ID printed on the card). Goes through handleIncomingCard so the
  //     queue + dedupe + Eventor-prefill all reuse the existing flow.
  //     Also useful as a fallback on the desk laptop when a card won't
  //     beep (broken contacts, dirty connector). -----------------------
  let manualCard = $state('');
  let manualError = $state<string | null>(null);

  /** Returns the parsed card number or null if input is empty/invalid.
   * Empty string is considered "not yet entered" → no error surface,
   * but blur on a non-empty bad value surfaces inline so the operator
   * doesn't tap Submit to discover the typo. UX audit #10. */
  function validateManual(): number | null {
    const trimmed = manualCard.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 1 || !/^\d+$/.test(trimmed)) {
      manualError = t('registration.manualEntry.invalid');
      return null;
    }
    manualError = null;
    return n;
  }

  function onManualInput(): void {
    // Clear stale error eagerly as the operator corrects — re-validation
    // happens on blur or submit.
    if (manualError !== null) manualError = null;
  }
  function onManualBlur(): void {
    if (manualCard.trim() === '') {
      manualError = null;
      return;
    }
    validateManual();
  }

  function onManualSubmit(e: SubmitEvent): void {
    e.preventDefault();
    const n = validateManual();
    if (n === null) return;
    handleIncomingCard(n, null);
    manualCard = '';
    manualError = null;
  }

  // --- "Lägg till löpare manuellt" sheet — the no-card walk-up path. Same
  // AddRunnerSheet used on /runners; on /registrering it covers the case
  // where the runner walks up without their bricka, the operator searches
  // Eventor by name (or types fresh), saves, and the runner is registered
  // for the competition. No queue / WalkupModal involved — saving is
  // terminal here. ---------------------------------------------------------
  let addSheetOpen = $state(false);
  function openAddSheet(): void {
    addSheetOpen = true;
  }
  function closeAddSheet(): void {
    addSheetOpen = false;
  }
  function onAddSheetSaved(created: CompetitorDTO): void {
    addSheetOpen = false;
    toast(t('registration.addedToast', { name: created.name }));
  }

  /** Skip-ahead from the visible queue list: operator clicked a specific
   * queued card chip. If a modal is already open with a *different* card,
   * push the in-flight one back so we don't lose its work, then take the
   * clicked card and mount it. A no-op when the chip matches the
   * currently-mounted card. */
  function onQueueChipClick(cardNumber: number): void {
    if (currentCard !== null && currentCard.cardNumber === cardNumber) {
      return;
    }
    if (currentCard !== null) {
      cardQueue.push(currentCard.cardNumber, currentCard.cardHolderHint);
    }
    const next = cardQueue.take(cardNumber);
    if (next !== null) mountCard(next);
  }
</script>

<div class="registration" data-testid="registration-view">
  <header class="reg-head">
    <h1>{t('registration.title')}</h1>
    <p class="welcome">{t('registration.welcome')}</p>
    {#if cardQueue.count > 0}
      <span class="badge" data-testid="reg-queue-badge">
        {t('registration.queuedBadge', { count: cardQueue.count })}
      </span>
    {/if}
  </header>

  <form class="manual-row" onsubmit={onManualSubmit} data-testid="reg-manual-form">
    <input
      class="manual-input"
      type="tel"
      inputmode="numeric"
      pattern="\d*"
      autocomplete="off"
      bind:value={manualCard}
      oninput={onManualInput}
      onblur={onManualBlur}
      placeholder={t('registration.manualEntry.placeholder')}
      aria-label={t('registration.manualEntry.placeholder')}
      aria-invalid={manualError !== null}
      aria-describedby={manualError !== null ? 'reg-manual-error' : undefined}
      data-testid="reg-manual-input"
    />
    <button
      class="manual-btn"
      type="submit"
      disabled={manualCard.trim() === ''}
      data-testid="reg-manual-submit"
    >
      {t('registration.manualEntry.submit')}
    </button>
  </form>
  {#if manualError !== null}
    <p id="reg-manual-error" class="manual-err" role="alert" data-testid="reg-manual-error">
      {manualError}
    </p>
  {/if}

  <!-- No-card walk-up: open the same AddRunnerSheet used on /runners so
       the operator gets the Eventor-FTS5 smart-search (name + club free-
       text) as the no-bricka entry point. -->
  <button
    type="button"
    class="add-manual-btn"
    onclick={openAddSheet}
    data-testid="reg-add-manual-btn"
  >
    <Icon name="user-plus" size={16} />
    <span>{t('registration.addManualSheet')}</span>
  </button>

  {#if cardQueue.count > 0}
    <section class="reg-queue" data-testid="reg-queue-list">
      <header class="reg-queue-head">
        <h2>{t('registration.queueHeading')}</h2>
        <span class="reg-queue-count mono">{cardQueue.count}</span>
      </header>
      <ul class="reg-queue-items">
        {#each cardQueue.items as q (q.cardNumber)}
          <li>
            <button
              type="button"
              class="reg-queue-chip"
              data-testid="reg-queue-chip"
              onclick={() => onQueueChipClick(q.cardNumber)}
            >
              <span class="mono">{q.cardNumber}</span>
              {#if q.cardHolderHint}
                <span class="hint">{q.cardHolderHint}</span>
              {/if}
              <span class="cta">{t('registration.queue.open')}</span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if knownCard !== null}
    <section
      class="known-banner"
      role="status"
      aria-live="polite"
      data-testid="reg-known-banner"
    >
      <div class="known-row">
        <div class="known-info">
          <span class="known-card mono">{knownCard.card}</span>
          <span class="known-label">{t('registration.alreadyRegistered')}</span>
          <strong class="known-name">{knownCard.competitor.name}</strong>
          {#if knownCard.competitor.club}
            <span class="known-club">{knownCard.competitor.club}</span>
          {/if}
        </div>
        <div class="known-actions">
          <button
            type="button"
            class="known-dismiss"
            onclick={onDismissKnownCard}
            disabled={cancelBusy}
            data-testid="reg-known-dismiss"
          >
            {t('registration.knownDismiss')}
          </button>
          <button
            type="button"
            class="known-cancel"
            onclick={() => void onCancelKnownRegistration()}
            disabled={cancelBusy}
            data-testid="reg-known-cancel"
          >
            {cancelBusy
              ? t('registration.cancelling')
              : t('registration.cancelRegistration')}
          </button>
        </div>
      </div>
      {#if cancelErr}
        <p class="known-err" role="alert">{cancelErr}</p>
      {/if}
    </section>
  {/if}

  {#if currentCard === null && cardQueue.count === 0 && knownCard === null}
    <p class="empty" data-testid="reg-empty">{t('registration.empty')}</p>
  {/if}

  {#if currentCard !== null}
    <!-- Keying on cardNumber unmounts + remounts WalkupModal on
         auto-advance so its $state form fields (name, club, classId,
         cardNumberLocal) re-initialize for the next queued card.
         Without this, WalkupModal would keep the prior card's
         cardNumberLocal because $state(...) only runs at mount. -->
    {#key currentCard.cardNumber}
      <WalkupModal
        cardNumber={currentCard.cardNumber}
        {competitionId}
        classes={resolvedClasses}
        cardHolderHint={currentCard.cardHolderHint}
        eventorHint={currentEventorHint}
        onClose={onWalkupClose}
      />
    {/key}
  {/if}

  {#if toastMessage !== null}
    <div class="toast" role="status" data-testid="reg-toast">{toastMessage}</div>
  {/if}
</div>

<AddRunnerSheet
  open={addSheetOpen}
  {competitionId}
  classes={resolvedClasses}
  onClose={closeAddSheet}
  onSaved={onAddSheetSaved}
/>

<style>
  .registration {
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
    padding: var(--space-lg);
    min-height: 100%;
    position: relative;
  }
  .reg-head {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: flex-start;
  }
  .reg-head h1 {
    margin: 0;
    font-size: var(--fs-heading);
    font-weight: 600;
  }
  .reg-head .welcome {
    margin: 0;
    color: var(--fg-muted);
    font-size: 14px;
  }
  .reg-head .badge {
    align-self: flex-start;
    margin-top: 6px;
    background: var(--accent);
    color: #fff;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-family: var(--font-mono);
    font-feature-settings:
      'tnum' 1,
      'zero' 1;
  }
  .empty {
    margin: 0;
    padding: var(--space-xl) var(--space-lg);
    text-align: center;
    color: var(--fg-muted);
    background: var(--bg-elev);
    border: 1px dashed var(--border);
    border-radius: var(--radius-lg);
    font-size: 15px;
  }
  /* Manual card entry — phone path (no SI reader). Desktop also keeps
     it visible as a fallback for "card won't beep". */
  .manual-row {
    display: flex;
    gap: var(--space-sm);
    align-items: stretch;
  }
  .manual-input {
    flex: 1;
    height: var(--hit);
    min-height: var(--hit);
    padding: 0 var(--space-sm);
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    font-size: var(--fs-body);
    font-family: var(--font-mono);
    color: var(--fg);
  }
  .manual-input:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
    border-color: var(--accent);
  }
  .manual-btn {
    height: var(--hit);
    min-height: var(--hit);
    padding: 0 var(--space-md);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--accent-fg);
    font-size: var(--fs-label);
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }
  .manual-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .manual-err {
    margin: -4px 0 0;
    color: var(--dnf);
    font-size: 13px;
  }
  .add-manual-btn {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: var(--hit);
    min-height: var(--hit);
    padding: 0 var(--space-md);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--bg-elev);
    color: var(--fg);
    font-size: var(--fs-label);
    font-weight: 500;
    cursor: pointer;
    margin-top: -4px;
  }
  .add-manual-btn:hover {
    background: var(--bg-sunken);
  }
  /* Visible card queue — operators can click any chip to skip-ahead to
     that card instead of waiting for FIFO auto-advance. Mirrors the
     /readout pending-unknown-cards section so muscle memory carries. */
  .reg-queue {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .reg-queue-head {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border);
  }
  .reg-queue-head h2 {
    margin: 0;
    font-size: var(--fs-label);
    font-weight: 600;
    color: var(--fg);
  }
  .reg-queue-count {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 8px;
    background: var(--mp-soft);
    color: oklch(0.45 0.12 70);
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
  }
  .reg-queue-items {
    list-style: none;
    margin: 0;
    padding: var(--space-xs);
    display: grid;
    gap: var(--space-2xs);
  }
  .reg-queue-chip {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    height: var(--hit);
    min-height: var(--hit);
    padding: 0 var(--space-md);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--fg);
    font-size: var(--fs-label);
    text-align: left;
    cursor: pointer;
  }
  .reg-queue-chip:hover {
    background: var(--bg-sunken);
    border-color: var(--border-strong);
  }
  .reg-queue-chip .mono {
    font-family: var(--font-mono);
    font-weight: 600;
  }
  .reg-queue-chip .hint {
    color: var(--fg-muted);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .reg-queue-chip .cta {
    margin-left: auto;
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
  }
  .known-banner {
    background: var(--accent-soft, var(--bg-elev));
    border: 1px solid var(--accent);
    border-radius: var(--radius-lg);
    padding: var(--space-sm) var(--space-md);
    display: grid;
    gap: var(--space-xs);
  }
  .known-row {
    display: flex;
    align-items: center;
    gap: var(--space-md);
    flex-wrap: wrap;
  }
  .known-info {
    display: flex;
    align-items: baseline;
    gap: var(--space-xs);
    flex-wrap: wrap;
    flex: 1;
    min-width: 0;
  }
  .known-card.mono {
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 15px;
    color: var(--accent);
  }
  .known-label {
    color: var(--fg-muted);
    font-size: 13px;
  }
  .known-name {
    font-size: 15px;
    font-weight: 600;
    color: var(--fg);
  }
  .known-club {
    color: var(--fg-muted);
    font-size: 13px;
  }
  .known-actions {
    display: flex;
    gap: var(--space-2xs);
  }
  .known-dismiss,
  .known-cancel {
    height: var(--hit);
    min-height: var(--hit);
    padding: 0 var(--space-md);
    border-radius: var(--radius);
    font: inherit;
    font-size: var(--fs-label);
    font-weight: 500;
    cursor: pointer;
  }
  .known-dismiss {
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--fg);
  }
  .known-dismiss:hover:not(:disabled) {
    background: var(--bg-sunken);
  }
  .known-cancel {
    background: var(--dnf);
    border: 1px solid var(--dnf);
    color: #fff;
  }
  .known-cancel:hover:not(:disabled) {
    filter: brightness(0.92);
  }
  .known-dismiss:disabled,
  .known-cancel:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .known-err {
    margin: 0;
    color: var(--dnf);
    font-size: 13px;
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
    font-size: 13px;
    box-shadow: var(--shadow-lg);
    z-index: 100;
  }
</style>
