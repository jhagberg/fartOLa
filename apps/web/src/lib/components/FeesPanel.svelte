<!--
  Authored for fartola. Not ported from upstream.

  Fees (SOFT TR 4.12.4, TR 4.12.6): the card rental fee and each class's
  fee, youth fee (open classes) and late / walk-up surcharge. fartOLa
  charges them only to runners it registers itself and to hired cards;
  pre-entries pay what Eventor decided. Each field saves on change (no
  unsaved edit mode, ADR-0016 rule 3). "Hämta från Eventor" copies the
  linked event's fees. The surcharge column shows SOFT's cap for the class.
  Logic lives in screens/fees.ts.
-->
<script lang="ts">
  import { t } from '#lib/i18n/index.ts';
  import { feesFromEventor, getFees, putFees, type FeesResponse } from '#lib/api/client.ts';
  import Button from '#lib/ui/Button.svelte';
  import {
    eventorErrorKey,
    hasYouthFee,
    parseWhole,
    walkupCapPct,
    type ClassFeeItem,
  } from '#lib/screens/fees.ts';

  interface Props {
    competitionId: string;
    /** The competition is linked to an Eventor event. */
    eventorLinked: boolean;
  }

  let { competitionId, eventorLinked }: Props = $props();

  let data = $state<FeesResponse | null>(null);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let busy = $state(false);

  async function load(): Promise<void> {
    try {
      data = await getFees(competitionId);
    } catch (e) {
      error = t('fees.err.loadFailed', { error: (e as Error).message });
    }
  }

  $effect(() => {
    void competitionId;
    void load();
  });

  async function save(body: Parameters<typeof putFees>[1]): Promise<void> {
    busy = true;
    error = null;
    notice = null;
    try {
      await putFees(competitionId, body);
    } catch {
      error = t('fees.err.saveFailed');
    } finally {
      // Stay disabled until the reload lands: the next edit builds on it.
      await load();
      busy = false;
    }
  }

  function onCardFee(text: string): void {
    const fee = parseWhole(text);
    if (fee === undefined) {
      error = t('fees.err.kronor');
      return;
    }
    void save({ card_fee: fee, classes: [] });
  }

  type Field = 'entry_fee' | 'youth_entry_fee' | 'late_fee_pct';

  function onClassField(item: ClassFeeItem, field: Field, text: string): void {
    const value = parseWhole(text, field === 'late_fee_pct' ? 100 : undefined);
    if (value === undefined) {
      error = t(field === 'late_fee_pct' ? 'fees.err.percent' : 'fees.err.kronor');
      return;
    }
    const { class_id, entry_fee, youth_entry_fee, late_fee_pct } = item;
    void save({
      card_fee: data?.card_fee ?? null,
      classes: [{ class_id, entry_fee, youth_entry_fee, late_fee_pct, [field]: value }],
    });
  }

  async function fromEventor(): Promise<void> {
    busy = true;
    error = null;
    notice = null;
    try {
      const { updated } = await feesFromEventor(competitionId);
      notice = t('fees.eventor.done', { count: updated });
    } catch (e) {
      error = t(eventorErrorKey(e));
    } finally {
      await load();
      busy = false;
    }
  }

  const value = (n: number | null) => (n === null ? '' : String(n));
</script>

