<!--
  Authored for fartola. Not ported from upstream.

  Class kind per class (SOFT TR 3.4.2): the proposed kind (Eventor's
  ClassTypeId, else the SOFT class name) and whether the operator has
  confirmed it. Choosing a kind or an age saves at once (no unsaved edit
  mode, ADR-0016 rule 3); "Bekräfta" confirms the proposal as it stands.
  Rules that refuse something (pursuit, seeding, vacant places) need a
  confirmed kind, so unconfirmed classes are counted and marked in text.
  With onlyClassId it shows one class (LottningView's confirm path).
  Logic lives in screens/class-kinds.ts.
-->
<script lang="ts">
  import type { ClassKind } from '@fartola/shared-types';
  import { t } from '#lib/i18n/index.ts';
  import { getClassKinds, putClassKinds, type ClassKindsResponse } from '#lib/api/client.ts';
  import Button from '#lib/ui/Button.svelte';
  import {
    CLASS_KINDS,
    confirmItem,
    isConfirmed,
    kindNeedsAge,
    kindStatus,
    kindsErrorKey,
    parseAge,
    proposed,
    type ClassKindItem,
  } from '#lib/screens/class-kinds.ts';

  interface Props {
    competitionId: string;
    /** Show only this class. */
    onlyClassId?: string | null;
    /** Text after the class name, per class id (e.g. "12 anm."). */
    details?: Record<string, string>;
    /** Called after a kind was saved. */
    onSaved?: () => void;
  }

  let { competitionId, onlyClassId = null, details = {}, onSaved }: Props = $props();

  let data = $state<ClassKindsResponse | null>(null);
  let loadError = $state<string | null>(null);
  /** The kind chosen in a row's select, until it is saved. */
  let chosen = $state<Record<string, ClassKind>>({});
  /** The age field's text per row, until it is saved. */
  let ageText = $state<Record<string, string>>({});
  let rowError = $state<Record<string, string>>({});
  let busy = $state(false);

  async function load(): Promise<void> {
    try {
      data = await getClassKinds(competitionId);
      loadError = null;
    } catch (e) {
      loadError = (e as Error).message;
    }
  }

  $effect(() => {
    void competitionId;
    void load();
  });

  const items = $derived(
    (data?.items ?? []).filter((i) => onlyClassId === null || i.class_id === onlyClassId)
  );
  const unconfirmed = $derived(items.filter((i) => !isConfirmed(i)).length);
  const confirmable = $derived(
    items.map(confirmItem).filter((i): i is NonNullable<typeof i> => i !== null)
  );

  const kindOf = (item: ClassKindItem): ClassKind | null =>
    chosen[item.class_id] ?? proposed(item).kind;
  const ageOf = (item: ClassKindItem): string =>
    ageText[item.class_id] ?? String(proposed(item).age ?? '');

  function setRowError(classId: string, message: string | null): void {
    const next = { ...rowError };
    if (message === null) delete next[classId];
    else next[classId] = message;
    rowError = next;
  }

  async function put(
    list: Array<{ class_id: string; class_kind: ClassKind; age_class: number | null }>
  ): Promise<void> {
    busy = true;
    try {
      await putClassKinds(competitionId, list);
      const done = new Set(list.map((i) => i.class_id));
      chosen = Object.fromEntries(Object.entries(chosen).filter(([id]) => !done.has(id)));
      ageText = Object.fromEntries(Object.entries(ageText).filter(([id]) => !done.has(id)));
      for (const id of done) setRowError(id, null);
      await load();
      onSaved?.();
    } catch (e) {
      const { key, classId } = kindsErrorKey(e);
      setRowError(classId ?? list[0]!.class_id, t(key));
    } finally {
      busy = false;
    }
  }

  /** Save one row as it now stands (select + age). */
  async function saveRow(item: ClassKindItem): Promise<void> {
    const kind = kindOf(item);
    if (kind === null) return;
    const age = parseAge(ageOf(item));
    if (kindNeedsAge(kind)) {
      if (age === undefined) return setRowError(item.class_id, t('classKinds.err.ageInvalid'));
      if (age === null) return setRowError(item.class_id, t('classKinds.err.ageRequired'));
    }
    await put([
      { class_id: item.class_id, class_kind: kind, age_class: kindNeedsAge(kind) ? age! : null },
    ]);
  }

  function onKindChange(item: ClassKindItem, value: string): void {
    chosen = { ...chosen, [item.class_id]: value as ClassKind };
    void saveRow(item);
  }

  function onAgeChange(item: ClassKindItem, value: string): void {
    ageText = { ...ageText, [item.class_id]: value };
    void saveRow(item);
  }
</script>

<div class="kinds" data-testid="class-kinds">
  {#if loadError}
    <p class="err" role="alert">{t('classKinds.err.loadFailed', { error: loadError })}</p>
  {:else if data !== null}
    {#if onlyClassId === null}
      <div class="summary" aria-live="polite">
        {#if unconfirmed > 0}
          <p data-testid="class-kinds-unconfirmed">
            <strong>{t('classKinds.unconfirmed', { count: unconfirmed })}</strong>
            {t('classKinds.whyConfirm')}
          </p>
          {#if confirmable.length > 0}
            <Button
              variant="primary"
              disabled={busy}
              onclick={() => void put(confirmable)}
              data-testid="class-kinds-confirm-all"
            >
              {t('classKinds.confirmAll', { count: confirmable.length })}
            </Button>
          {/if}
        {:else if items.length > 0}
          <p data-testid="class-kinds-all-confirmed">{t('classKinds.allConfirmed')}</p>
        {/if}
        {#if data.eventor === 'no_key' || data.eventor === 'failed'}
          <p class="muted">{t(`classKinds.eventor.${data.eventor}`)}</p>
        {/if}
      </div>
    {/if}

    {#if items.length > 0}
      <table class="kinds-table">
        <thead>
          <tr>
            <th scope="col">{t('common.class')}</th>
            <th scope="col">{t('classKinds.kind')}</th>
            <th scope="col">{t('classKinds.age')}</th>
            <th scope="col">{t('classKinds.status')}</th>
          </tr>
        </thead>
        <tbody>
          {#each items as item (item.class_id)}
            {@const kind = kindOf(item)}
            {@const status = kindStatus(item)}
            <tr data-testid="class-kind-row" data-class-id={item.class_id}>
              <th scope="row" class="name">
                {item.name}
                {#if details[item.class_id]}<span class="muted detail">{details[item.class_id]}</span>{/if}
              </th>
              <td>
                <select
                  class="ctl"
                  aria-label={t('classKinds.kindFor', { class: item.name })}
                  value={kind ?? ''}
                  disabled={busy}
                  onchange={(e) => onKindChange(item, e.currentTarget.value)}
                  data-testid="class-kind-select"
                >
                  {#if kind === null}
                    <option value="" disabled>{t('classKinds.choose')}</option>
                  {/if}
                  {#each CLASS_KINDS as k (k)}
                    <option value={k}>{t(`classKinds.kind.${k}`)}</option>
                  {/each}
                </select>
              </td>
              <td>
                {#if kind !== null && kindNeedsAge(kind)}
                  <input
                    class="ctl age"
                    type="text"
                    inputmode="numeric"
                    aria-label={t('classKinds.ageFor', { class: item.name })}
                    value={ageOf(item)}
                    disabled={busy}
                    onchange={(e) => onAgeChange(item, e.currentTarget.value)}
                    data-testid="class-kind-age"
                  />
                {/if}
              </td>
              <td>
                <div class="status-cell">
                  <span
                    class="status"
                    class:warn={!isConfirmed(item)}
                    data-testid="class-kind-status"
                    data-status={status}>{t(`classKinds.status.${status}`)}</span
                  >
                  {#if confirmItem(item) !== null && chosen[item.class_id] === undefined}
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onclick={() => void put([confirmItem(item)!])}
                      data-testid="class-kind-confirm"
                    >
                      {t('classKinds.confirm')}
                    </Button>
                  {/if}
                </div>
                {#if rowError[item.class_id]}
                  <p class="err" role="alert" data-testid="class-kind-error">
                    {rowError[item.class_id]}
                  </p>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}
</div>

<style>
  .kinds {
    display: grid;
    gap: var(--space-sm);
  }
  .summary {
    display: grid;
    gap: var(--space-xs);
    justify-items: start;
    padding: var(--space-sm) var(--space-md) 0;
  }
  .summary p {
    margin: 0;
    font-size: var(--fs-body);
  }
  .muted {
    color: var(--fg-muted);
  }
  .err {
    margin: 4px 0 0;
    color: var(--dnf);
    font-size: var(--fs-body);
  }
  .kinds-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-body);
  }
  .kinds-table th,
  .kinds-table td {
    padding: 6px var(--space-md);
    text-align: left;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  .kinds-table thead th {
    font-size: var(--fs-caption);
    font-weight: 600;
    color: var(--fg-muted);
  }
  .kinds-table tr:last-child th,
  .kinds-table tr:last-child td {
    border-bottom: none;
  }
  .name {
    font-weight: 500;
  }
  .detail {
    margin-left: var(--space-xs);
    font-weight: 400;
    font-size: var(--fs-caption);
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
  .age {
    width: 4.5rem;
  }
  .status-cell {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }
  .status.warn {
    font-weight: 600;
  }
</style>
