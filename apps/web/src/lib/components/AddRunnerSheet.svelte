<!--
  Authored for fartola. Not ported from upstream.

  AddRunnerSheet — manual "Lägg till löpare" surface mounted from
  RunnersListView. Distinct from WalkupModal (which is the card-driven,
  unknown-bricka overlay on /readout): this is operator-driven, name- or
  card-first, used before/around the race when someone walks up without
  pre-registering or without their bricka.

  Layout (per ui-ux-pro-max consult):
    [Sök i Eventor……………………]   <-- SmartRunnerSearch
    └─ live results popover (FTS5 — name/club/given/family/card)

    — Eller fyll i manuellt: —
    [ Namn        ____________]
    [ Klubb       ____________]  [☐ Klubblös]    <-- SmartClubSearch + toggle
    [ Klass       ▾]
    [ Bricka      ____]          [☐ Hyrbricka]

  Save → POST /api/competitors with consent: true / consent_status: 'explicit'
  → onSaved(newCompetitor) → parent closes sheet + refreshes list.

  Hyrbricka note: ticking Hyrbricka expands a small contact block
  (phone + email). D-HB-3 — the server requires at least one of the two
  whenever hired_card=true; submitting without contact otherwise produces
  a guaranteed 400 hyrbricka_contact_required. We keep the surface lean
  (just phone + email, no contact-name / note) since the full management
  view lives at /hyrbrickor; the goal here is enough to chase a
  non-returner.
-->
<script lang="ts">
  import { t } from '#lib/i18n/index.ts';
  import { ApiError, createCompetitor } from '#lib/api/client.ts';
  import type {
    ClassDTO,
    CompetitorDTO,
    EventorNameSuggestion,
    EventorClubSuggestion,
  } from '@fartola/shared-types';
  import Modal from '#lib/ui/Modal.svelte';
  import Button from '#lib/ui/Button.svelte';
  import Field from '#lib/ui/Field.svelte';
  import Icon from '#lib/ui/Icon.svelte';
  import SmartRunnerSearch from './SmartRunnerSearch.svelte';
  import SmartClubSearch from './SmartClubSearch.svelte';

  interface Props {
    open: boolean;
    competitionId: string;
    classes: ClassDTO[];
    onClose: () => void;
    onSaved: (created: CompetitorDTO) => void;
  }

  let { open, competitionId, classes, onClose, onSaved }: Props = $props();

  let searchValue = $state('');
  let name = $state('');
  let club = $state('');
  /** Federation club_id once the operator has picked a club from
   * SmartClubSearch (or one was filled from an Eventor name pick).
   * When non-null, SmartRunnerSearch narrows its FTS5 query to this
   * club so common names like "Per Karlsson" stop being drowned by
   * higher-ranked homonyms from other clubs. Cleared whenever the
   * operator types into the Klubb field or ticks Klubblös. */
  let selectedClubId = $state<number | null>(null);
  let klubblos = $state(false);
  let classId = $state('');
  let cardNumber = $state('');
  let hiredCard = $state(false);
  let contactPhone = $state('');
  let contactEmail = $state('');

  let eventorFillNote = $state(false);
  let saving = $state(false);
  let error: string | null = $state(null);

  // Re-seed when the sheet opens.
  $effect(() => {
    if (!open) return;
    searchValue = '';
    name = '';
    club = '';
    selectedClubId = null;
    klubblos = false;
    classId = '';
    cardNumber = '';
    hiredCard = false;
    contactPhone = '';
    contactEmail = '';
    eventorFillNote = false;
    error = null;
    saving = false;
  });

  function onSearchPick(s: EventorNameSuggestion): void {
    // Canonical "Family, Given" — matches the existing import + walk-up
    // path so identity comparisons stay stable across the codebase.
    name = `${s.family_name}, ${s.given_name}`;
    if (s.club_name) {
      club = s.club_name;
      klubblos = false;
      // s carries club_name but not club_id. Leave selectedClubId as-is —
      // if the operator picked a club before searching, the narrowing
      // stays; if not, the picked runner's club is shown but the search
      // remains unscoped (correct: we don't want to retroactively narrow
      // a search that already returned this row).
    }
    if (s.si_card !== null) cardNumber = String(s.si_card);
    searchValue = name;
    eventorFillNote = true;
  }

  function onSearchValue(v: string): void {
    // Mirror the search query into the Namn field while the operator is
    // still using the search box as the source of truth — i.e. they have
    // not picked a row (which would set name to canonical "Family, Given")
    // and have not typed into Namn manually. We compare to the PREVIOUS
    // searchValue (before this keystroke) so each successive character
    // continues to flow through. Once the operator touches Namn directly,
    // name diverges from prevSearch and the mirror stops.
    const prevSearch = searchValue;
    searchValue = v;
    if (name.trim() === '' || name === prevSearch) {
      name = v;
    }
  }

  function onClubPick(s: EventorClubSuggestion): void {
    club = s.name;
    selectedClubId = s.club_id;
    klubblos = false;
  }

  function onClubValue(v: string): void {
    club = v;
    // Typing into the Klubb field invalidates the picked club_id — the
    // operator may be editing toward a different club entirely. Without
    // this clear, a stale selectedClubId would keep narrowing the name
    // search to the previously-picked club.
    selectedClubId = null;
  }

  function onKlubblosChange(e: Event): void {
    klubblos = (e.currentTarget as HTMLInputElement).checked;
    if (klubblos) {
      club = '';
      selectedClubId = null;
    }
  }

  function validate(): string | null {
    if (name.trim().length < 2) return t('runners.addSheet.err.name');
    if (!classId) return t('runners.addSheet.err.classRequired');
    if (hiredCard && contactPhone.trim() === '' && contactEmail.trim() === '') {
      return t('runners.addSheet.err.hireContact');
    }
    return null;
  }

  async function onSave(): Promise<void> {
    error = null;
    const err = validate();
    if (err !== null) {
      error = err;
      return;
    }
    saving = true;
    try {
      const trimmedCard = cardNumber.trim();
      const card = trimmedCard.length === 0 ? null : Number(trimmedCard);
      if (card !== null && (!Number.isInteger(card) || card <= 0)) {
        error = t('walk.err.cardRequired');
        saving = false;
        return;
      }
      const created = await createCompetitor({
        competition_id: competitionId,
        name: name.trim(),
        club: klubblos || club.trim() === '' ? null : club.trim(),
        class_id: classId,
        card_number: card,
        consent: true,
        consent_status: 'explicit',
        hired_card: hiredCard,
        hired_contact: hiredCard
          ? {
              name: null,
              phone: contactPhone.trim() === '' ? null : contactPhone.trim(),
              email: contactEmail.trim() === '' ? null : contactEmail.trim(),
              note: null,
            }
          : null,
      });
      onSaved(created);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { error?: string } | undefined;
        if (body?.error === 'card_taken') {
          error = t('runners.addSheet.err.cardTaken', { card: cardNumber });
        } else {
          error = (e as Error).message ?? t('err.network');
        }
      } else if (e instanceof ApiError) {
        error = (e as Error).message ?? t('err.network');
      } else {
        error = t('err.network');
      }
    } finally {
      saving = false;
    }
  }

  function onCancel(): void {
    if (saving) return;
    onClose();
  }