<div class="fees" data-testid="fees-panel">
  <p class="hint">{t('fees.hint')}</p>
  {#if data !== null}
    <div class="top">
      <label class="field">
        <span>{t('fees.cardFee')}</span>
        <input
          class="ctl num"
          type="text"
          inputmode="numeric"
          value={value(data.card_fee)}
          disabled={busy}
          onchange={(e) => onCardFee(e.currentTarget.value)}
          data-testid="fees-card-fee"
        />
      </label>
      {#if eventorLinked}
        <Button
          variant="secondary"
          disabled={busy}
          onclick={() => void fromEventor()}
          data-testid="fees-from-eventor"
        >
          {t('fees.eventor.fetch')}
        </Button>
      {/if}
    </div>
  {/if}
  {#if error}
    <p class="err" role="alert" data-testid="fees-error">{error}</p>
  {/if}
  {#if notice}
    <p aria-live="polite" data-testid="fees-notice">{notice}</p>
  {/if}

  {#if data !== null && data.classes.length > 0}
    <div class="table-wrap">
      <table class="fees-table">
        <thead>
          <tr>
            <th scope="col">{t('common.class')}</th>
            <th scope="col">{t('fees.entryFee')}</th>
            <th scope="col">{t('fees.youthFee')}</th>
            <th scope="col">{t('fees.latePct')}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.classes as item (item.class_id)}
            <tr data-testid="fees-row" data-class-id={item.class_id}>
              <th scope="row" class="name">{item.name}</th>
              <td data-label={t('fees.entryFee')}>
                <input
                  class="ctl num"
                  type="text"
                  inputmode="numeric"
                  aria-label={t('fees.entryFeeFor', { class: item.name })}
                  value={value(item.entry_fee)}
                  disabled={busy}
                  onchange={(e) => onClassField(item, 'entry_fee', e.currentTarget.value)}
                />
              </td>
              <td data-label={hasYouthFee(item.class_kind) ? t('fees.youthFee') : ''}>
                {#if hasYouthFee(item.class_kind)}
                  <input
                    class="ctl num"
                    type="text"
                    inputmode="numeric"
                    aria-label={t('fees.youthFeeFor', { class: item.name })}
                    value={value(item.youth_entry_fee)}
                    disabled={busy}
                    onchange={(e) => onClassField(item, 'youth_entry_fee', e.currentTarget.value)}
                  />
                {/if}
              </td>
              <td data-label={t('fees.latePct')}>
                <div class="pct">
                  <input
                    class="ctl num"
                    type="text"
                    inputmode="numeric"
                    aria-label={t('fees.latePctFor', { class: item.name })}
                    value={value(item.late_fee_pct)}
                    disabled={busy}
                    onchange={(e) => onClassField(item, 'late_fee_pct', e.currentTarget.value)}
                  />
                  <span class="muted" data-testid="fees-cap"
                    >{item.class_kind === null
                      ? t('fees.capNoKind')
                      : t('fees.cap', { pct: walkupCapPct(item.class_kind) })}</span
                  >
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .fees {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-sm);
    padding: var(--space-sm) 0;
  }
  .hint,
  .top,
  .fees > p {
    margin: 0;
    padding: 0 var(--space-md);
    font-size: var(--fs-body);
  }
  .hint,
  .muted {
    color: var(--fg-muted);
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--space-md);
  }
  .field {
    display: grid;
    gap: var(--space-xs);
    font-size: var(--fs-label);
  }
  .err {
    color: var(--dnf);
  }
  .table-wrap {
    overflow-x: auto;
  }
  .fees-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-body);
  }
  .fees-table th,
  .fees-table td {
    padding: 6px var(--space-md);
    text-align: left;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  .fees-table thead th {
    font-size: var(--fs-label);
    font-weight: 600;
    color: var(--fg-muted);
  }
  .fees-table tr:last-child th,
  .fees-table tr:last-child td {
    border-bottom: none;
  }
  .name {
    font-weight: 500;
  }
  .ctl {
    min-height: var(--hit);
    padding: 0 var(--space-sm);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
  }
  .num {
    width: 5rem;
  }
  .pct {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }
  /* Phone width: one block per class, each field with its own label. */
  @media (max-width: 600px) {
    .fees-table thead {
      display: none;
    }
    .fees-table tr {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs) var(--space-md);
      padding: var(--space-sm) var(--space-md);
      border-bottom: 1px solid var(--border);
    }
    .fees-table tr:last-child {
      border-bottom: none;
    }
    .fees-table th,
    .fees-table td {
      padding: 0;
      border-bottom: none;
    }
    .fees-table .name {
      flex-basis: 100%;
    }
    .fees-table td[data-label=''] {
      display: none;
    }
    .fees-table td::before {
      content: attr(data-label);
      display: block;
      font-size: var(--fs-label);
      color: var(--fg-muted);
    }
  }
</style>
