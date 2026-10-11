<!--
  Authored for fartola.

  CompetitionInfoView — single surface for inspecting and editing a
  competition's static config: name, date, receipt template, auto-print,
  classes (count and class kind, ClassKindsPanel), fees (FeesPanel), and
  courses with their ordered control codes. Phase 2.1 (2026-05-18) addition closing the "no way to see
  imported courses / edit competition" gap surfaced during 4-klubbs
  dress rehearsal.

  Data sources:
   - GET /api/competitions/:id (competition + classes + courses with
     control codes)
   - GET /api/competitions/:id/competitors (count per class)
   - PATCH /api/competitions/:id (name / date / receipt_template /
     auto_print / timing_format / level / distance), one field per
     request: each field saves on change and says "Sparat" or the error
     next to it (ADR-0016 rule 3). Max time keeps its Spara: it locks at
     the first start (SOFT TR 4.21.2).

  No course/control mutation surface here — XML re-import via /import is
  the canonical path for that. We just *show* what's there. Exception
  (02.1-14 Task 5): clicking a control chip voids/unvoids that control
  for the whole competition (GET/POST/DELETE .../voided-controls).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '#lib/i18n/index.ts';
  import {
    getCompetition,
    listCompetitors,
    listVoidedControls,
    maxTimeMinutesToSec,
    patchCompetition,
    setCompetitionMaxTime,
    setControlVoided,
    ApiError,
    type ClosingTime,
  } from '#lib/api/client.ts';
  import { goto } from '$app/navigation';
  import ClassKindsPanel from '#lib/components/ClassKindsPanel.svelte';
  import FeesPanel from '#lib/components/FeesPanel.svelte';
  import Button from '#lib/ui/Button.svelte';
  import Icon from '#lib/ui/Icon.svelte';
  import LoadError from '#lib/ui/LoadError.svelte';
  import SavedNote from '#lib/ui/SavedNote.svelte';
  import { createSaveState } from '#lib/ui/saveState.svelte.ts';
  import { createSaveQueue, type SaveQueue } from '#lib/ui/saveQueue.ts';
  import type {
    CompetitionDTO,
    ClassDTO,
    CourseDTO,
    CompetitorDTO,
    CompetitionLevel,
    CompetitionDistance,
  } from '@fartola/shared-types';
  import { clockHmLabel } from './competition-clock.ts';
  import { validDate } from './wizardDate.ts';

  interface Props {
    competitionId: string;
  }

  let { competitionId }: Props = $props();

  let competition: CompetitionDTO | null = $state(null);
  /** Bumped when a class kind is saved, to reload the fees. */
  let feesKey = $state(0);
  /** Fee saves in flight or waiting: the remount waits for them, or a
   * waiting edit would go out on the old panel's values. */
  let feesPending = $state(0);
  let feesStale = $state(false);
  $effect(() => {
    if (feesStale && feesPending === 0) {
      feesStale = false;
      feesKey++;
    }
  });
  let classes: ClassDTO[] = $state([]);
  let courses: CourseDTO[] = $state([]);
  let competitors: CompetitorDTO[] = $state([]);
  let voidedCodes: number[] = $state([]);
  let loading = $state(true);
  let loadError: string | null = $state(null);

  /** The details card as the form shows it. SOFT TR 3.3.1 level and TA till
   * TR 7.4.4 distance: '' = not set (null on the wire). */
  type Details = {
    name: string;
    date: string;
    receipt_template: CompetitionDTO['receipt_template'];
    auto_print: boolean;
    timing_format: CompetitionDTO['timing_format'];
    level: CompetitionLevel | '';
    distance: CompetitionDistance | '';
  };
  type Key = keyof Details;
  const KEYS: Key[] = [
    'name',
    'date',
    'receipt_template',
    'auto_print',
    'timing_format',
    'level',
    'distance',
  ];
  const NOTE_ID: Record<Key, string> = {
    name: 'info-name-note',
    date: 'info-date-note',
    receipt_template: 'info-receipt-note',
    auto_print: 'info-auto-print-note',
    timing_format: 'info-timing-format-note',
    level: 'info-level-note',
    distance: 'info-distance-note',
  };

  let form: Details = $state({
    name: '',
    date: '',
    receipt_template: 'classic',
    auto_print: false,
    timing_format: 'seconds',
    level: '',
    distance: '',
  });
  /** One save at a time for the card; edits made meanwhile wait for it. */
  let details: SaveQueue<Details> | null = null;
  const notes = Object.fromEntries(KEYS.map((k) => [k, createSaveState()])) as Record<
    Key,
    ReturnType<typeof createSaveState>
  >;
  /** Only a field's newest edit may put its saved value back. */
  const fieldGen = Object.fromEntries(KEYS.map((k) => [k, 0])) as Record<Key, number>;
  let dateInvalid = $state(false);
  // SOFT TR 4.16.3: the closing time for the PM.
  let closing: ClosingTime | null = $state(null);
  let closingGen = 0;
  // SOFT TR 4.21.1: one max time for the competition, in whole minutes.
  let formMaxTimeMin = $state('');
  let maxInvalid = $state(false);
  /** The edge refused the max time: the first start has passed (TR 4.21.2). */
  let maxRefused = $state(false);
  const maxSave = createSaveState();
  /** Only the newest max-time save may set the competition or roll back. */
  let maxGen = 0;
  /** The last void or undo, shown under the course it was made in. */
  let voidLine: { courseId: string; code: number; voided: boolean; failed: boolean } | null =
    $state(null);
  let voidGen = 0;

  /** SOFT TR 4.21.2, as the edge decides it: the race has started or a
   * start time has passed. A refused save says so too. */
  const maxLocked = $derived.by(() => {
    const c: CompetitionDTO | null = competition;
    return (
      maxRefused ||
      (c !== null && c.race_started_at_ms != null) ||
      competitors.some((r) => r.start_time_ms !== null && r.start_time_ms <= Date.now())
    );
  });

  const competitorCountByClass = $derived.by(() => {
    const m = new Map<string, number>();
    for (const c of competitors) m.set(c.class_id, (m.get(c.class_id) ?? 0) + 1);
    return m;
  });

  /** "[H21K] 12 anm." after each class name in the class-kind list. */
  const classDetails = $derived(
    Object.fromEntries(
      classes.map((c) => [
        c.id,
        `${c.short_name ? `[${c.short_name}] ` : ''}${competitorCountByClass.get(c.id) ?? 0} ${t('info.classes.competitorsShort')}`,
      ])
    )
  );

  const classById = $derived.by(() => {
    const m = new Map<string, ClassDTO>();
    for (const c of classes) m.set(c.id, c);
    return m;
  });

  const LEVEL_OPTIONS: CompetitionLevel[] = ['niva1', 'niva2', 'niva3', 'niva4', 'traning'];
  const DISTANCE_OPTIONS: CompetitionDistance[] = ['sprint', 'medel', 'lang', 'ultralang', 'natt'];

  /** HH:MM on the competition clock (ADR-0012), marked after midnight. */
  function clockHm(ms: number): string {
    if (competition === null) return '';
    return clockHmLabel(ms, { date: competition.date, offsetMin: competition.clock_offset_min });
  }

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

  function detailsOf(c: CompetitionDTO): Details {
    return {
      name: c.name,
      date: c.date,
      receipt_template: c.receipt_template,
      auto_print: c.auto_print,
      timing_format: c.timing_format,
      level: c.level ?? '',
      distance: c.distance ?? '',
    };
  }

  async function loadAll(): Promise<void> {
    loading = true;
    loadError = null;
    try {
      const [detail, compsRes, voidedRes] = await Promise.all([
        getCompetition(competitionId),
        listCompetitors(competitionId),
        listVoidedControls(competitionId),
      ]);
      competition = detail.competition;
      classes = detail.classes;
      courses = detail.courses;
      closing = detail.closing;
      competitors = compsRes.competitors;
      voidedCodes = voidedRes.control_codes;
      form = detailsOf(detail.competition);
      details = createSaveQueue(detailsOf(detail.competition), sendDetails);
      formMaxTimeMin = maxTimeToMinutes(detail.competition.max_time_sec);
    } catch (e) {
      console.error('competition load failed:', e);
      loadError = t('info.loadError');
    } finally {
      loading = false;
    }
  }

  /** A field-only patch. The form is not reassigned from the reply: an edit
   * waiting in the queue would be overwritten. */
  async function sendDetails(change: Partial<Details>): Promise<void> {
    const { level, distance, ...rest } = change;
    competition = await patchCompetition(competitionId, {
      ...rest,
      ...(level === undefined ? {} : { level: level === '' ? null : level }),
      ...(distance === undefined ? {} : { distance: distance === '' ? null : distance }),
    });
    // A new date can move the clock offset; the server shifts the starts,
    // so the closing time is fetched again (ADR-0017).
    void refreshClosing();
  }

  async function refreshClosing(): Promise<void> {
    const mine = ++closingGen;
    try {
      const { closing: next } = await getCompetition(competitionId);
      if (mine === closingGen) closing = next;
    } catch (e) {
      console.error('closing time reload failed:', e);
    }
  }

  /** Save one field as it was changed. A failure puts the saved value
   * back, unless a newer edit of the same field came after it (also one
   * that is not valid and was not sent). */
  function saveField<K extends Key>(key: K, value: Details[K]): void {
    const queue = details;
    if (queue === null) return;
    form[key] = value;
    const mine = ++fieldGen[key];
    notes[key].reset();
    if (key === 'date') {
      dateInvalid = !validDate(form.date);
      if (dateInvalid) return;
    }
    void notes[key].run(
      queue.save({ [key]: value } as Partial<Details>).catch((e: unknown) => {
        if (mine === fieldGen[key]) form[key] = queue.saved[key];
        throw e;
      }),
      { error: t('info.fields.saveFailed') }
    );
  }

  function blurOnEnter(e: KeyboardEvent & { currentTarget: HTMLInputElement }): void {
    if (e.key === 'Enter') e.currentTarget.blur();
  }

  async function toggleVoided(courseId: string, code: number): Promise<void> {
    const voided = !voidedCodes.includes(code);
    const mine = ++voidGen;
    try {
      await setControlVoided(competitionId, code, voided);
      const rest = voidedCodes.filter((c) => c !== code);
      voidedCodes = voided ? [...rest, code] : rest;
      if (mine === voidGen) voidLine = { courseId, code, voided, failed: false };
    } catch (e) {
      console.error('void failed:', e);
      if (mine === voidGen) voidLine = { courseId, code, voided, failed: true };
    }
  }

  function maxTimeToMinutes(sec: number | null | undefined): string {
    return sec === null || sec === undefined ? '' : String(Math.round(sec / 60));
  }

  /** One save at a time: Spara is off while one is in flight. */
  async function saveMaxTime(): Promise<void> {
    if (maxSave.state === 'saving') return;
    const sec = maxTimeMinutesToSec(formMaxTimeMin);
    maxInvalid = sec === undefined;
    if (sec === undefined) return;
    const mine = ++maxGen;
    await maxSave.run(
      setCompetitionMaxTime(competitionId, sec).then(
        (updated) => {
          if (mine !== maxGen) return;
          competition = updated;
          void refreshClosing();
        },
        (e: unknown) => {
          if (
            mine === maxGen &&
            e instanceof ApiError &&
            (e.body as { error?: string } | null)?.error === 'max_time_locked'
          ) {
            maxRefused = true;
            formMaxTimeMin = maxTimeToMinutes(competition?.max_time_sec);
          }
          throw e;
        }
      ),
      { error: t('info.maxTime.failed') }
    );
  }

  function goImport(): void {
    void goto(`/competition/${competitionId}/import`);
  }
