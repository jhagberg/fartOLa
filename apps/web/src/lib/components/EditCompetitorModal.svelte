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
  import Modal from '#lib/ui/Modal.svelte';
  import { t } from '#lib/i18n/index.ts';
  import {
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
  }

  let { open, competitor, competitionId, classes, onClose, onSaved }: Props = $props();

  let name = $state('');
  let club = $state('');
  let classId = $state('');
  let cardNumber = $state('');
  let saving = $state(false);
  let error: string | null = $state(null);
  let confirmingWithdraw = $state(false);
  let withdrawing = $state(false);

  // Re-seed the form whenever the parent passes a different competitor
  // (or the modal toggles open). Track `competitor?.id` so the effect
  // doesn't fire on unrelated field mutations.
  $effect(() => {
    if (!open) return;
    void competitor?.id;
    name = competitor?.name ?? '';
    club = competitor?.club ?? '';
    classId = competitor?.class_id ?? '';
    cardNumber = competitor?.card_number == null ? '' : String(competitor.card_number);
    error = null;
    confirmingWithdraw = false;
  });

  function close(): void {
    if (saving) return;
    onClose();
  }

  async function save(): Promise<void> {
    if (!competitor || saving) return;
    error = null;
    const patch: CompetitorProfilePatch = {};
    const trimmedName = name.trim();
    const trimmedClub = club.trim();
    if (trimmedName !== competitor.name) {
      if (trimmedName.length < 2) {
        error = t('err.required');
        return;
      }
      patch.name = trimmedName;
    }
    if (trimmedClub !== (competitor.club ?? '')) {
      patch.club = trimmedClub.length === 0 ? null : trimmedClub;
    }
    if (classId !== competitor.class_id) {
      patch.class_id = classId;
    }
    const parsedCard = cardNumber.trim().length === 0 ? null : Number(cardNumber.trim());
    if (parsedCard !== null && (!Number.isInteger(parsedCard) || parsedCard <= 0)) {
      error = t('err.required');
      return;
    }
    if (parsedCard !== competitor.card_number) {
      patch.card_number = parsedCard;
    }
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
      const msg = (e as Error).message ?? '';
      if (msg.includes('card_already_bound'))
        error = t('walk.err.cardTaken', { card: parsedCard ?? '' });
      else if (msg.includes('class_not_in_competition')) error = t('err.required');
      else error = t('err.network');
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
      // refetch on onSaved keeps it in sync.
      onSaved(competitor);
      onClose();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      withdrawing = false;
      confirmingWithdraw = false;
    }
  }
</script>

<Modal {open} onClose={close}>
  {#snippet head()}
    <h2>{t('ro.editTitle')}</h2>
  {/snippet}
  {#snippet body()}
    <form class="edit-form" onsubmit={(e) => { e.preventDefault(); void save(); }}>
      <label class="field">
        <span>{t('walk.name')}</span>
        <input
          type="text"
          bind:value={name}
          data-testid="edit-name"
          autocomplete="off"
          minlength="2"
          maxlength="200"
        />
      </label>
      <label class="field">
        <span>{t('walk.club')}</span>
        <input
          type="text"
          bind:value={club}
          data-testid="edit-club"
          autocomplete="off"
          maxlength="120"
        />
      </label>
      <label class="field">
        <span>{t('walk.class')}</span>
        <select bind:value={classId} data-testid="edit-class">
          {#each classes as cls (cls.id)}
            <option value={cls.id}>{cls.name}</option>
          {/each}
        </select>
      </label>
      <label class="field">
        <span>{t('walk.card')}</span>
        <input
          type="text"
          inputmode="numeric"
          bind:value={cardNumber}
          data-testid="edit-card"
          autocomplete="off"
          pattern="[0-9]*"
        />
      </label>
      {#if error}
        <p class="err" data-testid="edit-error">{error}</p>
      {/if}
      <hr class="divider" />
      <div class="danger-zone">
        {#if !confirmingWithdraw}
          <button
            type="button"
            class="btn danger-ghost"
            data-testid="edit-withdraw-btn"
            onclick={() => (confirmingWithdraw = true)}
            disabled={saving || withdrawing}
          >
            {t('edit.withdraw.cta')}
          </button>
          <p class="danger-hint">{t('edit.withdraw.hint')}</p>
        {:else}
          <p class="danger-confirm">{t('edit.withdraw.confirmBody')}</p>
          <div class="danger-actions">
            <button
              type="button"
              class="btn ghost"
              onclick={() => (confirmingWithdraw = false)}
              disabled={withdrawing}
              data-testid="edit-withdraw-cancel"
            >
              {t('walk.cancel')}
            </button>
            <button
              type="button"
              class="btn danger"
              onclick={() => void withdraw()}
              disabled={withdrawing}
              data-testid="edit-withdraw-confirm"
            >
              {withdrawing ? t('edit.withdraw.busy') : t('edit.withdraw.confirm')}
            </button>
          </div>
        {/if}
      </div>
    </form>
  {/snippet}
  {#snippet foot()}
    <button type="button" class="btn ghost" onclick={close} disabled={saving || withdrawing}>
      {t('walk.cancel')}
    </button>
    <button
      type="button"
      class="btn primary"
      data-testid="edit-save-btn"
      disabled={saving || withdrawing}
      onclick={() => void save()}
    >
      {saving ? t('ro.editSaving') : t('ro.editSave')}
    </button>
  {/snippet}
</Modal>

<style>
  .edit-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .field span {
    font-size: var(--fs-caption);
    color: var(--fg-muted);
  }
  .field input,
  .field select {
    min-height: var(--hit);
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    font: inherit;
  }
  .err {
    color: var(--dnf);
    font-size: var(--fs-caption);
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
    font-size: var(--fs-caption);
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
  .btn.danger-ghost {
    background: transparent;
    border: 1px solid var(--dnf);
    color: var(--dnf);
  }
  .btn.danger-ghost:hover:not(:disabled) {
    background: oklch(0.95 0.02 25);
  }
  .btn.danger {
    background: var(--dnf);
    border: 1px solid var(--dnf);
    color: #fff;
  }
  .btn.danger:hover:not(:disabled) {
    filter: brightness(0.92);
  }
</style>
