<!--
  Authored for fartola. Not ported from upstream.

  EditCompetitorModal — operator-driven edits to an existing competitor
  row (name, club, class, card number). Composes on the shared Modal
  primitive so Esc-to-dismiss + scrim click-out both work, and the
  space-in-input bug from 126ac1e / f86a486 stays fixed.

  Backed by PATCH /api/competitors/:id/profile. Save → onSaved(updated)
  so the parent can refetch competitors and update its derived shapes.
  Errors surface inline; the modal stays open on 4xx.

  This is the operator's correction surface — distinct from:
  - The walk-up modal (creates new competitors).
  - The C-M4 consent toast (flips consent_status only).

  Not locked by any plan; landed this session (2026-05-15) to close a
  gap noticed during live training-event testing.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import Modal from '#lib/ui/Modal.svelte';
  import Button from '#lib/ui/Button.svelte';
  import Field from '#lib/ui/Field.svelte';
  import Icon from '#lib/ui/Icon.svelte';
  import Input from '#lib/ui/Input.svelte';
  import Select from '#lib/ui/Select.svelte';
  import CorrectionsPanel from '#lib/components/CorrectionsPanel.svelte';
  import EditRunnerRead from '#lib/components/EditRunnerRead.svelte';
  import { t } from '#lib/i18n/index.ts';
  import {
    ApiError,
    editCompetitorProfile,
    setManualStatus,
    type CompetitorProfilePatch,
  } from '#lib/api/client.ts';
  import type { CompetitorDTO, ClassDTO } from '@fartola/shared-types';

  interface Props {
    open: boolean;
    competitor: CompetitorDTO | null;
    competitionId: string;
    classes: ClassDTO[];
    onClose: () => void;
    onSaved: (updated: CompetitorDTO) => void;
    /** After Återbud; without it the parent gets onSaved, as before. */
    onWithdrawn?: (competitor: CompetitorDTO) => void;
  }

  let { open, competitor, competitionId, classes, onClose, onSaved, onWithdrawn }: Props = $props();

  type FieldName = 'name' | 'class' | 'card' | 'paid';

  let name = $state('');
  let club = $state('');
  let classId = $state('');
  let cardNumber = $state('');
  let paid = $state('');
  let saving = $state(false);
  /** One message per field, under the field; cleared when the field changes. */
  let fieldErrors: Partial<Record<FieldName, string>> = $state({});
  /** A failure that belongs to no field (the save itself). */
  let error: string | null = $state(null);
  let confirmingWithdraw = $state(false);
  let withdrawing = $state(false);
  /** Bumped when a correction changes the result: the read block fetches again. */
  let readVersion = $state(0);

  // Re-seed the form whenever the parent passes a different competitor
  // (or the modal toggles open). Track `competitor?.id` so the effect
  // doesn't fire on unrelated field mutations.
  const competitorId = $derived(competitor?.id);
  $effect(() => {
    if (!open) return;
    void competitorId;
    // Only the id (and open) re-seed: a card read on /readout hands in a
    // new competitor object, which must not wipe a half-typed edit.
    untrack(() => {
      name = competitor?.name ?? '';
      club = competitor?.club ?? '';
      classId = competitor?.class_id ?? '';
      cardNumber = competitor?.card_number == null ? '' : String(competitor.card_number);
      paid = String(competitor?.paid_amount ?? 0);
      fieldErrors = {};
      error = null;
      confirmingWithdraw = false;
    });
  });

  function clearError(field: FieldName): void {
    if (fieldErrors[field] === undefined) return;
    const { [field]: _gone, ...rest } = fieldErrors;
    fieldErrors = rest;
  }

  function close(): void {
    if (saving) return;
    onClose();
  }

  async function save(): Promise<void> {
    if (!competitor || saving) return;
    error = null;
    const errors: Partial<Record<FieldName, string>> = {};
    const patch: CompetitorProfilePatch = {};
    const trimmedName = name.trim();
    const trimmedClub = club.trim();
    // A stored short name (an import) must not block other edits: the
    // length is checked only when the name changes.
    if (trimmedName.length === 0 || (trimmedName !== competitor.name && trimmedName.length < 2))
      errors.name = t('edit.err.name');
    else if (trimmedName !== competitor.name) patch.name = trimmedName;
    if (trimmedClub !== (competitor.club ?? '')) {
      patch.club = trimmedClub.length === 0 ? null : trimmedClub;
    }
    if (!classId) errors.class = t('edit.err.class');
    else if (classId !== competitor.class_id) patch.class_id = classId;
    const parsedCard = cardNumber.trim().length === 0 ? null : Number(cardNumber.trim());
    if (parsedCard !== null && (!Number.isInteger(parsedCard) || parsedCard <= 0)) {
      errors.card = t('edit.err.card');
    } else if (parsedCard !== competitor.card_number) {
      patch.card_number = parsedCard;
    }
    const parsedPaid = paid.trim() === '' ? 0 : Number(paid.trim());
    if (!Number.isInteger(parsedPaid) || parsedPaid < 0) errors.paid = t('edit.err.paid');
    else if (parsedPaid !== (competitor.paid_amount ?? 0)) patch.paid_amount = parsedPaid;
    fieldErrors = errors;
    if (Object.keys(errors).length > 0) return;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    saving = true;
    try {
      const res = await editCompetitorProfile(competitor.id, patch);
      onSaved(res.competitor);
      onClose();
    } catch (e) {
      const code = e instanceof ApiError ? (e.body as { error?: string } | undefined)?.error : null;
      if (code === 'card_already_bound') {
        fieldErrors = { card: t('walk.err.cardTaken', { card: String(parsedCard ?? '') }) };
      } else if (code === 'class_not_in_competition') {
        fieldErrors = { class: t('edit.err.class') };
      } else {
        console.error('save failed:', e);
        error = e instanceof ApiError ? t('common.unknownError') : t('err.network');
      }
    } finally {
      saving = false;
    }
  }

  /** Withdraw the competitor from this competition. Sets manual_status=
   * CANCEL ("Återbud") via the existing manual-status route. Event-
   * sourced: we don't hard-delete the competitors row (the audit trail
   * needs it); CANCEL hides them from results sorts but keeps history.
   * Two-step confirm because the action is operator-visible (broadcasts
   * a manual_status_set envelope) and not free to reverse mid-race. */
  async function withdraw(): Promise<void> {
    if (!competitor || withdrawing) return;
    withdrawing = true;
    error = null;
    try {
      await setManualStatus(competitionId, competitor.id, 'CANCEL', 'Återbud');
      // Surface the change to the parent by re-emitting the same row;
      // the manual_status lives on the projection, not the competitors
      // table, so the row data itself is unchanged. The parent's
      // refetch keeps it in sync.
      (onWithdrawn ?? onSaved)(competitor);
      onClose();
    } catch (e) {
      console.error('withdraw failed:', e);
      error = e instanceof ApiError ? t('common.unknownError') : t('err.network');
    } finally {
      withdrawing = false;
      confirmingWithdraw = false;
    }
  }
