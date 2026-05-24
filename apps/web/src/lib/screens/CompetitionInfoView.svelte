<!--
  Authored for fartola.

  CompetitionInfoView — single surface for inspecting and editing a
  competition's static config: name, date, receipt template, auto-print,
  classes (read-only count), and courses with their ordered control
  codes. Phase 2.1 (2026-05-18) addition closing the "no way to see
  imported courses / edit competition" gap surfaced during 4-klubbs
  dress rehearsal.

  Data sources:
   - GET /api/competitions/:id (competition + classes + courses with
     control codes)
   - GET /api/competitions/:id/competitors (count per class)
   - PATCH /api/competitions/:id (name / date / receipt_template /
     auto_print)

  No course/control mutation surface here — XML re-import via /import is
  the canonical path for that. We just *show* what's there.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n/index.ts';
  import {
    getCompetition,
    listCompetitors,
    patchCompetition,
  } from '$lib/api/client.ts';
  import { goto } from '$app/navigation';
  import type {
    CompetitionDTO,
    ClassDTO,
    CourseDTO,
    CompetitorDTO,
  } from '@fartola/shared-types';

  interface Props {
    competitionId: string;
  }

  let { competitionId }: Props = $props();

  let competition: CompetitionDTO | null = $state(null);
  let classes: ClassDTO[] = $state([]);
  let courses: CourseDTO[] = $state([]);
  let competitors: CompetitorDTO[] = $state([]);
  let loading = $state(true);
  let loadError: string | null = $state(null);

  // Edit form state — initialised once data loads. We keep a "dirty"
  // shadow so the Save button only enables when something actually
  // changed.
  let formName = $state('');
  let formDate = $state('');
  let formTemplate: CompetitionDTO['receipt_template'] = $state('classic');
  let formAutoPrint = $state(false);
  let formTimingFormat: 'seconds' | 'tenths' = $state('seconds');
  let saving = $state(false);
  let saveErr: string | null = $state(null);
  let savedToast: string | null = $state(null);
  let savedTimer: ReturnType<typeof setTimeout> | null = null;

  const dirty = $derived.by(() => {
    const c = competition;
    if (c === null) return false;
    return (
      formName.trim() !== c.name ||
      formDate !== c.date ||
      formTemplate !== c.receipt_template ||
      formAutoPrint !== c.auto_print ||
      formTimingFormat !== c.timing_format
    );
  });

  const competitorCountByClass = $derived.by(() => {
    const m = new Map<string, number>();
    for (const c of competitors) m.set(c.class_id, (m.get(c.class_id) ?? 0) + 1);
    return m;
  });

  const classById = $derived.by(() => {
    const m = new Map<string, ClassDTO>();
    for (const c of classes) m.set(c.id, c);
    return m;
  });

  const RECEIPT_OPTIONS: Array<CompetitionDTO['receipt_template']> = [
    'classic',
    'standing',
    'detailed',
    'top4',
    'minimal',
    'kids',
  ];

  onMount(() => {
    void loadAll();
  });

  async function loadAll(): Promise<void> {
    loading = true;
    loadError = null;
    try {
      const [detail, compsRes] = await Promise.all([
        getCompetition(competitionId) as Promise<{
          competition: CompetitionDTO;
          classes: ClassDTO[];
          courses: CourseDTO[];
        }>,
        listCompetitors(competitionId),
      ]);
      competition = detail.competition;
      classes = detail.classes;
      courses = detail.courses;
      competitors = compsRes.competitors;
      formName = detail.competition.name;
      formDate = detail.competition.date;
      formTemplate = detail.competition.receipt_template;
      formAutoPrint = detail.competition.auto_print;
      formTimingFormat = detail.competition.timing_format;
    } catch (e) {
      loadError = (e as Error).message ?? 'load failed';
    } finally {
      loading = false;
    }
  }

  async function saveEdits(): Promise<void> {
    if (!competition || saving || !dirty) return;
    saving = true;
    saveErr = null;
    try {
      const updated = await patchCompetition(competitionId, {
        name: formName.trim(),
        date: formDate,
        receipt_template: formTemplate,
        auto_print: formAutoPrint,
        timing_format: formTimingFormat,
      });
      competition = updated;
      flashSaved();
    } catch (e) {
      saveErr = (e as Error).message ?? 'save failed';
    } finally {
      saving = false;
    }
  }

  function flashSaved(): void {
    savedToast = t('info.savedToast');
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
      savedToast = null;
    }, 2200);
  }

  function goImport(): void {
    void goto(`/competition/${competitionId}/import`);
  }