</script>

{#snippet note(key: Key)}
  <span class="note" data-testid={NOTE_ID[key]}>
    <SavedNote state={notes[key].state} error={notes[key].error} />
  </span>
{/snippet}

<section class="info-view" data-testid="competition-info">
  {#if loading}
    <p class="muted">{t('info.loading')}</p>
  {:else if loadError}
    <LoadError message={loadError} onretry={() => void loadAll()} />
  {:else if competition !== null}
    <header class="info-head">
      <h1>{t('info.title')}</h1>
      <p class="hint">{t('info.hint')}</p>
    </header>

    <!-- Editable fields: each saves on change (ADR-0016 rule 3) -->
    <section class="card" data-testid="info-fields">
      <header class="card-head">
        <h2>{t('info.fields.heading')}</h2>
      </header>
      <div class="card-body grid">
        <div class="field">
          <label for="info-name">{t('info.fields.name')}</label>
          <input
            id="info-name"
            type="text"
            bind:value={form.name}
            onchange={(e) => saveField('name', e.currentTarget.value.trim())}
            onkeydown={blurOnEnter}
            data-testid="info-name"
            maxlength="200"
          />
          {@render note('name')}
        </div>
        <div class="field">
          <label for="info-date">{t('info.fields.date')}</label>
          <!-- ISO text like the wizard's, not type="date" (TI-4). -->
          <input
            id="info-date"
            class="mono"
            type="text"
            bind:value={form.date}
            placeholder={t('wiz.date.placeholder')}
            pattern={'\\d{4}-\\d{2}-\\d{2}'}
            maxlength={10}
            autocomplete="off"
            spellcheck="false"
            aria-invalid={dateInvalid ? 'true' : undefined}
            aria-describedby={dateInvalid ? 'info-date-error' : undefined}
            oninput={() => (dateInvalid = false)}
            onchange={(e) => saveField('date', e.currentTarget.value.trim())}
            onkeydown={blurOnEnter}
            data-testid="info-date"
          />
          {#if dateInvalid}
            <p class="err" role="alert" id="info-date-error" data-testid="info-date-error">
              {t('wiz.date.invalid')}
            </p>
          {/if}
          {@render note('date')}
        </div>
        <div class="field">
          <label for="info-receipt">{t('info.fields.receipt')}</label>
          <select
            id="info-receipt"
            bind:value={form.receipt_template}
            onchange={(e) =>
              saveField(
                'receipt_template',
                e.currentTarget.value as CompetitionDTO['receipt_template']
              )}
            data-testid="info-receipt"
          >
            {#each RECEIPT_OPTIONS as opt (opt)}
              <option value={opt}>{t(`info.receipt.${opt}`)}</option>
            {/each}
          </select>
          {@render note('receipt_template')}
        </div>
        <div class="field">
          <label for="info-timing-format">{t('settings.timing.label')}</label>
          <select
            id="info-timing-format"
            bind:value={form.timing_format}
            onchange={(e) =>
              saveField('timing_format', e.currentTarget.value as Details['timing_format'])}
            data-testid="info-timing-format"
          >
            <option value="seconds">{t('settings.timing.seconds')}</option>
            <option value="tenths">{t('settings.timing.tenths')}</option>
          </select>
          {@render note('timing_format')}
        </div>
        <div class="field">
          <label for="info-level">{t('info.level.label')}</label>
          <select
            id="info-level"
            bind:value={form.level}
            aria-describedby="info-level-hint"
            onchange={(e) => saveField('level', e.currentTarget.value as Details['level'])}
            data-testid="info-level"
          >
            <option value="">{t('info.level.none')}</option>
            {#each LEVEL_OPTIONS as lvl (lvl)}
              <option value={lvl}>{t(`info.level.${lvl}`)}</option>
            {/each}
          </select>
          {@render note('level')}
          <small class="field-hint" id="info-level-hint">{t('info.level.hint')}</small>
        </div>
        <div class="field">
          <label for="info-distance">{t('info.distance.label')}</label>
          <select
            id="info-distance"
            bind:value={form.distance}
            aria-describedby="info-distance-hint"
            onchange={(e) => saveField('distance', e.currentTarget.value as Details['distance'])}
            data-testid="info-distance"
          >
            <option value="">{t('info.distance.none')}</option>
            {#each DISTANCE_OPTIONS as d (d)}
              <option value={d}>{t(`info.distance.${d}`)}</option>
            {/each}
          </select>
          {@render note('distance')}
          <small class="field-hint" id="info-distance-hint">{t('info.distance.hint')}</small>
        </div>
        <!-- TI-7: the checkbox before its label, in a row of its own. -->
        <div class="field check-field">
          <label class="check-row">
            <input
              type="checkbox"
              bind:checked={form.auto_print}
              onchange={(e) => saveField('auto_print', e.currentTarget.checked)}
              data-testid="info-auto-print"
            />
            <span>{t('info.fields.autoPrint')}</span>
          </label>
          {@render note('auto_print')}
        </div>
      </div>
    </section>

    <!-- Max time (SOFT TR 4.21.1–4.21.2): an explicit Spara, it locks at the first start -->
    <section class="card">
      <header class="card-head">
        <h2>{t('info.maxTime.heading')}</h2>
      </header>
      <div class="card-body">
        <div class="field">
          <label for="info-max-time">{t('info.maxTime.label')}</label>
          <input
            id="info-max-time"
            type="text"
            inputmode="numeric"
            placeholder="150"
            bind:value={formMaxTimeMin}
            readonly={maxLocked}
            oninput={() => (maxInvalid = false)}
            aria-invalid={maxInvalid ? 'true' : undefined}
            aria-describedby={maxInvalid
              ? 'info-max-time-lock info-max-time-error'
              : 'info-max-time-lock'}
            data-testid="info-max-time"
          />
          <p class="field-hint" id="info-max-time-lock" data-testid="info-max-time-lock">
            {maxLocked ? t('info.maxTime.lockedNote') : t('info.maxTime.lockNote')}
          </p>
          {#if maxInvalid}
            <p class="err" role="alert" id="info-max-time-error">{t('info.maxTime.invalid')}</p>
          {/if}
        </div>
        <details class="rule" data-testid="info-max-time-rule">
          <summary>{t('info.maxTime.showRule')}</summary>
          <p>{t('info.maxTime.hint')}</p>
        </details>
        <!-- SOFT TR 4.16.3, TR 4.22.1: last start + max time, for the PM -->
        <dl class="closing" data-testid="info-closing">
          <dt>{t('info.closing.lastStart')}</dt>
          <dd class="mono">
            {closing?.last_start_ms != null ? clockHm(closing.last_start_ms) : t('info.closing.none')}
          </dd>
          <dt>{t('info.closing.label')}</dt>
          <dd class="mono" data-testid="info-closing-time">
            {closing?.closing_time_ms != null
              ? clockHm(closing.closing_time_ms)
              : t('info.closing.none')}
          </dd>
        </dl>
        <p class="hint">{t('info.closing.hint')}</p>
      </div>
      <div class="card-foot">
        <span class="note" data-testid="info-max-time-note">
          <SavedNote
            state={maxSave.state}
            error={maxRefused ? t('info.maxTime.locked') : maxSave.error}
          />
        </span>
        <Button
          onclick={saveMaxTime}
          disabled={maxLocked ||
            maxSave.state === 'saving' ||
            formMaxTimeMin === maxTimeToMinutes(competition.max_time_sec)}
          data-testid="info-max-time-save"
        >
          {t('info.save')}
        </Button>
      </div>
    </section>

    <!-- Classes with their class kind (SOFT TR 3.4.2) -->
    <section class="card" id="klasser">
      <header class="card-head">
        <h2>{t('info.classes.heading')}</h2>
        <span class="badge mono">{classes.length}</span>
      </header>
      {#if classes.length === 0}
        <p class="empty">{t('info.classes.empty')}</p>
      {:else}
        <ClassKindsPanel
          {competitionId}
          details={classDetails}
          onSaved={() => (feesStale = true)}
        />
      {/if}
    </section>

    <!-- Fees for walk-ups and hired cards (SOFT TR 4.12.4, TR 4.12.6) -->
    <section class="card" id="avgifter">
      <header class="card-head">
        <h2>{t('fees.heading')}</h2>
      </header>
      <!-- Remounted after a class kind is saved: the kind decides the youth
           fee field and the cap shown. Not while a fee save is pending. -->
      {#key feesKey}
        <FeesPanel
          {competitionId}
          eventorLinked={competition?.eventor_event_id != null}
          bind:pending={feesPending}
        />
      {/key}
    </section>

    <!-- Courses with ordered control codes -->
    <section class="card">
      <header class="card-head">
        <h2>{t('info.courses.heading')}</h2>
        <span class="badge mono">{courses.length}</span>
        <span class="head-act">
          <Button variant="secondary" size="sm" onclick={goImport} data-testid="info-reimport">
            {t('info.courses.reimport')}
          </Button>
        </span>
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
                    {@const voided = voidedCodes.includes(ctrl.control_code)}
                    <li>
                      <button
                        type="button"
                        class="ctrl-chip mono"
                        class:voided
                        aria-pressed={voided}
                        title={t(voided ? 'info.courses.unvoidControl' : 'info.courses.voidControl', {
                          code: ctrl.control_code,
                        })}
                        onclick={() => void toggleVoided(crs.id, ctrl.control_code)}
                        data-testid="info-ctrl-chip"
                        data-code={ctrl.control_code}
                      >
                        <span class="ctrl-idx">{ctrl.order_idx + 1}</span>
                        <span class="ctrl-code">{ctrl.control_code}</span>
                        {#if voided}
                          <Icon name="strikethrough" size={16} />
                          <span>{t('info.courses.voided')}</span>
                        {/if}
                      </button>
                    </li>
                  {/each}
                </ol>
                <!-- TI-1: the result of a void, or its error, at the chips. -->
                <div class="void-live" aria-live="polite">
                  {#if voidLine !== null && voidLine.courseId === crs.id}
                    {@const line = voidLine}
                    <div class="void-line" data-testid="info-void-result">
                      {#if line.failed}
                        <span class="err">
                          <Icon name="alert-triangle" size={16} />
                          {t(line.voided ? 'info.courses.voidFailed' : 'info.courses.unvoidFailed', {
                            code: line.code,
                          })}
                        </span>
                      {:else}
                        <span>
                          {t(line.voided ? 'info.courses.voidedLine' : 'info.courses.unvoidedLine', {
                            code: line.code,
                          })}
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          onclick={() => void toggleVoided(crs.id, line.code)}
                          data-testid="info-void-undo"
                        >
                          {t('info.courses.undo')}
                        </Button>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
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
    font-size: var(--fs-label);
  }
  .closing {
    display: grid;
    grid-template-columns: max-content auto;
    gap: 4px 16px;
    margin: 12px 0 0;
  }
  .closing dt {
    color: var(--fg-muted);
  }
  .closing dd {
    margin: 0;
    font-weight: 600;
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
    font-size: var(--fs-label);
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
    font-size: var(--fs-label);
  }
  .head-act {
    margin-left: auto;
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
    flex-wrap: wrap;
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
  .field > label {
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
  .field .field-hint {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--fg-muted);
  }
  .field input[readonly] {
    background: var(--bg-sunken);
  }
  /* TI-7: the checkbox before its label, in a row of its own. */
  .check-field {
    grid-column: 1 / -1;
  }
  .check-row {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    min-height: var(--hit);
    cursor: pointer;
  }
  .field .check-row input {
    width: 24px;
    height: 24px;
    min-height: 0;
    margin: 0;
    padding: 0;
  }
  .rule {
    margin: var(--space-sm) 0 0;
  }
  .rule summary {
    display: flex;
    align-items: center;
    min-height: var(--hit);
    cursor: pointer;
    color: var(--fg-muted);
    font-size: var(--fs-label);
  }
  .rule p {
    margin: 0;
  }
  .empty {
    margin: 0;
    padding: var(--space-md);
    color: var(--fg-muted);
    text-align: center;
  }
  .course-list {
    list-style: none;
    margin: 0;
    padding: 0;
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
    min-height: var(--hit);
    padding: 2px 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: var(--fs-label);
    color: inherit;
    cursor: pointer;
  }
  .ctrl-chip.voided {
    background: var(--bg-sunken);
    border-color: var(--border-strong);
  }
  .ctrl-chip.voided .ctrl-code {
    text-decoration: line-through;
  }
  .ctrl-idx {
    color: var(--fg-muted);
    font-size: var(--fs-label);
  }
  .ctrl-code {
    font-weight: 600;
  }
  .void-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-sm);
  }
  .void-line .err {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
</style>