</script>

<Modal {open} onClose={close}>
  {#snippet head()}
    <h2 class="sheet-title">{t('ro.editTitle')}</h2>
    <button
      type="button"
      class="sheet-close"
      onclick={close}
      aria-label={t('edit.close')}
      disabled={saving || withdrawing}
      data-testid="edit-close"
    >
      <Icon name="x" size={18} />
    </button>
  {/snippet}
  {#snippet body()}
    {#if competitor}
      <EditRunnerRead
        {competitionId}
        competitorId={competitor.id}
        classId={competitor.class_id}
        cardNumber={competitor.card_number}
        reloadKey={readVersion}
      />
    {/if}
    <form
      class="edit-form"
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field label={t('walk.name')} htmlFor="edit-name">
        <Input
          id="edit-name"
          type="text"
          bind:value={name}
          data-testid="edit-name"
          autocomplete="off"
          maxlength={200}
          oninput={() => clearError('name')}
          aria-invalid={fieldErrors.name ? 'true' : undefined}
          aria-describedby={fieldErrors.name ? 'edit-name-error' : undefined}
        />
        {#if fieldErrors.name}
          <p class="err" role="alert" id="edit-name-error" data-testid="edit-name-error">
            {fieldErrors.name}
          </p>
        {/if}
      </Field>
      <Field label={t('walk.club')} htmlFor="edit-club">
        <Input
          id="edit-club"
          type="text"
          bind:value={club}
          data-testid="edit-club"
          autocomplete="off"
          maxlength={120}
        />
      </Field>
      <Field label={t('walk.class')} htmlFor="edit-class">
        <Select
          id="edit-class"
          bind:value={classId}
          data-testid="edit-class"
          onchange={() => clearError('class')}
          aria-invalid={fieldErrors.class ? 'true' : undefined}
          aria-describedby={fieldErrors.class ? 'edit-class-error' : undefined}
        >
          {#if !classId}
            <option value="" disabled>{t('walk.classPlaceholder')}</option>
          {/if}
          {#each classes as cls (cls.id)}
            <option value={cls.id}>{cls.name}</option>
          {/each}
        </Select>
        {#if fieldErrors.class}
          <p class="err" role="alert" id="edit-class-error" data-testid="edit-class-error">
            {fieldErrors.class}
          </p>
        {/if}
      </Field>
      <Field label={t('walk.card')} htmlFor="edit-card">
        <Input
          id="edit-card"
          type="text"
          inputmode="numeric"
          bind:value={cardNumber}
          data-testid="edit-card"
          autocomplete="off"
          oninput={() => clearError('card')}
          aria-invalid={fieldErrors.card ? 'true' : undefined}
          aria-describedby={fieldErrors.card ? 'edit-card-error' : undefined}
        />
        {#if fieldErrors.card}
          <p class="err" role="alert" id="edit-card-error" data-testid="edit-card-error">
            {fieldErrors.card}
          </p>
        {/if}
      </Field>
      <Field label={t('edit.paid')} htmlFor="edit-paid">
        <Input
          id="edit-paid"
          type="text"
          inputmode="numeric"
          bind:value={paid}
          data-testid="edit-paid"
          autocomplete="off"
          oninput={() => clearError('paid')}
          aria-invalid={fieldErrors.paid ? 'true' : undefined}
          aria-describedby={fieldErrors.paid ? 'edit-paid-error' : undefined}
        />
        {#if fieldErrors.paid}
          <p class="err" role="alert" id="edit-paid-error" data-testid="edit-paid-error">
            {fieldErrors.paid}
          </p>
        {/if}
      </Field>
      {#if error}
        <p class="err" role="alert" data-testid="edit-error">{error}</p>
      {/if}
      <hr class="divider" />
      <div class="danger-zone">
        {#if !confirmingWithdraw}
          <Button
            variant="danger"
            data-testid="edit-withdraw-btn"
            onclick={() => (confirmingWithdraw = true)}
            disabled={saving || withdrawing}
          >
            {t('edit.withdraw.cta')}
          </Button>
          <p class="danger-hint">{t('edit.withdraw.hint')}</p>
        {:else}
          <p class="danger-confirm">{t('edit.withdraw.confirmBody')}</p>
          <div class="danger-actions">
            <Button
              variant="ghost"
              onclick={() => (confirmingWithdraw = false)}
              disabled={withdrawing}
              data-testid="edit-withdraw-cancel"
            >
              {t('walk.cancel')}
            </Button>
            <Button
              variant="danger"
              onclick={() => void withdraw()}
              disabled={withdrawing}
              data-testid="edit-withdraw-confirm"
            >
              {withdrawing ? t('edit.withdraw.busy') : t('edit.withdraw.confirm')}
            </Button>
          </div>
        {/if}
      </div>
    </form>
    {#if competitor}
      <hr class="divider" />
      <CorrectionsPanel
        {competitionId}
        competitorId={competitor.id}
        onChanged={() => readVersion++}
      />
    {/if}
  {/snippet}
  {#snippet foot()}
    <Button variant="ghost" onclick={close} disabled={saving || withdrawing}>
      {t('walk.cancel')}
    </Button>
    <Button
      variant="primary"
      data-testid="edit-save-btn"
      disabled={saving || withdrawing}
      onclick={() => void save()}
    >
      {saving ? t('ro.editSaving') : t('ro.editSave')}
    </Button>
  {/snippet}
</Modal>

<style>
  .sheet-title {
    flex: 1;
    margin: 0;
    font-size: var(--fs-body);
    font-weight: 600;
  }
  .sheet-close {
    background: transparent;
    border: 0;
    width: var(--hit);
    height: var(--hit);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius);
    cursor: pointer;
    color: var(--fg-muted);
  }
  .sheet-close:hover:not(:disabled) {
    background: var(--bg-sunken);
    color: var(--fg);
  }
  .edit-form {
    margin-top: var(--space-sm);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }
  .err {
    color: var(--dnf);
    font-size: var(--fs-label);
    margin: 0;
  }
  .divider {
    margin: var(--space-sm) 0 0;
    border: 0;
    border-top: 1px solid var(--border);
  }
  .danger-zone {
    display: flex;
    flex-direction: column;
    gap: var(--space-2xs);
    align-items: flex-start;
  }
  .danger-hint {
    margin: 0;
    color: var(--fg-muted);
    font-size: var(--fs-label);
  }
  .danger-confirm {
    margin: 0;
    color: var(--fg);
    font-size: var(--fs-label);
    font-weight: 500;
  }
  .danger-actions {
    display: flex;
    gap: var(--space-xs);
    width: 100%;
  }
</style>
