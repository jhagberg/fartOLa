<!--
  Authored for fartola. Not ported from upstream.

  LottningView — operator draw panel for start-time lottning (D-03/D-07).
  Provides class selector, draw mode picker (SOFT/Random/Simultaneous),
  first-start time, interval, vacant slots, and a Lotta button.
  After drawing, shows the sorted start list with assigned start times.
  Re-lotta asks for confirmation before clearing and redrawing.
  Per-runner inline start-time edit is via PATCH competitor start_time_ms.

  Locked by:
  - 02.1-05-PLAN.md task 1
  - 02.1-02-SUMMARY.md (backend route contract)
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n/index.ts';
  import {
    listClasses,
    postLottning,
    getLottning,
    patchClass,
    patchCompetitorStartTime,
    type LottningBody,
  } from '$lib/api/client.ts';
  import Field from '$lib/ui/Field.svelte';
  import Select from '$lib/ui/Select.svelte';
  import Input from '$lib/ui/Input.svelte';
  import Button from '$lib/ui/Button.svelte';
  import type { ClassDTO } from '@fartola/shared-types';

  interface Props {
    competitionId: string;
  }

  let { competitionId }: Props = $props();

  // --- state ----------------------------------------------------------------

  let classes: ClassDTO[] = $state([]);
  let selectedClassId: string = $state('');
  let drawMode: 'SOFT' | 'Random' | 'Simultaneous' = $state('SOFT');

  /** HH:MM string for the first-start time input. Converted to epoch ms
   * relative to midnight (today's date doesn't matter for the half-day
   * clock; the backend stores the epoch ms of first start). */
  let firstStartHHMM: string = $state('10:00');

  /** Start interval in seconds. Default 120 for sprints per D-07. */
  let intervalSec: number = $state(120);

  /** Number of vacant slots to insert. Default 0. */
  let vacantSlots: number = $state(0);

  /** Max time in seconds for the class (mm:ss input). Null = not set. */
  let maxTimeInput: string = $state('');

  let submitting = $state(false);
  let error: string | null = $state(null);

  /** Start list after a draw or on initial load. */
  let startList: Array<{ id: string; name: string; club: string | null; card_number: number | null; start_time_ms: number | null }> = $state([]);
  let startListLoaded = $state(false);

  /** Re-lotta confirmation dialog state. */
  let redrawConfirmOpen = $state(false);

  /** Per-runner inline edit state. Key = competitor id, value = HH:MM:SS string. */
  let editingStartTime: Record<string, string> = $state({});
  let savingStartTime: Record<string, boolean> = $state({});

  // --- lifecycle ------------------------------------------------------------

  onMount(() => {
    void loadClasses();
  });

  async function loadClasses(): Promise<void> {
    try {
      const res = await listClasses(competitionId);
      classes = res.classes;
      if (classes.length > 0 && !selectedClassId) {
        selectedClassId = classes[0]!.id;
        await loadStartList();
      }
    } catch {
      // Soft fail — operator sees empty class list
    }
  }

  async function loadStartList(): Promise<void> {
    if (!selectedClassId) return;
    try {
      const res = await getLottning(competitionId, selectedClassId);
      startList = res.start_list;
      startListLoaded = true;
    } catch {
      startList = [];
      startListLoaded = true;
    }
  }

  async function onClassChange(): Promise<void> {
    startListLoaded = false;
    startList = [];
    await loadStartList();
  }

  // --- helpers --------------------------------------------------------------

  /** Convert HH:MM to ms since midnight. Uses simple arithmetic — the
   * backend stores epoch ms, but for the half-day display the value
   * relative to midnight is what matters. We use today's UTC midnight
   * as the base anchor so the draw produces a consistent wall-clock time. */
  function hhmmToMs(hhmm: string): number {
    const [hh, mm] = hhmm.split(':').map(Number);
    return ((hh ?? 0) * 3600 + (mm ?? 0) * 60) * 1000;
  }

  /** Format epoch ms as HH:MM:SS (local clock). */
  function msToHHMMSS(ms: number | null): string {
    if (ms === null) return '—';
    const totalSec = Math.floor((ms % 86_400_000) / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  /** Parse mm:ss maxTime input to seconds. Returns null on empty/invalid. */
  function parseMaxTime(raw: string): number | null {
    if (!raw.trim()) return null;
    const parts = raw.trim().split(':');
    if (parts.length === 2) {
      const mm = Number(parts[0]);
      const ss = Number(parts[1]);
      if (!isNaN(mm) && !isNaN(ss)) return mm * 60 + ss;
    }
    const n = Number(raw);
    if (!isNaN(n) && n > 0) return n;
    return null;
  }

  // --- draw -----------------------------------------------------------------

  async function submitDraw(): Promise<void> {
    if (!selectedClassId) return;
    if (startList.length > 0 && !redrawConfirmOpen) {
      // Existing start list — ask for confirmation
      redrawConfirmOpen = true;
      return;
    }
    redrawConfirmOpen = false;
    submitting = true;
    error = null;
    try {
      const body: LottningBody = {
        mode: drawMode,
        firstStartMs: hhmmToMs(firstStartHHMM),
        intervalSec,
        ...(vacantSlots > 0 ? { vacantSlots } : {}),
      };
      await postLottning(competitionId, selectedClassId, body);
      await loadStartList();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      submitting = false;
    }
  }

  async function saveMaxTime(): Promise<void> {
    if (!selectedClassId) return;
    const sec = parseMaxTime(maxTimeInput);
    try {
      await patchClass(competitionId, selectedClassId, { maxTimeSec: sec });
    } catch (e) {
      error = (e as Error).message;
    }
  }

  // --- per-runner start-time inline edit -----------------------------------

  function startEditTime(id: string, currentMs: number | null): void {
    editingStartTime = { ...editingStartTime, [id]: msToHHMMSS(currentMs) };
  }

  function cancelEditTime(id: string): void {
    const next = { ...editingStartTime };
    delete next[id];
    editingStartTime = next;
  }

  async function saveEditTime(id: string): Promise<void> {
    const raw = editingStartTime[id] ?? '';
    const parts = raw.split(':').map(Number);
    let newMs: number | null = null;
    if (parts.length >= 2) {
      const h = parts[0] ?? 0;
      const m = parts[1] ?? 0;
      const s = parts[2] ?? 0;
      newMs = (h * 3600 + m * 60 + s) * 1000;
    }
    if (newMs === null) { cancelEditTime(id); return; }
    savingStartTime = { ...savingStartTime, [id]: true };
    try {
      await patchCompetitorStartTime(competitionId, id, newMs!);
      // Refresh the start list
      await loadStartList();
      cancelEditTime(id);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      const next = { ...savingStartTime };
      delete next[id];
      savingStartTime = next;
    }
  }

  const selectedClassName = $derived(classes.find((c) => c.id === selectedClassId)?.name ?? '');
</script>

<div class="lottning" data-testid="lottning-view">
  <header class="lottning-head">
    <h1>{t('lottning.title')}</h1>
  </header>

  <div class="lottning-form">
    <!-- Class selector -->
    <Field label={t('common.class')} htmlFor="lottning-class">
      <Select
        id="lottning-class"
        bind:value={selectedClassId}
        onchange={onClassChange}
        data-testid="lottning-class-select"
      >
        {#each classes as klass (klass.id)}
          <option value={klass.id}>{klass.name}</option>
        {/each}
      </Select>
    </Field>

    <!-- Draw mode -->
    <Field label={t('lottning.mode')} htmlFor="lottning-mode">
      <Select id="lottning-mode" bind:value={drawMode} data-testid="lottning-mode-select">
        <option value="SOFT">{t('lottning.soft')}</option>
        <option value="Random">{t('lottning.random')}</option>
        <option value="Simultaneous">{t('lottning.simultaneous')}</option>
      </Select>
    </Field>

    <!-- First start time -->
    <Field label={t('lottning.firstStart')} htmlFor="lottning-first-start">
      <Input
        id="lottning-first-start"
        type="time"
        bind:value={firstStartHHMM}
        data-testid="lottning-first-start"
      />
    </Field>

    <!-- Interval (hidden for Simultaneous) -->
    {#if drawMode !== 'Simultaneous'}
      <Field label={t('lottning.interval')} htmlFor="lottning-interval">
        <Input
          id="lottning-interval"
          type="number"
          min="0"
          bind:value={intervalSec}
          data-testid="lottning-interval"
        />
      </Field>
    {/if}

    <!-- Vacant slots -->
    <Field label={t('lottning.vacants')} htmlFor="lottning-vacants">
      <Input
        id="lottning-vacants"
        type="number"
        min="0"
        bind:value={vacantSlots}
        data-testid="lottning-vacants"
      />
    </Field>

    <!-- Max time -->
    <Field label={t('lottning.maxTime')} htmlFor="lottning-max-time">
      <div class="max-time-row">
        <Input
          id="lottning-max-time"
          type="text"
          placeholder="60:00"
          bind:value={maxTimeInput}
          data-testid="lottning-max-time"
        />
        <Button variant="secondary" onclick={saveMaxTime} data-testid="lottning-max-time-save">
          {t('info.save')}
        </Button>
      </div>
    </Field>

    {#if error}
      <p class="err" role="alert">{error}</p>
    {/if}

    <!-- Draw button — label changes based on whether a start list exists -->
    <div class="draw-btn-row">
      <Button
        variant="primary"
        onclick={() => void submitDraw()}
        disabled={submitting || !selectedClassId}
        data-testid="lottning-draw-btn"
      >
        {submitting
          ? '…'
          : startList.length > 0
            ? t('lottning.redraw')
            : t('lottning.draw')}
      </Button>
    </div>

    <!-- Re-draw confirmation inline dialog (T-02.1-10 mitigation) -->
    {#if redrawConfirmOpen}
      <div class="redraw-confirm" role="alertdialog" aria-live="assertive" data-testid="lottning-redraw-confirm">
        <p>{t('lottning.redrawConfirm', { class: selectedClassName })}</p>
        <div class="redraw-actions">
          <Button variant="primary" onclick={() => void submitDraw()} disabled={submitting} data-testid="lottning-redraw-yes">
            {t('lottning.redraw')}
          </Button>
          <Button variant="secondary" onclick={() => (redrawConfirmOpen = false)} data-testid="lottning-redraw-cancel">
            {t('race.confirm.cancel')}
          </Button>
        </div>
      </div>
    {/if}
  </div>

  <!-- Start list result table -->
  {#if startListLoaded && startList.length > 0}
    <section class="start-list" data-testid="lottning-start-list">
      <h2 class="start-list-heading">
        {t('lottning.drawn', { count: startList.length })}
      </h2>
      <table class="start-table" data-testid="lottning-table">
        <thead>
          <tr>
            <th class="col-pos">#</th>
            <th class="col-name">{t('runners.addSheet.nameLabel')}</th>
            <th class="col-club">{t('runners.addSheet.clubLabel')}</th>
            <th class="col-start">{t('common.startTime')}</th>
            <th class="col-edit"></th>
          </tr>
        </thead>
        <tbody>
          {#each startList as runner, i (runner.id)}
            <tr data-testid="lottning-row">
              <td class="col-pos mono">{i + 1}</td>
              <td class="col-name">{runner.name}</td>
              <td class="col-club">{runner.club ?? '—'}</td>
              <td class="col-start mono">
                {#if editingStartTime[runner.id] !== undefined}
                  {@const editVal = editingStartTime[runner.id] ?? ''}
                  <input
                    type="text"
                    class="time-edit-input"
                    value={editVal}
                    oninput={(e) => { editingStartTime = { ...editingStartTime, [runner.id]: (e.currentTarget as HTMLInputElement).value }; }}
                    data-testid="lottning-edit-time-input"
                  />
                {:else}
                  {msToHHMMSS(runner.start_time_ms)}
                {/if}
              </td>
              <td class="col-edit">
                {#if editingStartTime[runner.id] !== undefined}
                  <div class="edit-actions">
                    <button
                      type="button"
                      class="edit-action-btn save"
                      onclick={() => void saveEditTime(runner.id)}
                      disabled={savingStartTime[runner.id]}
                      data-testid="lottning-save-time"
                    >{t('info.save')}</button>
                    <button
                      type="button"
                      class="edit-action-btn cancel"
                      onclick={() => cancelEditTime(runner.id)}
                      data-testid="lottning-cancel-time"
                    >{t('race.confirm.cancel')}</button>
                  </div>
                {:else}
                  <button
                    type="button"
                    class="edit-btn"
                    onclick={() => startEditTime(runner.id, runner.start_time_ms)}
                    data-testid="lottning-edit-time-btn"
                  >{t('runners.row.edit')}</button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {:else if startListLoaded && startList.length === 0}
    <p class="empty-hint" data-testid="lottning-empty">{t('lottning.draw')} → {t('lottning.drawn', { count: 0 })}</p>
  {/if}
</div>

<style>
  .lottning {
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
    padding: var(--space-lg);
    max-width: 600px;
  }
  .lottning-head h1 {
    margin: 0;
    font-size: var(--fs-heading);
    font-weight: 600;
  }
  .lottning-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-lg);
  }
  .max-time-row {
    display: flex;
    gap: var(--space-sm);
    align-items: stretch;
  }
  .max-time-row :global(.select),
  .max-time-row :global(input) {
    flex: 1;
  }
  .draw-btn-row {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--space-xs);
  }
  .err {
    margin: 0;
    color: var(--dnf);
    font-size: 13px;
  }
  .redraw-confirm {
    background: var(--bg-sunken);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    padding: var(--space-md);
    display: grid;
    gap: var(--space-sm);
  }
  .redraw-confirm p {
    margin: 0;
    font-size: var(--fs-body);
  }
  .redraw-actions {
    display: flex;
    gap: var(--space-sm);
  }
  .start-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }
  .start-list-heading {
    margin: 0;
    font-size: var(--fs-label);
    font-weight: 600;
    color: var(--fg-muted);
  }
  .start-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-body);
  }
  .start-table th,
  .start-table td {
    padding: 8px 10px;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  .start-table th {
    font-size: 12px;
    font-weight: 600;
    color: var(--fg-muted);
    background: var(--bg-elev);
  }
  .start-table tr:last-child td {
    border-bottom: none;
  }
  .start-table tr:hover td {
    background: var(--bg-sunken);
  }
  .col-pos {
    width: 3rem;
    text-align: center;
  }
  .col-name {
    min-width: 8rem;
  }
  .col-club {
    color: var(--fg-muted);
  }
  .col-start {
    white-space: nowrap;
  }
  .col-edit {
    width: 6rem;
    text-align: right;
  }
  .mono {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum' 1;
  }
  .edit-btn {
    background: none;
    border: none;
    color: var(--accent);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    padding: 0;
  }
  .time-edit-input {
    width: 8rem;
    font-family: var(--font-mono);
  }
  .edit-actions {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
  }
  .edit-action-btn {
    background: none;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    font: inherit;
    font-size: 12px;
    padding: 2px 8px;
    cursor: pointer;
    color: var(--fg);
  }
  .edit-action-btn.save {
    border-color: var(--accent);
    color: var(--accent);
  }
  .edit-action-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .empty-hint {
    margin: 0;
    color: var(--fg-muted);
    font-size: var(--fs-body);
  }
</style>