</script>

<Modal {open} onClose={onCancel}>
  {#snippet head()}
    <h2 class="sheet-title">{t('runners.addSheet.title')}</h2>
    <button
      type="button"
      class="sheet-close"
      onclick={onCancel}
      aria-label={t('runners.importSheet.close')}
      disabled={saving}
    >
      <Icon name="x" size={18} />
    </button>
  {/snippet}

  {#snippet body()}
    <div class="sheet-body">
      <!-- Smart Eventor search — the top of the funnel. -->
      <section class="block">
        <Field label={t('runners.addSheet.searchLabel')} htmlFor="add-runner-search">
          <SmartRunnerSearch
            id="add-runner-search"
            value={searchValue}
            placeholder={t('runners.addSheet.searchPlaceholder')}
            clubId={selectedClubId}
            onValue={onSearchValue}
            onPick={onSearchPick}
          />
        </Field>
        <p class="hint">
          {selectedClubId !== null
            ? t('runners.addSheet.searchHintClubScoped', { club })
            : t('runners.addSheet.searchHint')}
        </p>
        {#if eventorFillNote}
          <p class="ok-note" role="status">{t('runners.addSheet.eventorFill')}</p>
        {/if}
      </section>

      <h3 class="block-heading">{t('runners.addSheet.manualHeading')}</h3>

      <section class="block">
        <Field label={t('runners.addSheet.nameLabel')} htmlFor="add-runner-name">
          <input
            id="add-runner-name"
            class="input"
            type="text"
            bind:value={name}
            placeholder={t('runners.addSheet.namePlaceholder')}
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
            data-testid="add-runner-name"
          />
        </Field>

        <Field label={t('runners.addSheet.clubLabel')} htmlFor="add-runner-club">
          <SmartClubSearch
            id="add-runner-club"
            value={club}
            placeholder={t('runners.addSheet.clubPlaceholder')}
            disabled={klubblos}
            onValue={onClubValue}
            onPick={onClubPick}
          />
        </Field>
        <label class="toggle">
          <input
            type="checkbox"
            checked={klubblos}
            onchange={onKlubblosChange}
            data-testid="add-runner-klubblos"
          />
          <span class="toggle-label">{t('runners.addSheet.klubbloesToggle')}</span>
          <span class="toggle-hint">{t('runners.addSheet.klubbloesHint')}</span>
        </label>

        <Field label={t('runners.addSheet.classLabel')} htmlFor="add-runner-class">
          <select
            id="add-runner-class"
            class="input"
            bind:value={classId}
            data-testid="add-runner-class"
          >
            <option value="" disabled>{t('runners.addSheet.classPlaceholder')}</option>
            {#each classes as klass (klass.id)}
              <option value={klass.id}>{klass.name}</option>
            {/each}
          </select>
        </Field>

        <Field label={t('runners.addSheet.cardLabel')} htmlFor="add-runner-card">
          <input
            id="add-runner-card"
            class="input mono"
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            bind:value={cardNumber}
            placeholder={t('runners.addSheet.cardPlaceholder')}
            autocomplete="off"
            data-testid="add-runner-card"
          />
        </Field>
        <label class="toggle">
          <input
            type="checkbox"
            bind:checked={hiredCard}
            data-testid="add-runner-hire"
          />
          <span class="toggle-label">{t('runners.addSheet.hireToggle')}</span>
          <span class="toggle-hint">{t('runners.addSheet.hireHint')}</span>
        </label>

        {#if hiredCard}
          <div class="hired-fields" data-testid="add-runner-hired-fields">
            <Field label={t('runners.addSheet.hirePhoneLabel')} htmlFor="add-runner-hc-phone">
              <input
                id="add-runner-hc-phone"
                class="input"
                type="tel"
                inputmode="tel"
                bind:value={contactPhone}
                placeholder={t('runners.addSheet.hirePhonePlaceholder')}
                autocomplete="tel"
                data-testid="add-runner-hc-phone"
              />
            </Field>
            <Field label={t('runners.addSheet.hireEmailLabel')} htmlFor="add-runner-hc-email">
              <input
                id="add-runner-hc-email"
                class="input"
                type="email"
                inputmode="email"
                bind:value={contactEmail}
                placeholder={t('runners.addSheet.hireEmailPlaceholder')}
                autocomplete="email"
                data-testid="add-runner-hc-email"
              />
            </Field>
            <p class="hint">{t('runners.addSheet.hireContactHint')}</p>
          </div>
        {/if}
      </section>

      {#if error}
        <p class="err" role="alert" data-testid="add-runner-error">{error}</p>
      {/if}
    </div>
  {/snippet}

  {#snippet foot()}
    <Button variant="ghost" onclick={onCancel} disabled={saving}>
      {t('runners.addSheet.cancel')}
    </Button>
    <Button
      variant="primary"
      onclick={onSave}
      disabled={saving}
      data-testid="add-runner-save"
    >
      {saving ? t('runners.addSheet.saving') : t('runners.addSheet.save')}
    </Button>
  {/snippet}
</Modal>

<style>
  /* The Modal primitive already renders <header class="modal-head">
     with padding + border-bottom. We render the title and close button
     directly into the head snippet — no inner wrapper, no second
     underline. flex:1 on the title pushes the close button to the right
     since .modal-head is `display: flex; gap: ...`. */
  .sheet-title {
    flex: 1;
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }
  .sheet-close {
    background: transparent;
    border: 0;
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    cursor: pointer;
    color: var(--fg-muted);
  }
  .sheet-close:hover:not(:disabled) {
    background: var(--bg-sunken);
    color: var(--fg);
  }
  /* Modal's .modal-body owns padding + overflow:auto. The inner sheet-body
     is just a flex-column-gap container so the sections stack nicely; do
     NOT set max-height/overflow here or the modal-body and sheet-body
     each scroll independently → double scrollbar. */
  .sheet-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }
  .block-heading {
    margin: 4px 0 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .input {
    height: var(--hit);
    min-height: var(--hit);
    padding: 0 var(--space-sm);
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    font-size: var(--fs-body);
    width: 100%;
    color: var(--fg);
  }
  .input:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
    border-color: var(--accent);
  }
  .mono {
    font-family: var(--font-mono);
    font-feature-settings:
      'tnum' 1,
      'zero' 1;
  }
  .toggle {
    display: grid;
    grid-template-columns: 22px 1fr;
    grid-template-rows: auto auto;
    column-gap: 8px;
    align-items: start;
    cursor: pointer;
    padding: 4px 0;
  }
  .toggle input {
    grid-row: 1 / span 2;
    grid-column: 1;
    width: 18px;
    height: 18px;
    margin-top: 2px;
  }
  .toggle-label {
    grid-column: 2;
    grid-row: 1;
    font-weight: 500;
  }
  .toggle-hint {
    grid-column: 2;
    grid-row: 2;
    font-size: 12px;
    color: var(--fg-muted);
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--fg-muted);
  }
  .hired-fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: var(--space-sm);
    background: var(--bg-sunken);
    border-radius: var(--radius);
  }
  .ok-note {
    margin: 0;
    padding: 8px 12px;
    background: var(--ok-soft, rgba(16, 122, 87, 0.12));
    border: 1px solid var(--ok, #107a57);
    color: var(--ok, #107a57);
    border-radius: var(--radius);
    font-size: 13px;
  }
  .err {
    margin: 0;
    padding: 8px 12px;
    background: rgba(190, 47, 47, 0.08);
    border: 1px solid var(--dnf);
    color: var(--dnf);
    border-radius: var(--radius);
    font-size: 13px;
  }
</style>
