<!--
  Authored for fartola. Not ported from upstream.

  WalkupModal — overlay-on-readout walk-up registration (C-M3 LOCKED).
  Mounted by ReadoutView when ?walkup=<cardNumber> is present in the
  URL. There is NO standalone /walkup route file.

  Form per UI-SPEC §"Walk-up modal":
   - Namn (required, min 2, autofocus)
   - Klubb (optional, ClubAutocomplete)
   - Klass (required, select from props.classes)
   - Bricka (pre-filled from props.cardNumber, editable, int ≥ 1)
   - Consent (checkbox, default checked — REQ-PRIV-001)

  On Spara: POST /api/competitors with consent: true AND
  consent_status='explicit' (matches plan 02 schema default). On 201 →
  goto(/competition/<id>/readout) which strips the ?walkup param so
  the overlay unmounts naturally. On 409 'card_taken' → banner with a
  "Korrigera bricka" affordance that re-submits with
  replace_card_for_competitor_id (plan 10 route).

  Avbryt / Esc → same goto, no POST. The Esc binding is owned by
  ReadoutView (plan 13) so we don't duplicate it here.

  Locked by:
  - 01-14-PLAN.md task 1
  - 01-UI-SPEC.md §"Walk-up modal" (LOCKED form contract)
  - 01-REVIEWS.md §C-M3 (overlay-on-readout, no /walkup route)
  - REQ-PRIV-001 (explicit consent literal)
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { createCompetitor, lookupEventorBySiCard } from '$lib/api/client.ts';
  import { t } from '$lib/i18n/index.ts';
  import Button from '$lib/ui/Button.svelte';
  import Field from '$lib/ui/Field.svelte';
  import Input from '$lib/ui/Input.svelte';
  import Select from '$lib/ui/Select.svelte';
  import SmartRunnerSearch from '$lib/components/SmartRunnerSearch.svelte';
  import SmartClubSearch from '$lib/components/SmartClubSearch.svelte';
  import type { EventorClubSuggestion } from '@fartola/shared-types';
  import { ApiError } from '$lib/api/client.ts';
  import type {
    ClassDTO,
    EventorLookupHit,
    EventorLookupMany,
    EventorLookupCandidate,
    EventorNameSuggestion,
  } from '@fartola/shared-types';

  interface Props {
    cardNumber: number;
    competitionId: string;
    classes: ClassDTO[];
    /** Optional SI card firmware-side name hint. When non-null, pre-fills
     * the name field so the operator only confirms instead of re-typing.
     * Empty string is treated the same as null. */
    cardHolderHint?: string | null;
    /** Phase 2.0 Plan 02-02 — optional Eventor-cache pre-fill (the result
     * of `lookupEventorBySiCard(cardNumber)`). When `hit: true`, the name
     * AND klubb fields populate from this — wins over `cardHolderHint`
     * per RESEARCH §"Plan 2 nuance". When null OR `hit: false`, the
     * cardHolderHint fallback applies.
     * Plan 02.1-10: also accepts EventorLookupMany — when hit: 'many', the
     * picker auto-opens so the operator chooses the correct person. When
     * hit: true and alternatives > 0, a +N andra chip appears. */
    eventorHint?: EventorLookupHit | EventorLookupMany | null;
    /** Phase 2.0 Plan 02-02b — parent-driven close callback. When
     * supplied (RegistrationView, plan 02-02b task 3), `close()` calls
     * this INSTEAD of `goto(/readout)` so the parent can drive
     * auto-advance to the next queued card without a router round-trip.
     * When null (Phase 1 /readout path), close() falls back to the
     * existing `goto(/competition/<id>/readout)` URL-strip behavior. */
    /** Close handler. The `saved` arg lets the parent distinguish a
     * successful save (true) from an operator-cancelled close (scrim tap,
     * cancel button, escape key — all false). Used by RegistrationView to
     * push the unsaved card back into the queue instead of dropping it. */
    onClose?: ((saved: boolean) => void) | null;
  }

  let {
    cardNumber,
    competitionId,
    classes,
    cardHolderHint = null,
    eventorHint = null,
    onClose = null,
  }: Props = $props();

  // --- form state -----------------------------------------------------------
  // Pre-fill name from Eventor cache when available (wins per Plan 2 nuance),
  // otherwise from the SI card's card_holder field when the firmware
  // carried one (rental fleet cards usually didn't; personal cards often
  // did). Operator can still edit before submit.
  function initialName(): string {
    if (eventorHint && eventorHint.hit === true) {
      return `${eventorHint.family_name}, ${eventorHint.given_name}`;
    }
    if (cardHolderHint && cardHolderHint.length > 0) return cardHolderHint;
    return '';
  }
  function initialClub(): string {
    if (eventorHint && eventorHint.hit === true && eventorHint.club_name) {
      return eventorHint.club_name;
    }
    return '';
  }
  let name = $state(initialName());
  let club = $state(initialClub());
  /** Federation club_id once a club is locked — either via the SmartClubSearch
   * picker, via an Eventor name pick that carried a club, or via the
   * card-scan eventorHint. When non-null, SmartRunnerSearch narrows its
   * FTS5 query to this club (drowns-by-rank fix for common names).
   * Cleared when the operator types freely into Klubb. */
  let selectedClubId = $state<number | null>(null);

  // Plan 02.1-10 — +N andra chip state.
  // When the Eventor lookup resolves to hit: true with alternatives > 0,
  // the chip shows "+N andra" beside the pre-filled name. When the result
  // is hit: 'many' (same-competition shared card), the picker auto-opens
  // so the operator must disambiguate before continuing.
  let showAlternativesPicker = $state(
    untrack(() => eventorHint?.hit === 'many')
  );
  let alternativesCandidates = $state<EventorLookupCandidate[]>(
    untrack(() => {
      if (eventorHint?.hit === 'many') return eventorHint.candidates;
      if (eventorHint?.hit === true && eventorHint.alternatives > 0) return eventorHint.allCandidates;
      return [];
    })
  );

  // When eventorHint arrives asynchronously after mount (the parent
  // ReadoutView fetches the lookup in an $effect), reflect the cached
  // values into the form state as long as the operator hasn't already
  // typed something. This makes the late-arriving hit "win" over the
  // empty initial state without clobbering operator edits.
  $effect(() => {
    if (eventorHint && eventorHint.hit === true) {
      if (name.trim() === '') {
        name = `${eventorHint.family_name}, ${eventorHint.given_name}`;
      }
      if (club.trim() === '' && eventorHint.club_name) {
        club = eventorHint.club_name;
      }
      if (selectedClubId === null && eventorHint.club_id !== null) {
        selectedClubId = eventorHint.club_id;
      }
      if (eventorFillNote === null) eventorFillNote = t('walk.eventor.fill');
      // Update candidates list when hint arrives asynchronously.
      if (eventorHint.alternatives > 0 && alternativesCandidates.length === 0) {
        alternativesCandidates = eventorHint.allCandidates;
      }
    } else if (eventorHint && eventorHint.hit === 'many') {
      // Same-competition shared card → auto-open picker.
      showAlternativesPicker = true;
      alternativesCandidates = eventorHint.candidates;
    }
  });
  let classId = $state('');
  // The initial cardNumber prop is the URL's ?walkup=<n> coercion; we copy
  // it once into local state so the operator can edit (UI-SPEC §"Walk-up
  // modal" — Bricka editable to correct misread). Wrapped in a function-
  // form initializer so svelte-check doesn't flag the prop reference as
  // captured-at-init (warning state_referenced_locally).
  const initialCard: number | '' = untrack(() => (cardNumber > 0 ? cardNumber : ''));
  let cardNumberLocal = $state<number | ''>(initialCard);
  let consent = $state(true);

  // Phase 2.0 D-HB-3 — Hyrbricka checkbox + expandable contact fields.
  // The contact fields appear only when hiredCard=true; validate() enforces
  // "at least phone OR email" before save (server is authoritative; UI is
  // best-effort UX so the operator doesn't round-trip to discover the gate).
  let hiredCard = $state(false);
  let contactName = $state('');
  let contactPhone = $state('');
  let contactEmail = $state('');
  let contactNote = $state('');

  // Lightweight info note when the form was pre-filled from the Eventor
  // cache. Cleared on first edit so it doesn't linger.
  let eventorFillNote = $state<string | null>(
    untrack(() => (eventorHint && eventorHint.hit === true ? t('walk.eventor.fill') : null))
  );

  // --- ui state -------------------------------------------------------------
  let saving = $state(false);
  /** Inline error for field validation. */
  let fieldError = $state<string | null>(null);
  /** Banner on 409 — captures the existing competitor so the operator can
   * trigger a replace-card flow on the SAME row. */
  let cardTakenExistingId = $state<string | null>(null);
  /** Level-A mobile resilience (2026-05-17): raw network failures get a
   * dedicated prominent banner with a "Försök igen" CTA, separate from
   * the small fieldError surface so a volunteer on a phone notices
   * immediately when the save didn't land. The form stays populated. */
  let networkError = $state(false);

  /** Dirty-check (UI/UX audit #2, 2026-05-17): when the operator has
   * typed anything that would be discarded on close, scrim-tap shows a
   * confirm row instead of dropping the form. At the registration desk
   * one accidental tap = one runner lost from the queue. The Esc + the
   * explicit Avbryt button still close without confirm — they're
   * explicit intent. */
  const initialNameVal = untrack(initialName);
  const initialClubVal = untrack(initialClub);
  const dirty = $derived(
    name !== initialNameVal ||
      club !== initialClubVal ||
      classId !== '' ||
      cardNumberLocal !== initialCard ||
      hiredCard !== false ||
      contactName !== '' ||
      contactPhone !== '' ||
      contactEmail !== '' ||
      contactNote !== ''
  );
  let confirmingClose = $state(false);

  function onScrimTap(): void {
    if (dirty && !confirmingClose) {
      confirmingClose = true;
      return;
    }
    close();
  }
  function cancelClose(): void {
    confirmingClose = false;
  }

  function close(saved: boolean = false): void {
    // Phase 2.0 Plan 02-02b: when the parent supplies onClose (the
    // registration desk drives auto-advance), invoke it with the saved
    // flag so the parent can decide whether to push the card back into
    // the queue (saved=false) or drop it (saved=true). The Phase 1
    // /readout path leaves onClose null and falls through to the
    // URL-strip goto; the saved flag is irrelevant there.
    if (onClose !== null) {
      onClose(saved);
      return;
    }
    void goto(`/competition/${competitionId}/readout`);
  }

  function onNameChange(next: string): void {
    name = next;
    eventorFillNote = null;
  }

  /** Eventor picker callback — SmartRunnerSearch (unlike the old datalist
   * autocomplete) doesn't write back into the input, so we set the
   * canonical "Family, Given" form here. Also lift club_name into the
   * klubb field, and pre-fill the bricka if the cache row has one. */
  function onEventorPick(s: EventorNameSuggestion): void {
    name = `${s.family_name}, ${s.given_name}`;
    if (s.club_name) club = s.club_name;
    if (s.si_card !== null && cardNumberLocal === '') {
      cardNumberLocal = s.si_card;
    }
    eventorFillNote = t('walk.eventor.fill');
  }

  function onClubPick(s: EventorClubSuggestion): void {
    club = s.name;
    selectedClubId = s.club_id;
  }
  function onClubChange(v: string): void {
    club = v;
    // Free-text editing invalidates the picked club_id — without this clear
    // a stale selectedClubId would keep narrowing the name search to a
    // club the operator has moved past.
    selectedClubId = null;
  }

  function validate(): string | null {
    if (name.trim().length < 2) return t('walk.err.name');
    if (!classId) return t('walk.err.classRequired');
    if (typeof cardNumberLocal !== 'number' || cardNumberLocal < 1) {
      return t('walk.err.cardRequired');
    }
    if (!consent) return t('walk.err.consent');
    // D-HB-3 — at least phone OR email required when Hyrbricka set.
    if (hiredCard && contactPhone.trim() === '' && contactEmail.trim() === '') {
      return t('walk.err.hyrbrickaContact');
    }
    return null;
  }

  async function onSave(): Promise<void> {
    fieldError = null;
    cardTakenExistingId = null;
    networkError = false;
    const err = validate();
    if (err !== null) {
      fieldError = err;
      return;
    }

    saving = true;
    try {
      await createCompetitor({
        competition_id: competitionId,
        name: name.trim(),
        club: club.trim() === '' ? null : club.trim(),
        class_id: classId,
        card_number: cardNumberLocal as number,
        consent: true,
        consent_status: 'explicit',
        hired_card: hiredCard,
        ...(hiredCard
          ? {
              hired_contact: {
                name: contactName.trim() === '' ? null : contactName.trim(),
                phone: contactPhone.trim() === '' ? null : contactPhone.trim(),
                email: contactEmail.trim() === '' ? null : contactEmail.trim(),
                note: contactNote.trim() === '' ? null : contactNote.trim(),
              },
            }
          : { hired_contact: null }),
      });
      // Success — back to readout, query param cleared. Pass saved=true so
      // a parent that tracks unsaved cards (RegistrationView) drops this
      // one rather than re-queueing it.
      close(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { error?: string; existing_competitor_id?: string } | undefined;
        if (body && body.error === 'card_taken' && typeof body.existing_competitor_id === 'string') {
          cardTakenExistingId = body.existing_competitor_id;
        } else {
          fieldError = t('err.network');
        }
      } else if (e instanceof ApiError && e.status === 400) {
        const body = e.body as { error?: string } | undefined;
        if (body && body.error === 'hyrbricka_contact_required') {
          // Server-side authoritative gate; surface its message.
          fieldError = t('walk.err.hyrbrickaContact');
        } else {
          fieldError = (e as Error).message ?? t('err.network');
        }
      } else if (e instanceof ApiError) {
        // Other ApiError (5xx etc.) — server responded, surface the message.
        fieldError = (e as Error).message ?? t('err.network');
      } else {
        // Not an ApiError → raw fetch failure even after the client's
        // built-in 1-shot retry. The form stays populated; the operator
        // gets the prominent banner with an explicit Försök-igen CTA.
        networkError = true;
      }
    } finally {
      saving = false;
    }
  }

  // Phase 2.0 Plan 02-02 — when the operator changes the bricka number
  // (rare in walkup; usually inherited from props), debounce a lookup
  // against the Eventor cache and pre-fill name + club on a hit. Keeps
  // the existing pre-fill behaviour additive — never overwrites a field
  // the operator has already typed in.
  let cardLookupTimer: ReturnType<typeof setTimeout> | null = null;
  function onCardEdit(): void {
    if (cardLookupTimer) clearTimeout(cardLookupTimer);
    cardLookupTimer = setTimeout(() => {
      void doCardLookup();
    }, 200);
  }
  async function doCardLookup(): Promise<void> {
    if (typeof cardNumberLocal !== 'number' || cardNumberLocal < 1) return;
    try {
      const r = await lookupEventorBySiCard(cardNumberLocal, competitionId);
      if (r.hit === true) {
        // Resolved single winner (unique or recency/context). Auto-fill name
        // and club; show chip when alternatives > 0.
        if (name.trim() === '') name = `${r.family_name}, ${r.given_name}`;
        if (club.trim() === '' && r.club_name) club = r.club_name;
        eventorFillNote = t('walk.eventor.fill');
        if (r.alternatives > 0) {
          alternativesCandidates = r.allCandidates;
        }
      } else if (r.hit === 'many') {
        // Same-competition shared card → open picker so operator disambiguates.
        showAlternativesPicker = true;
        alternativesCandidates = r.candidates;
      }
      // r.hit === false (miss) → leave form untouched.
    } catch {
      // Soft fail — the form still works without the cache.
    }
  }

  /** Pick a candidate from the alternatives picker (called from the chip popover
   * or the auto-opened same-competition disambiguation picker). */
  function onAlternativePick(candidate: EventorLookupCandidate): void {
    name = `${candidate.family_name}, ${candidate.given_name}`;
    if (candidate.club_name) club = candidate.club_name;
    selectedClubId = candidate.club_id;
    eventorFillNote = t('walk.eventor.fill');
    showAlternativesPicker = false;
  }

  /** 409 replace-card path: re-issue the POST with
   * replace_card_for_competitor_id set. This corrects a misread where the
   * previous walk-up was for the SAME runner under a wrong card number. */
  async function onCorrectCard(): Promise<void> {
    if (cardTakenExistingId === null) return;
    fieldError = null;
    saving = true;
    try {
      await createCompetitor({
        competition_id: competitionId,
        club: null,
        card_number: cardNumberLocal as number,
        hired_card: hiredCard,
        replace_card_for_competitor_id: cardTakenExistingId,
      });
      // Same as the main save path — saved=true so the parent's queue
      // logic drops this card.
      close(true);
    } catch (e) {
      fieldError = (e as Error).message ?? t('err.network');
    } finally {
      saving = false;
    }
  }
