<!--
  Authored for fartola. Not ported from upstream.

  First step for an unknown card (todo 2026-10-08-unknown-card-entered-
  runner): "Är det någon som är anmäld?". An entered runner who runs with a
  new card reads out as unknown; picking the runner here gives the entry the
  new card instead of creating a second competitor.

   - Suggestions: entered runners who have not read out and whose class
     course fits the card's punches, closest start time first (the edge
     ranks them: GET /api/competitions/:id/cards/:card/entries).
   - Search the same list by name or club.
   - Pick → show before (ADR-0016 rule 1): "Byt bricka för <namn>:
     <gammalt> → <nytt>", with the Hyrbricka box as at direct entry.
     Confirm → card_bound; the parent shows what was done, with undo.
   - Not entered → onNotEntered, the direct-entry form as before. With no
     unread entries at all (a club training) the step skips itself.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { formatClockTime } from '@fartola/shared-types';
  import {
    ApiError,
    getEnteredRunners,
    replaceCard,
    type CardRebind,
    type EnteredRunner,
  } from '#lib/api/client.ts';
  import { t } from '#lib/i18n/index.ts';
  import Button from '#lib/ui/Button.svelte';
  import Field from '#lib/ui/Field.svelte';
  import Input from '#lib/ui/Input.svelte';

  interface Props {
    competitionId: string;
    cardNumber: number;
    onRebound: (r: CardRebind) => void;
    onNotEntered: () => void;
    onCancel: () => void;
  }

  let { competitionId, cardNumber, onRebound, onNotEntered, onCancel }: Props = $props();

  const MAX_SUGGESTIONS = 5;
  const MAX_RESULTS = 8;

  let runners = $state<EnteredRunner[] | null>(null);
  let clockOffsetMin = $state<number | null>(null);
  let query = $state('');
  let selected = $state<EnteredRunner | null>(null);
  let hiredCard = $state(false);
  let contactPhone = $state('');
  let contactEmail = $state('');
  let saving = $state(false);
  let error = $state<string | null>(null);

  onMount(() => {
    getEnteredRunners(competitionId, cardNumber)
      .then((r) => {
        if (r.runners.length === 0) {
          onNotEntered();
          return;
        }
        clockOffsetMin = r.clock_offset_min;
        runners = r.runners;
      })
      // Soft fail: direct entry still works without the list.
      .catch(() => onNotEntered());
  });

  const suggestions = $derived(
    (runners ?? []).filter((r) => r.suggested).slice(0, MAX_SUGGESTIONS)
  );
  const results = $derived.by(() => {
    const q = query.trim().toLocaleLowerCase('sv');
    if (q.length < 2) return [];
    return (runners ?? [])
      .filter(
        (r) =>
          r.name.toLocaleLowerCase('sv').includes(q) ||
          (r.club ?? '').toLocaleLowerCase('sv').includes(q)
      )
      .slice(0, MAX_RESULTS);
  });

  function detail(r: EnteredRunner): string {
    const parts = [r.class_name];
    if (r.club) parts.push(r.club);
    if (r.start_time_ms !== null && clockOffsetMin !== null) {
      parts.push(t('walk.entered.start', { time: formatClockTime(r.start_time_ms, clockOffsetMin) }));
    }
    return parts.join(' · ');
  }

  function fit(r: EnteredRunner): string | null {
    if (r.missing === null) return null;
    if (r.missing === 0) return t('walk.entered.courseOk');
    return r.missing === 1
      ? t('walk.entered.missingOne')
      : t('walk.entered.missingMany', { n: r.missing });
  }

  function pick(r: EnteredRunner): void {
    selected = r;
    error = null;
  }

  async function confirm(): Promise<void> {
    if (selected === null) return;
    error = null;
    if (hiredCard && contactPhone.trim() === '' && contactEmail.trim() === '') {
      error = t('walk.err.hyrbrickaContact');
      return;
    }
    saving = true;
    try {
      const done = await replaceCard({
        competition_id: competitionId,
        competitor_id: selected.competitor_id,
        card_number: cardNumber,
        hired_card: hiredCard,
        hired_contact: hiredCard
          ? {
              name: selected.name,
              phone: contactPhone.trim() === '' ? null : contactPhone.trim(),
              email: contactEmail.trim() === '' ? null : contactEmail.trim(),
              note: null,
            }
          : null,
      });
      onRebound(done);
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { error?: string } | undefined) : undefined;
      error =
        body?.error === 'card_taken'
          ? t('walk.err.cardTaken', { card: String(cardNumber) })
          : body?.error === 'hyrbricka_contact_required'
            ? t('walk.err.hyrbrickaContact')
            : t('err.network');
    } finally {
      saving = false;
    }
  }
</script>

