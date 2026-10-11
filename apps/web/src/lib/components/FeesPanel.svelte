<!--
  Authored for fartola. Not ported from upstream.

  Fees (SOFT TR 4.12.4, TR 4.12.6): the card rental fee and each class's
  fee, youth fee (open classes) and late / walk-up surcharge. fartOLa
  charges them only to runners it registers itself and to hired cards;
  pre-entries pay what Eventor decided. Each field saves on change (no
  unsaved edit mode, ADR-0016 rule 3) and says "Sparat" or the error at
  its row. Saves go one at a time per row (ui/saveQueue.ts): a row sends
  its last saved values plus the change, so a quick second edit is never
  lost. "Hämta från Eventor" copies the
  linked event's fees. The surcharge column shows SOFT's cap for the class.
  Logic lives in screens/fees.ts.
-->
<script lang="ts">
  import { t } from '#lib/i18n/index.ts';
  import { feesFromEventor, getFees, putFees, type FeesResponse } from '#lib/api/client.ts';
  import Button from '#lib/ui/Button.svelte';
  import LoadError from '#lib/ui/LoadError.svelte';
  import SavedNote from '#lib/ui/SavedNote.svelte';
  import { createSaveState } from '#lib/ui/saveState.svelte.ts';
  import { createSaveQueue, type SaveQueue } from '#lib/ui/saveQueue.ts';
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
    /** Fee saves in flight or waiting (bound by the parent, which must not
     * remount the panel under them). */
    pending?: number;
  }

  let { competitionId, eventorLinked, pending = $bindable(0) }: Props = $props();

  let data = $state<FeesResponse | null>(null);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let busy = $state(false);
  /** The reload after "Hämta från Eventor" failed: the rows on screen are
   * old, so editing stays off until a retry reads them. */
  let reloadFailed = $state(false);

  type Field = 'entry_fee' | 'youth_entry_fee' | 'late_fee_pct';
  type Fees = Pick<ClassFeeItem, Field>;
  /** The card fee's "row". */
  const CARD = '';

  /** One save at a time per row (class id, or CARD). */
  const queues = new Map<string, SaveQueue<Fees> | SaveQueue<{ card_fee: number | null }>>();
  let notes = $state.raw<Record<string, ReturnType<typeof createSaveState>>>({});
  /** A value that is not one, per `${row}:${field}`: nothing was sent. */
  let invalid = $state<Record<string, string>>({});
  /** Only a field's newest edit may put its saved value back. */
  const fieldGen: Record<string, number> = {};
  /** Per row, the fields whose save failed and were put back: the row
   * keeps the error until that field is edited again. */
  let failed = $state<Record<string, string[]>>({});

  function markFailed(row: string, field: string, on: boolean): void {
    const rest = (failed[row] ?? []).filter((f) => f !== field);
    failed = { ...failed, [row]: on ? [...rest, field] : rest };
  }

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

  function noteFor(row: string): ReturnType<typeof createSaveState> {
    let note = notes[row];
    if (note === undefined) {
      note = createSaveState();
      notes = { ...notes, [row]: note };
    }
    return note;
  }

  function setInvalid(row: string, field: string, message: string | null): void {
    const next = { ...invalid };
    if (message === null) delete next[`${row}:${field}`];
    else next[`${row}:${field}`] = message;
    invalid = next;
  }

  /** The row's error while any of its fields holds a value that is not one. */
  const invalidOf = (row: string): string | undefined =>
    Object.entries(invalid).find(([key]) => key.startsWith(`${row}:`))?.[1];

  /** Queue a change; the row's note says "Sparat" or the error. The shown
   * data follows the saved values; a failure also resets the field. */
  function save<T extends object>(
    row: string,
    queue: SaveQueue<T>,
    field: keyof T & string,
    fieldValue: T[keyof T & string],
    input: HTMLInputElement,
    show: (saved: T) => void
  ): void {
    setInvalid(row, field, null);
    markFailed(row, field, false);
    const gen = `${row}:${field}`;
    const mine = (fieldGen[gen] = (fieldGen[gen] ?? 0) + 1);
    pending++;
    void noteFor(row)
      .run(
        queue.save({ [field]: fieldValue } as Partial<T>).then(
          () => {
            if (mine === fieldGen[gen]) show(queue.saved);
          },
          (e: unknown) => {
            if (mine === fieldGen[gen]) {
              show(queue.saved);
              input.value = value(queue.saved[field] as number | null);
              markFailed(row, field, true);
            }
            throw e;
          }
        ),
        { error: t('fees.err.saveFailed') }
      )
      .finally(() => pending--);
  }

  function onCardFee(input: HTMLInputElement): void {
    if (data === null) return;
    const fee = parseWhole(input.value);
    if (fee === undefined) return setInvalid(CARD, 'card_fee', t('fees.err.kronor'));
    let queue = queues.get(CARD) as SaveQueue<{ card_fee: number | null }> | undefined;
    if (queue === undefined) {
      queue = createSaveQueue({ card_fee: data.card_fee }, (change) =>
        putFees(competitionId, change)
      );
      queues.set(CARD, queue);
    }
    save(CARD, queue, 'card_fee', fee, input, (saved) => {
      if (data !== null) data.card_fee = saved.card_fee;
    });
  }

  function onClassField(item: ClassFeeItem, field: Field, input: HTMLInputElement): void {
    const fee = parseWhole(input.value, field === 'late_fee_pct' ? 100 : undefined);
    const row = item.class_id;
    if (fee === undefined)
      return setInvalid(
        row,
        field,
        t(field === 'late_fee_pct' ? 'fees.err.percent' : 'fees.err.kronor')
      );
    let queue = queues.get(row) as SaveQueue<Fees> | undefined;
    if (queue === undefined) {
      const { entry_fee, youth_entry_fee, late_fee_pct } = item;
      // The row as last saved, plus the change (the card fee is not sent).
      queue = createSaveQueue<Fees>({ entry_fee, youth_entry_fee, late_fee_pct }, (change, saved) =>
        putFees(competitionId, { classes: [{ class_id: row, ...saved, ...change }] })
      );
      queues.set(row, queue);
    }
    save(row, queue, field, fee, input, (saved) => {
      const shown = data?.classes.find((c) => c.class_id === row);
      if (shown) shown[field] = saved[field];
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
    }
    await reload();
  }

  /** Stay disabled until the fees are read again: the next edit builds its
   * row on them, and an old row would save the old fees back. */
  async function reload(): Promise<void> {
    busy = true;
    reloadFailed = false;
    try {
      data = await getFees(competitionId);
    } catch (e) {
      console.error('fees reload failed:', e);
      reloadFailed = true;
      return;
    }
    queues.clear();
    failed = {};
    busy = false;
  }

  const value = (n: number | null) => (n === null ? '' : String(n));
</script>

{#snippet note(row: string, testid: string)}
  <span class="row-note" data-testid={testid}>
    <SavedNote
      state={invalidOf(row) || failed[row]?.length ? 'error' : (notes[row]?.state ?? 'idle')}
      error={invalidOf(row) ??
        (failed[row]?.length ? t('fees.err.saveFailed') : notes[row]?.error) ??
        ''}
    />
  </span>
{/snippet}

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
          onchange={(e) => onCardFee(e.currentTarget)}
          data-testid="fees-card-fee"
        />
      </label>
      {@render note(CARD, 'fees-card-fee-note')}
      {#if eventorLinked}
        <!-- Not over a fee save: the fetched fees would be overwritten. -->
        <Button
          variant="secondary"
          disabled={busy || pending > 0}
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
  {#if reloadFailed}
    <div class="reload" data-testid="fees-reload-error">
      <LoadError message={t('fees.err.reloadFailed')} onretry={() => void reload()} />
    </div>
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
                  onchange={(e) => onClassField(item, 'entry_fee', e.currentTarget)}
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
                    onchange={(e) => onClassField(item, 'youth_entry_fee', e.currentTarget)}
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
                    onchange={(e) => onClassField(item, 'late_fee_pct', e.currentTarget)}
                  />
                  <span class="muted" data-testid="fees-cap"
                    >{item.class_kind === null
                      ? t('fees.capNoKind')
                      : t('fees.cap', { pct: walkupCapPct(item.class_kind) })}</span
                  >
                  {@render note(item.class_id, 'fees-row-note')}
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
  .reload,
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