</script>

<div class="walkup-scrim" role="presentation" data-testid="walkup-overlay" onclick={onScrimTap}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="walkup-modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="walkup-title"
    data-testid="walkup-modal"
    tabindex={-1}
    onclick={(e) => e.stopPropagation()}
  >
    <header class="head">
      <h2 id="walkup-title">{t('walk.title')}</h2>
      <p class="desc">{t('walk.desc')}</p>
    </header>

    <form
      class="body"
      novalidate
      onsubmit={(e) => {
        e.preventDefault();
        void onSave();
      }}
    >
      <Field label={t('walk.name')} htmlFor="walkup-name">
        <SmartRunnerSearch
          id="walkup-name"
          value={name}
          placeholder={t('walk.name.ph')}
          clubId={selectedClubId}
          onValue={onNameChange}
          onPick={onEventorPick}
        />
      </Field>

      {#if eventorFillNote}
        <p class="info" data-testid="walkup-eventor-fill">{eventorFillNote}</p>
      {/if}

      {#if eventorHint?.hit === true && eventorHint.alternatives > 0}
        <!-- +N andra chip: operator confirmed the recency pick but can override -->
        <button
          type="button"
          class="alternatives-chip"
          data-testid="walkup-alternatives-chip"
          onclick={() => {
            showAlternativesPicker = !showAlternativesPicker;
          }}
        >
          {t('walk.alternatives.chip', { n: String(eventorHint.alternatives) })}
        </button>
      {/if}

      {#if showAlternativesPicker && alternativesCandidates.length > 0}
        <!-- Alternatives picker: shown for +N chip or auto-opened for 'many' -->
        <div class="alternatives-picker" data-testid="walkup-alternatives-picker" role="listbox" aria-label={t('walk.alternatives.picker.title')}>
          <p class="alternatives-picker-title">{t('walk.alternatives.picker.title')}</p>
          {#each alternativesCandidates as candidate (candidate.person_id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="alternatives-candidate"
              data-testid="walkup-alternative-{candidate.person_id}"
              role="option"
              aria-selected={false}
              onclick={() => onAlternativePick(candidate)}
            >
              <span class="alt-name">{candidate.family_name}, {candidate.given_name}</span>
              {#if candidate.club_name}
                <span class="alt-club">{candidate.club_name}</span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      <Field label={t('walk.club')} htmlFor="walkup-club">
        <SmartClubSearch
          id="walkup-club"
          value={club}
          placeholder={t('walk.club.ph')}
          onValue={onClubChange}
          onPick={onClubPick}
        />
      </Field>

      <Field label={t('walk.bana')} htmlFor="walkup-class">
        <Select id="walkup-class" data-testid="walkup-class" bind:value={classId} required>
          <option value="" disabled>{t('walk.banaPlaceholder')}</option>
          {#each classes as cls (cls.id)}
            <option value={cls.id}>{cls.name}</option>
          {/each}
        </Select>
      </Field>

      <Field label={t('walk.card')} htmlFor="walkup-card">
        <Input
          id="walkup-card"
          data-testid="walkup-card"
          type="number"
          min={1}
          step={1}
          bind:value={cardNumberLocal}
          oninput={onCardEdit}
          required
        />
      </Field>

      <label class="consent-row">
        <input
          type="checkbox"
          data-testid="walkup-consent"
          bind:checked={consent}
        />
        <span>{t('walk.consent')}</span>
      </label>

      <!-- Phase 2.0 D-HB-3 — Hyrbricka checkbox + expandable contact fields. -->
      <label class="consent-row">
        <input
          type="checkbox"
          data-testid="walkup-hired"
          bind:checked={hiredCard}
        />
        <span>{t('walk.hyrbricka')}</span>
      </label>

      {#if hiredCard}
        <div class="hired-fields" data-testid="walkup-hired-fields">
          <Field label={t('walk.hyrbricka.name')} htmlFor="walkup-hc-name">
            <Input
              id="walkup-hc-name"
              data-testid="walkup-hc-name"
              bind:value={contactName}
            />
          </Field>
          <Field label={t('walk.hyrbricka.phone')} htmlFor="walkup-hc-phone">
            <Input
              id="walkup-hc-phone"
              data-testid="walkup-hc-phone"
              type="tel"
              bind:value={contactPhone}
            />
          </Field>
          <Field label={t('walk.hyrbricka.email')} htmlFor="walkup-hc-email">
            <Input
              id="walkup-hc-email"
              data-testid="walkup-hc-email"
              type="email"
              bind:value={contactEmail}
            />
          </Field>
          <Field label={t('walk.hyrbricka.note')} htmlFor="walkup-hc-note">
            <Input
              id="walkup-hc-note"
              data-testid="walkup-hc-note"
              bind:value={contactNote}
            />
          </Field>
        </div>
      {/if}

      {#if fieldError}
        <p class="err" data-testid="walkup-error">{fieldError}</p>
      {/if}

      {#if cardTakenExistingId}
        <p class="banner" data-testid="walkup-card-taken">
          {t('walk.err.cardTaken', { card: String(cardNumberLocal) })}
        </p>
      {/if}

      {#if networkError}
        <div class="net-err" role="alert" data-testid="walkup-network-error">
          <strong class="net-err-title">{t('err.networkPersistent.title')}</strong>
          <p class="net-err-body">{t('err.networkPersistent.body')}</p>
        </div>
      {/if}

      {#if confirmingClose}
        <div class="discard-confirm" role="alert" data-testid="walkup-discard-confirm">
          <p class="discard-msg">{t('walk.discard.msg')}</p>
          <div class="discard-actions">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onclick={cancelClose}
              data-testid="walkup-discard-cancel"
            >
              {t('walk.discard.keep')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              type="button"
              onclick={() => close(false)}
              data-testid="walkup-discard-confirm-btn"
            >
              {t('walk.discard.discard')}
            </Button>
          </div>
        </div>
      {/if}

      <footer class="foot">
        <Button
          variant="ghost"
          type="button"
          onclick={() => close(false)}
          disabled={saving}
          data-testid="walkup-cancel"
        >
          {t('walk.cancel')}
        </Button>
        {#if cardTakenExistingId}
          <Button
            variant="danger"
            type="button"
            onclick={() => void onCorrectCard()}
            disabled={saving}
            data-testid="walkup-correct-card"
          >
            {t('walk.err.replaceCard')}
          </Button>
        {:else if networkError}
          <Button
            variant="primary"
            type="submit"
            disabled={saving}
            data-testid="walkup-network-retry"
          >
            {t('err.networkPersistent.retry')}
          </Button>
        {:else}
          <Button
            variant="primary"
            type="submit"
            disabled={saving}
            data-testid="walkup-save"
          >
            {t('walk.save')}
          </Button>
        {/if}
      </footer>
    </form>
  </div>
</div>

<style>
  .walkup-scrim {
    position: fixed;
    inset: 0;
    background: rgba(20, 20, 30, 0.32);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-lg);
    z-index: 50;
    backdrop-filter: blur(2px);
  }
  .walkup-modal {
    background: var(--bg-elev);
    border-radius: 14px;
    box-shadow: var(--shadow-lg);
    width: min(560px, 100%);
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .head {
    padding: 18px 22px 8px;
    border-bottom: 1px solid var(--border);
  }
  @media (max-width: 480px) {
    .walkup-scrim {
      padding: var(--space-sm);
    }
    .head {
      padding: 14px 16px 6px;
    }
    .body {
      padding: 14px 16px;
    }
  }
  .head h2 {
    margin: 0 0 4px;
    font-size: var(--fs-heading);
    font-weight: 600;
  }
  .desc {
    margin: 0;
    color: var(--fg-muted);
    font-size: 13px;
  }
  .body {
    padding: 18px 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow: auto;
  }
  .consent-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: 13px;
    color: var(--fg-muted);
    line-height: 1.4;
    cursor: pointer;
  }
  .consent-row input[type='checkbox'] {
    margin-top: 3px;
    flex-shrink: 0;
  }
  .err {
    margin: 0;
    color: var(--dnf);
    font-size: 13px;
  }
  .info {
    margin: 0;
    color: var(--fg-muted);
    font-size: 12px;
    font-style: italic;
  }
  .hired-fields {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 10px 12px;
    background: var(--bg-soft, rgba(0, 0, 0, 0.03));
    border-radius: var(--radius);
  }
  .banner {
    margin: 0;
    background: var(--dnf-soft);
    color: var(--dnf);
    padding: 10px 12px;
    border-radius: var(--radius);
    font-size: 13px;
  }
  /* Level-A mobile resilience banner — visually heavier than .banner so a
     volunteer on a phone notices it across the room. Survives until the
     next Save attempt clears `networkError`. */
  .net-err {
    margin: 4px 0 0;
    background: var(--dnf);
    color: #fff;
    padding: 12px 14px;
    border-radius: var(--radius);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .net-err-title {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .net-err-body {
    margin: 0;
    font-size: 13px;
    line-height: 1.35;
  }
  .foot {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding-top: 6px;
  }
  /* Discard-confirm bar — visible only when the operator taps the
     scrim with unsaved edits. Visually heavy enough that an accidental
     tap won't be missed; lives inside the modal body so it stays in
     visual context with the form. */
  .discard-confirm {
    margin: 4px 0 0;
    padding: 10px 12px;
    background: var(--mp-soft);
    border: 1px solid var(--mp);
    border-radius: var(--radius);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .discard-msg {
    margin: 0;
    color: var(--fg);
    font-size: 13.5px;
    font-weight: 500;
  }
  .discard-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  /* +N andra chip — indicates recency-resolved duplicate, lets operator override */
  .alternatives-chip {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    background: var(--mp-soft, rgba(200, 150, 0, 0.1));
    border: 1px solid var(--mp, #c89600);
    border-radius: 99px;
    color: var(--mp, #c89600);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    align-self: flex-start;
    line-height: 1.4;
  }
  .alternatives-chip:hover {
    background: var(--mp-soft, rgba(200, 150, 0, 0.2));
  }
  /* Alternatives picker — inline popover listing all candidates */
  .alternatives-picker {
    background: var(--bg-elev, #fff);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .alternatives-picker-title {
    margin: 0;
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 600;
    color: var(--fg-muted);
    border-bottom: 1px solid var(--border);
  }
  .alternatives-candidate {
    display: flex;
    flex-direction: column;
    padding: 8px 12px;
    cursor: pointer;
    gap: 2px;
  }
  .alternatives-candidate:hover {
    background: var(--bg-soft, rgba(0, 0, 0, 0.04));
  }
  .alternatives-candidate + .alternatives-candidate {
    border-top: 1px solid var(--border);
  }
  .alt-name {
    font-size: 13.5px;
    font-weight: 500;
    color: var(--fg);
  }
  .alt-club {
    font-size: 12px;
    color: var(--fg-muted);
  }
</style>