{#snippet runnerButton(r: EnteredRunner, testid: string)}
  <li>
    <button type="button" class="runner" data-testid={testid} onclick={() => pick(r)}>
      <span class="runner-name">{r.name}</span>
      <span class="runner-detail">{detail(r)}</span>
      {#if fit(r)}
        <span class="runner-fit">{fit(r)}</span>
      {/if}
    </button>
  </li>
{/snippet}

<div class="body" data-testid="entered-step">
  {#if runners === null}
    <p class="muted" role="status">{t('walk.entered.loading')}</p>
  {:else if selected === null}
    <p class="lead">{t('walk.entered.desc', { card: String(cardNumber) })}</p>

    {#if suggestions.length > 0}
      <section aria-labelledby="entered-suggestions-title">
        <h3 id="entered-suggestions-title" class="sub">{t('walk.entered.suggestions')}</h3>
        <ul class="list">
          {#each suggestions as r (r.competitor_id)}
            {@render runnerButton(r, 'entered-suggestion')}
          {/each}
        </ul>
      </section>
    {/if}

    <Field label={t('walk.entered.search')} htmlFor="entered-search">
      <Input
        id="entered-search"
        data-testid="entered-search"
        type="search"
        autocomplete="off"
        placeholder={t('walk.entered.search.ph')}
        bind:value={query}
      />
    </Field>
    {#if query.trim().length >= 2}
      {#if results.length > 0}
        <ul class="list" aria-label={t('walk.entered.search')}>
          {#each results as r (r.competitor_id)}
            {@render runnerButton(r, 'entered-result')}
          {/each}
        </ul>
      {:else}
        <p class="muted" data-testid="entered-no-match">{t('walk.entered.noMatch')}</p>
      {/if}
    {/if}

    <footer class="foot">
      <Button variant="ghost" type="button" onclick={onCancel} data-testid="walkup-cancel">
        {t('walk.cancel')}
      </Button>
      <Button variant="secondary" type="button" onclick={onNotEntered} data-testid="walkup-not-entered">
        {t('walk.entered.notEntered')}
      </Button>
    </footer>
  {:else}
    <div class="confirm" data-testid="entered-confirm">
      <p class="confirm-title">
        {t('walk.entered.confirm', {
          name: selected.name,
          old: selected.card_number === null ? t('walk.entered.noCard') : String(selected.card_number),
          new: String(cardNumber),
        })}
      </p>
      <p class="muted">{t('walk.entered.confirm.desc', { name: selected.name })}</p>
    </div>

    <label class="check-row">
      <input type="checkbox" data-testid="entered-hired" bind:checked={hiredCard} />
      <span>{t('walk.hyrbricka')}</span>
    </label>
    {#if hiredCard}
      <div class="hired-fields">
        <Field label={t('walk.hyrbricka.phone')} htmlFor="entered-hc-phone">
          <Input id="entered-hc-phone" data-testid="entered-hc-phone" type="tel" bind:value={contactPhone} />
        </Field>
        <Field label={t('walk.hyrbricka.email')} htmlFor="entered-hc-email">
          <Input id="entered-hc-email" type="email" bind:value={contactEmail} />
        </Field>
      </div>
    {/if}

    {#if error}
      <p class="err" role="alert" data-testid="entered-error">{error}</p>
    {/if}

    <footer class="foot">
      <Button
        variant="ghost"
        type="button"
        onclick={() => (selected = null)}
        disabled={saving}
        data-testid="entered-back"
      >
        {t('walk.entered.back')}
      </Button>
      <Button
        variant="primary"
        type="button"
        onclick={() => void confirm()}
        disabled={saving}
        data-testid="entered-save"
      >
        {t('walk.entered.save')}
      </Button>
    </footer>
  {/if}
</div>

<style>
  .body {
    padding: 18px 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow: auto;
  }
  @media (max-width: 480px) {
    .body {
      padding: 14px 16px;
    }
  }
  .lead {
    margin: 0;
    font-size: var(--fs-body, 16px);
  }
  .muted {
    margin: 0;
    color: var(--fg-muted);
    font-size: 14px;
  }
  .sub {
    margin: 0 0 6px;
    font-size: 14px;
    font-weight: 600;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .runner {
    width: 100%;
    min-height: 44px;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2px 12px;
    align-items: center;
    text-align: left;
    padding: 8px 12px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }
  .runner:hover,
  .runner:focus-visible {
    border-color: var(--accent, var(--fg));
  }
  .runner-name {
    font-weight: 600;
  }
  .runner-detail {
    grid-column: 1;
    color: var(--fg-muted);
    font-size: 14px;
  }
  .runner-fit {
    grid-column: 2;
    grid-row: 1 / span 2;
    font-size: 14px;
    color: var(--fg);
  }
  .confirm {
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-sunken);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .confirm-title {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
  }
  .check-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    cursor: pointer;
  }
  .hired-fields {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .err {
    margin: 0;
    color: var(--dnf);
    font-size: 14px;
  }
  .foot {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding-top: 6px;
  }
</style>