</script>

<section class="info-view" data-testid="competition-info">
  {#if loading}
    <p class="muted">{t('info.loading')}</p>
  {:else if loadError}
    <p class="err" role="alert">{loadError}</p>
  {:else if competition !== null}
    <header class="info-head">
      <h1>{t('info.title')}</h1>
      <p class="hint">{t('info.hint')}</p>
    </header>

    <!-- Editable fields -->
    <section class="card">
      <header class="card-head">
        <h2>{t('info.fields.heading')}</h2>
      </header>
      <div class="card-body grid">
        <label class="field">
          <span>{t('info.fields.name')}</span>
          <input
            type="text"
            bind:value={formName}
            data-testid="info-name"
            maxlength="200"
          />
        </label>
        <label class="field">
          <span>{t('info.fields.date')}</span>
          <input
            type="date"
            bind:value={formDate}
            data-testid="info-date"
          />
        </label>
        <label class="field">
          <span>{t('info.fields.receipt')}</span>
          <select bind:value={formTemplate} data-testid="info-receipt">
            {#each RECEIPT_OPTIONS as opt (opt)}
              <option value={opt}>{t(`info.receipt.${opt}`)}</option>
            {/each}
          </select>
        </label>
        <label class="field check-row">
          <input
            type="checkbox"
            bind:checked={formAutoPrint}
            data-testid="info-auto-print"
          />
          <span>{t('info.fields.autoPrint')}</span>
        </label>
        <label class="field">
          <span>{t('settings.timing.label')}</span>
          <select bind:value={formTimingFormat} data-testid="info-timing-format">
            <option value="seconds">{t('settings.timing.seconds')}</option>
            <option value="tenths">{t('settings.timing.tenths')}</option>
          </select>
        </label>
      </div>
      <div class="card-foot">
        {#if saveErr}
          <p class="err" role="alert">{saveErr}</p>
        {/if}
        <button
          type="button"
          class="btn primary"
          onclick={() => void saveEdits()}
          disabled={!dirty || saving}
          data-testid="info-save"
        >
          {saving ? t('info.saving') : t('info.save')}
        </button>
      </div>
    </section>

    <!-- Classes -->
    <section class="card">
      <header class="card-head">
        <h2>{t('info.classes.heading')}</h2>
        <span class="badge mono">{classes.length}</span>
      </header>
      {#if classes.length === 0}
        <p class="empty">{t('info.classes.empty')}</p>
      {:else}
        <ul class="class-list" data-testid="info-class-list">
          {#each classes as cls (cls.id)}
            <li class="class-row">
              <span class="class-name">{cls.name}</span>
              {#if cls.short_name}<span class="muted mono">[{cls.short_name}]</span>{/if}
              <span class="class-count mono"
                >{competitorCountByClass.get(cls.id) ?? 0} {t('info.classes.competitorsShort')}</span
              >
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- Courses with ordered control codes -->
    <section class="card">
      <header class="card-head">
        <h2>{t('info.courses.heading')}</h2>
        <span class="badge mono">{courses.length}</span>
        <button
          type="button"
          class="btn ghost head-btn"
          onclick={goImport}
          data-testid="info-reimport"
        >
          {t('info.courses.reimport')}
        </button>
      </header>
      {#if courses.length === 0}
        <p class="empty">{t('info.courses.empty')}</p>
      {:else}
        <ul class="course-list" data-testid="info-course-list">
          {#each courses as crs (crs.id)}
            <li class="course-row">
              <div class="course-head">
                <span class="course-name">{crs.name}</span>
                {#if crs.class_id !== null && classById.get(crs.class_id)}
                  <span class="muted">→ {classById.get(crs.class_id)!.name}</span>
                {:else}
                  <span class="muted">{t('info.courses.unassigned')}</span>
                {/if}
                {#if crs.length_m !== null}
                  <span class="muted mono">{crs.length_m} m</span>
                {/if}
                {#if crs.climb_m !== null}
                  <span class="muted mono">+{crs.climb_m} m</span>
                {/if}
              </div>
              {#if crs.controls.length === 0}
                <p class="muted course-empty">{t('info.courses.noControls')}</p>
              {:else}
                <ol class="course-controls">
                  {#each crs.controls as ctrl (ctrl.order_idx)}
                    <li class="ctrl-chip mono">
                      <span class="ctrl-idx">{ctrl.order_idx + 1}</span>
                      <span class="ctrl-code">{ctrl.control_code}</span>
                    </li>
                  {/each}
                </ol>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  {#if savedToast}
    <div class="toast" role="status" data-testid="info-saved-toast">{savedToast}</div>
  {/if}
</section>

<style>
  .info-view {
    display: grid;
    gap: var(--space-lg);
    padding: var(--space-lg);
    max-width: 960px;
    margin: 0 auto;
    position: relative;
  }
  .info-head h1 {
    margin: 0;
    font-size: var(--fs-heading);
    font-weight: 600;
  }
  .info-head .hint {
    margin: 4px 0 0;
    color: var(--fg-muted);
    font-size: 13px;
  }
  .muted {
    color: var(--fg-muted);
  }
  .mono {
    font-family: var(--font-mono);
    font-feature-settings:
      'tnum' 1,
      'zero' 1;
  }
  .err {
    margin: 0;
    color: var(--dnf);
    font-size: 13px;
  }
  .card {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .card-head {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border);
  }
  .card-head h2 {
    margin: 0;
    font-size: var(--fs-label);
    font-weight: 600;
  }
  .badge {
    margin-left: var(--space-2xs);
    background: var(--bg);
    color: var(--fg-muted);
    border: 1px solid var(--border);
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 12px;
  }
  .head-btn {
    margin-left: auto;
    height: 32px;
    min-height: 32px;
    padding: 0 var(--space-sm);
    font-size: var(--fs-caption);
  }
  .card-body {
    padding: var(--space-md);
  }
  .card-body.grid {
    display: grid;
    gap: var(--space-sm);
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }
  .card-foot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-top: 1px solid var(--border);
    background: var(--bg-sunken);
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
    padding: 0 var(--space-sm);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
  }
  .field.check-row {
    flex-direction: row-reverse;
    justify-content: flex-end;
    align-items: center;
    gap: var(--space-xs);
  }
  .field.check-row input {
    width: 18px;
    height: 18px;
    margin: 0;
  }
  .btn {
    height: var(--hit);
    min-height: var(--hit);
    padding: 0 var(--space-md);
    border-radius: var(--radius);
    border: 1px solid transparent;
    font: inherit;
    font-size: var(--fs-label);
    font-weight: 600;
    cursor: pointer;
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-fg);
  }
  .btn.primary:hover:not(:disabled) {
    background: var(--accent-strong);
  }
  .btn.primary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .btn.ghost {
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--fg);
  }
  .btn.ghost:hover {
    background: var(--bg-sunken);
  }
  .empty {
    margin: 0;
    padding: var(--space-md);
    color: var(--fg-muted);
    text-align: center;
  }
  .class-list,
  .course-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .class-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-md);
    border-bottom: 1px solid var(--border);
  }
  .class-row:last-child {
    border-bottom: 0;
  }
  .class-name {
    font-weight: 500;
  }
  .class-count {
    margin-left: auto;
    color: var(--fg-muted);
    font-size: 12px;
  }
  .course-row {
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border);
    display: grid;
    gap: var(--space-xs);
  }
  .course-row:last-child {
    border-bottom: 0;
  }
  .course-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }
  .course-name {
    font-weight: 600;
  }
  .course-empty {
    margin: 0;
    font-size: var(--fs-caption);
  }
  .course-controls {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .ctrl-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 12px;
  }
  .ctrl-idx {
    color: var(--fg-muted);
    font-size: 10px;
  }
  .ctrl-code {
    font-weight: 600;
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
