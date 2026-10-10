<!--
  Authored for fartola. Not ported from upstream.

  LottningView — operator draw panel for start-time lottning (D-03/D-07).
  Provides class selector, draw mode picker (SOFT, random, mass start,
  seeded, pursuit, reverse pursuit), first-start time, interval, vacant
  slots and where they go, late entrants (before, after, on vacant places;
  SOFT TR 7.5.7/7.5.8), seeding groups (TR 7.4.5) and the pursuit fields
  (TR 7.4.1), and a Lotta button. The class's kind and the competition level
  are shown, because the SOFT rules the server applies depend on them; a
  refused draw says why in Swedish and, for an unconfirmed class kind,
  offers the confirmation right there (ADR-0016 rules 1 and 6). Form logic
  lives in screens/lottning.ts.
  After drawing, shows the sorted start list with assigned start times.
  Re-lotta asks for confirmation before clearing and redrawing.
  Per-runner inline start-time edit is via PATCH competitor start_time_ms.
  SOFT TR 7.5.4: the start list shows the class's start place and course
  length, and a bib column once the class has bibs; bibs are numbered in
  start order (again after every whole-class draw) and can be changed per
  runner in the same inline edit.

  Locked by:
  - 02.1-05-PLAN.md task 1
  - 02.1-02-SUMMARY.md (backend route contract)
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '#lib/i18n/index.ts';
  import {
    getCompetition,
    listClasses,
    listCompetitors,
    postLottning,
    getLottning,
    patchClass,
    patchCompetitorStartTime,
    putSeeding,
    postBibs,
    editCompetitorProfile,
    type DrawMode,
    type DrawType,
    type LottningResponse,
    type LottningResult,
    type VacantPosition,
  } from '#lib/api/client.ts';
  import Field from '#lib/ui/Field.svelte';
  import Select from '#lib/ui/Select.svelte';
  import Input from '#lib/ui/Input.svelte';
  import Button from '#lib/ui/Button.svelte';
  import ClassKindsPanel from '#lib/components/ClassKindsPanel.svelte';
  import StartTimeHistory from '#lib/components/StartTimeHistory.svelte';
  import PreviousResultsUpload from '#lib/components/PreviousResultsUpload.svelte';
  import type {
    ClassDTO,
    CompetitionDistance,
    CompetitionLevel,
    CompetitorDTO,
    StartMethod,
  } from '@fartola/shared-types';
  import { clockToEpochMs, formatClockTime } from '@fartola/shared-types';
  import {
    clockHmLabel,
    fetchCompetitionClock,
    type CompetitionClock,
  } from './competition-clock.ts';
  import { kindStatus } from './class-kinds.ts';
  import {
    DRAW_MODES,
    DRAW_TYPES,
    VACANT_POSITIONS,
    bibTakenOf,
    buildLottningBody,
    closingMoved,
    lateEntrantsAllowed,
    refusalOf,
    seedGroupsFromInput,
    startOrderNote,
    visibleFields,
    type Refusal,
  } from './lottning.ts';

  interface Props {
    competitionId: string;
  }

  let { competitionId }: Props = $props();

  // --- state ----------------------------------------------------------------

  let classes: ClassDTO[] = $state([]);
  let selectedClassId: string = $state('');
  let drawMode: DrawMode = $state('SOFT');
  /** Whole class or only the late entrants (shown once the class has a list). */
  let drawType: DrawType = $state('All');
  let vacantPosition: VacantPosition = $state('Mixed');
  /** Seeded: strongest group first (default last, as MeOS). */
  let bestFirst = $state(false);
  /** Seeded: the typed group per runner id ('' = unseeded). */
  let seedTyped: Record<string, string> = $state({});
  /** Pursuit: restart block (omstart) as HH:MM, and the minutes behind the
   * leader that send a runner there; scale is the time factor. */
  let restartHHMM: string = $state('11:00');
  let maxBehindMin: number = $state(30);
  let scale: number = $state(1);

  /** HH:MM string for the first-start time input. Converted to epoch ms on
   * the competition clock (02.1-14 Task 1: start times are epoch ms). */
  let firstStartHHMM: string = $state('10:00');

  /** Start interval in seconds: the class's, else the distance's norm (SOFT
   * TA till TR 7.4.4) once the class loads; 120 until then (D-07). */
  let intervalSec: number = $state(120);

  /** Number of vacant slots to insert. Default 0. */
  let vacantSlots: number = $state(0);

  /** Max time in seconds for the class (mm:ss input). Null = not set. */
  let maxTimeInput: string = $state('');

  let submitting = $state(false);
  let error: string | null = $state(null);
  /** A refused draw, with its confirm path (ADR-0016 rule 6). */
  let refusal: Refusal | null = $state(null);
  /** What the last draw did (ADR-0016 rule 1, "confirm after"). */
  let done: string | null = $state(null);

  /** Competition level (SOFT TR 3.3.1), shown because seeding depends on it. */
  let level: CompetitionLevel | null = $state(null);
  /** Distance (SOFT TA till TR 7.4.4): the interval hint names its norm. */
  let distance: CompetitionDistance | null = $state(null);
  /** GET lottning's class (SOFT TR 7.4.2/7.4.3 fields), for the start note. */
  let lottClass: LottningResponse['class'] | null = $state(null);
  /** The class the interval was last prefilled for, and whether the
   * operator has typed one for this class: neither a reload of the same
   * class nor a slow first load replaces a typed interval (ADR-0016). */
  let intervalClassId = '';
  let intervalTouched = false;
  /** SOFT TR 4.16.3: the last draw moved the closing time (for the PM). */
  let closingMove: { from: number; to: number } | null = $state(null);
  /** Every runner of the selected class, drawn or not. */
  let classRunners: CompetitorDTO[] = $state([]);
  /** Previous-stage results stored for a class (pursuit), with the class
   * they belong to: shown only while that class is the selected one. */
  let previousResults: { classId: string; results: number; ok: number } | null = $state(null);
  /** A previous-stage result list is being read in: a pursuit drawn now
   * would use the old input times, so the draw waits. */
  let resultsBusy = $state(false);
  /** Bumped whenever start times may have changed: the history refetches. */
  let historyKey = $state(0);

  /** Start list after a draw or on initial load. */
  let startList: LottningResponse['start_list'] = $state([]);
  /** The class fields of the last load (SOFT TR 7.5.4). */
  let classInfo = $state<LottningResponse['class'] | null>(null);
  /** Bib numbering form; filled from the class on load. */
  let bibPrefix = $state('');
  let bibBaseInput = $state('');
  let startNameInput = $state('');
  let startListLoaded = $state(false);

  /** Re-lotta confirmation dialog state. */
  let redrawConfirmOpen = $state(false);

  /** Per-runner inline edit state. Key = competitor id, value = HH:MM:SS string. */
  let editingStartTime: Record<string, string> = $state({});
  /** The bib typed in the same inline edit. */
  let editingBib: Record<string, string> = $state({});
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

  /** Loads overlap (an upload refresh, a class switch, a draw); only the
   * latest may set the list, so an older answer never replaces newer state. */
  let loadGeneration = 0;

  async function loadStartList(): Promise<void> {
    if (!selectedClassId) return;
    const mine = ++loadGeneration;
    try {
      // The clock with the list it formats: both reflect the server now.
      const classId = selectedClassId;
      const [res, detail, runners] = await Promise.all([
        getLottning(competitionId, classId),
        getCompetition(competitionId),
        listCompetitors(competitionId),
      ]);
      if (mine !== loadGeneration) return;
      clock = { date: detail.competition.date, offsetMin: detail.competition.clock_offset_min };
      level = detail.competition.level ?? null;
      distance = detail.competition.distance ?? null;
      if (classId !== intervalClassId) {
        intervalClassId = classId;
        if (!intervalTouched && res.class.suggested_interval_sec != null)
          intervalSec = res.class.suggested_interval_sec;
      }
      lottClass = res.class;
      startList = res.start_list;
      classInfo = res.class;
      bibPrefix = res.class.bib_prefix ?? '';
      bibBaseInput = res.class.bib_base === null ? '' : String(res.class.bib_base);
      startNameInput = res.class.start_name ?? '';
      previousResults = { classId, ...res.previous_results };
      // A late-entrant choice only means something next to an existing list.
      if (startList.length === 0) drawType = 'All';
      classRunners = runners.competitors.filter((r) => r.class_id === classId);
      // The stored seeding groups of every runner in the class, drawn or
      // not (a redraw reuses them; a refused seeded draw has already stored
      // them); what the operator has typed and not yet drawn with stays.
      seedTyped = {
        ...Object.fromEntries(res.seeding.map((r) => [r.id, String(r.seed_group)])),
        ...seedTyped,
      };
      startListLoaded = true;
      historyKey++;
    } catch {
      if (mine !== loadGeneration) return;
      startList = [];
      classInfo = null;
      classRunners = [];
      previousResults = null;
      lottClass = null;
      startListLoaded = true;
    }
  }

  async function onClassChange(): Promise<void> {
    startListLoaded = false;
    startList = [];
    classInfo = null;
    previousResults = null;
    lottClass = null;
    refusal = null;
    done = null;
    closingMove = null;
    error = null;
    redrawConfirmOpen = false;
    drawType = 'All';
    intervalTouched = false;
    await loadStartList();
  }

  /** The class kind was confirmed from the refusal: refresh the kind line. */
  async function onKindSaved(): Promise<void> {
    refusal = null;
    done = t('lottning.kindSaved');
    classes = (await listClasses(competitionId)).classes;
    // The start-order rule reads the confirmed kind (SOFT TR 7.4.2).
    await loadStartList();
  }

  // --- helpers --------------------------------------------------------------

  /** The competition clock (date + UTC offset, ADR-0017) the start list
   * was loaded with; refreshed with every list load. */
  let clock: CompetitionClock | null = $state(null);

  /** HH:MM on the competition clock to epoch ms. */
  function hhmmToMs(hhmm: string, c: CompetitionClock): number {
    const [hh, mm] = hhmm.split(':').map(Number);
    return clockToEpochMs(c.date, (hh ?? 0) * 3600 + (mm ?? 0) * 60, c.offsetMin);
  }

  /** Format epoch ms as HH:MM:SS on the competition clock. */
  function msToHHMMSS(ms: number | null): string {
    if (ms === null || clock === null) return '—';
    return formatClockTime(ms, clock.offsetMin);
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

  const selectedClassName = $derived(classes.find((c) => c.id === selectedClassId)?.name ?? '');
  /** Late entrants can be placed once the class has a start list. */
  const effectiveDrawType = $derived<DrawType>(
    startList.length > 0 && lateEntrantsAllowed(drawMode) ? drawType : 'All'
  );
  const fields = $derived(visibleFields(drawMode, effectiveDrawType));
  const namedRunners = $derived(classRunners.filter((r) => r.name.trim().length > 0));
  const lateEntrants = $derived(namedRunners.filter((r) => r.start_time_ms === null));

  /** What the draw will do, shown before it (ADR-0016 rule 1). */
  const preview = $derived(
    effectiveDrawType === 'All'
      ? t('lottning.preview.all', { count: namedRunners.length, class: selectedClassName })
      : t('lottning.preview.late', { count: lateEntrants.length, class: selectedClassName })
  );

  function summaryOf(res: LottningResult, className: string): string {
    const head = t('lottning.done', { count: res.drawn, class: className });
    if (res.restarted === undefined) return head;
    return `${head} ${t('lottning.donePursuit', {
      restarted: res.restarted,
      without: res.without_result ?? 0,
    })}`;
  }

  async function submitDraw(): Promise<void> {
    if (!selectedClassId || resultsBusy) return;
    if (effectiveDrawType === 'All' && startList.length > 0 && !redrawConfirmOpen) {
      // Existing start list — ask for confirmation
      redrawConfirmOpen = true;
      return;
    }
    redrawConfirmOpen = false;
    submitting = true;
    error = null;
    refusal = null;
    done = null;
    closingMove = null;
    // Everything the draw uses is read now, before the first await: the
    // form is disabled while it runs, and a change made meanwhile must not
    // reach this draw.
    const classId = selectedClassId;
    const className = selectedClassName;
    const mode = drawMode;
    // The class's bib numbering, renumbered after a whole-class draw.
    const bibs = classInfo?.id === classId && classInfo.bib_base != null ? classInfo : null;
    const settings = {
      drawType: effectiveDrawType,
      firstStartHHMM,
      restartHHMM,
      intervalSec: intervalSec ?? 0,
      vacantSlots: vacantSlots ?? 0,
      vacantPosition,
      bestFirst,
      maxBehindMin: maxBehindMin ?? 0,
      scale: scale || 1,
    };
    const groups =
      mode === 'Seeded'
        ? seedGroupsFromInput(
            classRunners.map((r) => r.id),
            seedTyped
          )
        : null;
    try {
      if (mode === 'Seeded') {
        if (groups === null) {
          error = t('lottning.err.seedInvalid');
          return;
        }
        await putSeeding(competitionId, classId, groups);
      }
      // Fetched now: the offset may have been corrected since the list loaded.
      const c = await fetchCompetitionClock(competitionId);
      const body = buildLottningBody({
        mode,
        drawType: settings.drawType,
        firstStartMs: hhmmToMs(settings.firstStartHHMM, c),
        intervalSec: settings.intervalSec,
        vacantSlots: settings.vacantSlots,
        vacantPosition: settings.vacantPosition,
        bestFirst: settings.bestFirst,
        restartMs: hhmmToMs(settings.restartHHMM, c),
        maxBehindMin: settings.maxBehindMin,
        scale: settings.scale,
      });
      const res = await postLottning(competitionId, classId, body);
      done = summaryOf(res, className);
      closingMove = closingMoved(res);
      // A whole-class draw changes the start order: the class's bibs follow it.
      if (settings.drawType === 'All' && bibs !== null) {
        try {
          await postBibs(competitionId, classId, {
            bib_prefix: bibs.bib_prefix,
            bib_base: bibs.bib_base!,
          });
        } catch (e) {
          const bib = bibTakenOf(e);
          error =
            bib !== null ? t('lottning.bibs.err.taken', { bib }) : (e as Error).message;
        }
      }
      await loadStartList();
    } catch (e) {
      refusal = refusalOf(e, className);
    } finally {
      submitting = false;
    }
  }

  const refusalText = $derived.by(() => {
    const r: Refusal | null = refusal;
    if (r === null) return '';
    return t(r.key, {
      ...r.vars,
      ...(r.fieldKey !== undefined ? { field: t(r.fieldKey) } : {}),
    });
  });

  async function saveMaxTime(): Promise<void> {
    if (!selectedClassId) return;
    const sec = parseMaxTime(maxTimeInput);
    try {
      await patchClass(competitionId, selectedClassId, { maxTimeSec: sec });
    } catch (e) {
      error = (e as Error).message;
    }
  }

  /** 02.1-14 Task 9: the selected class has no timing (no times/places shown). */
  const selectedNoTiming = $derived(
    classes.find((c) => c.id === selectedClassId)?.no_timing ?? false
  );
  /** 02.1-14 Task 14: which start the selected class's times run from. */
  const selectedStartMethod = $derived<StartMethod>(
    classes.find((c) => c.id === selectedClassId)?.start_method ?? 'auto'
  );
  const START_METHODS: StartMethod[] = ['auto', 'start_time', 'start_punch'];
  const startNote = $derived.by(() => {
    const c = lottClass;
    return c === null ? null : startOrderNote(c);
  });

  async function saveClassFlag(
    flag: { no_timing: boolean } | { start_method: StartMethod }
  ): Promise<void> {
    if (!selectedClassId) return;
    const id = selectedClassId;
    try {
      await patchClass(competitionId, id, flag);
      classes = classes.map((c) => (c.id === id ? { ...c, ...flag } : c));
    } catch (e) {
      error = (e as Error).message;
    }
  }

  // --- SOFT TR 7.5.4: start place and bibs ---------------------------------

  async function saveStartName(): Promise<void> {
    if (!selectedClassId) return;
    try {
      await patchClass(competitionId, selectedClassId, {
        start_name: startNameInput.trim() || null,
      });
      await loadStartList();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  let numbering = $state(false);
  async function assignBibs(): Promise<void> {
    if (!selectedClassId) return;
    const bibBase = Number(bibBaseInput.trim());
    if (!/^\d+$/.test(bibBaseInput.trim()) || bibBase > 99999) {
      error = t('lottning.bibs.err.base');
      return;
    }
    const prefix = bibPrefix.trim() || null;
    numbering = true;
    error = null;
    done = null;
    try {
      const res = await postBibs(competitionId, selectedClassId, {
        bib_prefix: prefix,
        bib_base: bibBase,
      });
      done = t('lottning.bibs.done', { count: res.numbered, first: `${prefix ?? ''}${bibBase}` });
      await loadStartList();
    } catch (e) {
      const bib = bibTakenOf(e);
      error = bib !== null ? t('lottning.bibs.err.taken', { bib }) : (e as Error).message;
    } finally {
      numbering = false;
    }
  }

  /** The bib column shows once the class is numbered or a runner has one. */
  const showBibs = $derived(
    classInfo?.bib_base != null || startList.some((r) => r.bib !== null)
  );

  // --- per-runner start-time inline edit -----------------------------------

  function startEditTime(id: string, currentMs: number | null, bib: string | null): void {
    editingStartTime = { ...editingStartTime, [id]: msToHHMMSS(currentMs) };
    editingBib = { ...editingBib, [id]: bib ?? '' };
  }

  function cancelEditTime(id: string): void {
    const next = { ...editingStartTime };
    delete next[id];
    editingStartTime = next;
    const nextBib = { ...editingBib };
    delete nextBib[id];
    editingBib = nextBib;
  }

  async function saveEditTime(id: string): Promise<void> {
    const raw = editingStartTime[id] ?? '';
    const parts = raw.split(':').map(Number);
    let newSec: number | null = null;
    if (parts.length >= 2) {
      const h = parts[0] ?? 0;
      const m = parts[1] ?? 0;
      const s = parts[2] ?? 0;
      if (Number.isNaN(h) || Number.isNaN(m) || Number.isNaN(s)) {
        error = t('lottning.invalidTime');
        return;
      }
      newSec = h * 3600 + m * 60 + s;
    }
    if (newSec === null) { cancelEditTime(id); return; }
    const runner = startList.find((r) => r.id === id);
    const bib = (editingBib[id] ?? '').trim();
    savingStartTime = { ...savingStartTime, [id]: true };
    try {
      if (runner !== undefined && bib !== (runner.bib ?? '')) {
        try {
          await editCompetitorProfile(id, { bib: bib || null });
        } catch (e) {
          const taken = bibTakenOf(e);
          error = taken !== null ? t('lottning.bibs.err.takenOne', { bib: taken }) : (e as Error).message;
          return;
        }
      }
      // An unchanged time is not written: rebuilt from the competition date
      // it would move a start after midnight back a day.
      if (runner === undefined || raw !== msToHHMMSS(runner.start_time_ms)) {
        const { date, offsetMin } = await fetchCompetitionClock(competitionId);
        const newMs = clockToEpochMs(date, newSec, offsetMin);
        await patchCompetitorStartTime(competitionId, id, newMs);
      }
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

  const selectedClass = $derived(classes.find((c) => c.id === selectedClassId) ?? null);
  /** The selected class's kind as stored; a name guess is not confirmed. */
  const selectedKindStatus = $derived(
    selectedClass === null
      ? null
      : kindStatus({
          class_id: selectedClass.id,
          name: selectedClass.name,
          class_kind: selectedClass.class_kind ?? null,
          age_class: selectedClass.age_class ?? null,
          class_kind_source: selectedClass.class_kind_source ?? null,
          suggestion: null,
        })
  );
  const MODE_KEYS: Record<DrawMode, string> = {
    SOFT: 'lottning.soft',
    Simultaneous: 'lottning.simultaneous',
    Seeded: 'lottning.seeded',
    Pursuit: 'lottning.pursuit',
    ReversePursuit: 'lottning.reversePursuit',
  };
  const classNames = $derived(Object.fromEntries(classes.map((c) => [c.id, c.name])));
  const infoHref = $derived(`/competition/${encodeURIComponent(competitionId)}/info`);
</script>

<div class="lottning" data-testid="lottning-view">
  <header class="lottning-head">
    <h1>{t('lottning.title')}</h1>
  </header>

  <div class="lottning-form">
    <!-- The draw's settings, locked while a draw runs -->
    <fieldset
      class="draw-settings"
      disabled={submitting || resultsBusy}
      data-testid="lottning-settings"
    >
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

      <!-- What the SOFT rules read: class kind (TR 3.4.2) and level (TR 3.3.1) -->
      {#if selectedClass !== null && selectedKindStatus !== null}
        <div class="context">
          <p data-testid="lottning-class-kind" data-status={selectedKindStatus}>
            {t('classKinds.kind')}:
            <strong
              >{selectedClass.class_kind
                ? t(`classKinds.kind.${selectedClass.class_kind}`)
                : '–'}</strong
            >
            ({t(`classKinds.status.${selectedKindStatus}`)})
            {#if selectedKindStatus !== 'eventor' && selectedKindStatus !== 'operator'}
              <a href={`${infoHref}#klasser`}>{t('lottning.confirmKindLink')}</a>
            {/if}
          </p>
          <p data-testid="lottning-level">
            {t('info.level.label')}:
            <strong>{level === null ? t('info.level.none') : t(`info.level.${level}`)}</strong>
            <a href={infoHref}>{t('lottning.changeLevelLink')}</a>
          </p>
          {#if startNote !== null}
            <p
              class:warn={startNote.key !== 'lottning.openClassFreeStart'}
              data-testid="lottning-start-note"
            >
              {t(startNote.key, startNote.vars)}
            </p>
          {/if}
        </div>
      {/if}

      <!-- Draw mode -->
      <Field label={t('lottning.mode')} htmlFor="lottning-mode">
        <Select id="lottning-mode" bind:value={drawMode} data-testid="lottning-mode-select">
          {#each DRAW_MODES as m (m)}
            <option value={m}>{t(MODE_KEYS[m])}</option>
          {/each}
        </Select>
      </Field>

      <!-- Whole class or late entrants only (SOFT TR 7.5.7, 7.5.8) -->
      {#if startList.length > 0 && lateEntrantsAllowed(drawMode)}
        <fieldset class="radio-group" data-testid="lottning-draw-type">
          <legend>{t('lottning.drawType')}</legend>
          {#each DRAW_TYPES as dt (dt)}
            <label class="radio-row">
              <input type="radio" name="lottning-draw-type" value={dt} bind:group={drawType} />
              <span>{t(`lottning.drawType.${dt}`)}</span>
            </label>
          {/each}
        </fieldset>
      {/if}

      <!-- First start time -->
      {#if fields.firstStart}
        <Field
          label={t(fields.pursuit ? 'lottning.firstStartPursuit' : 'lottning.firstStart')}
          htmlFor="lottning-first-start"
        >
          <Input
            id="lottning-first-start"
            type="time"
            bind:value={firstStartHHMM}
            data-testid="lottning-first-start"
          />
        </Field>
      {/if}

      <!-- Interval (hidden for Simultaneous) -->
      {#if fields.interval}
        <Field
          label={t('lottning.interval')}
          htmlFor="lottning-interval"
          {...!fields.firstStart
            ? { hint: t('lottning.intervalLateHint') }
            : fields.pursuit
              ? { hint: t('lottning.intervalPursuitHint') }
              : distance !== null
                ? { hint: t(`lottning.intervalNorm.${distance}`) }
                : {}}
        >
          <Input
            id="lottning-interval"
            type="number"
            min="0"
            bind:value={intervalSec}
            oninput={() => (intervalTouched = true)}
            data-testid="lottning-interval"
          />
        </Field>
      {/if}

      <!-- Vacant slots and where they go -->
      {#if fields.vacancies}
        <Field label={t('lottning.vacants')} htmlFor="lottning-vacants">
          <Input
            id="lottning-vacants"
            type="number"
            min="0"
            bind:value={vacantSlots}
            data-testid="lottning-vacants"
          />
        </Field>
        {#if vacantSlots > 0}
          <Field label={t('lottning.vacantPosition')} htmlFor="lottning-vacant-position">
            <Select
              id="lottning-vacant-position"
              bind:value={vacantPosition}
              data-testid="lottning-vacant-position"
            >
              {#each VACANT_POSITIONS as vp (vp)}
                <option value={vp}>{t(`lottning.vacantPosition.${vp}`)}</option>
              {/each}
            </Select>
          </Field>
        {/if}
      {/if}

      <!-- Seeding groups (SOFT TR 7.4.5) -->
      {#if fields.seeding}
        <fieldset class="group" data-testid="lottning-seeding">
          <legend>{t('lottning.seeding')}</legend>
          <p class="hint">{t('lottning.seedingHint')}</p>
          <label class="check-row">
            <input type="checkbox" bind:checked={bestFirst} data-testid="lottning-best-first" />
            <span>{t('lottning.bestFirst')}</span>
          </label>
          {#if namedRunners.length === 0}
            <p class="hint">{t('lottning.seedingEmpty')}</p>
          {:else}
            <table class="start-table seed-table">
              <thead>
                <tr>
                  <th>{t('runners.addSheet.nameLabel')}</th>
                  <th>{t('runners.addSheet.clubLabel')}</th>
                  <th>{t('lottning.seedGroup')}</th>
                </tr>
              </thead>
              <tbody>
                {#each namedRunners as r (r.id)}
                  <tr>
                    <td>{r.name}</td>
                    <td class="col-club">{r.club ?? '–'}</td>
                    <td>
                      <input
                        class="seed-input"
                        type="text"
                        inputmode="numeric"
                        aria-label={t('lottning.seedGroupFor', { name: r.name })}
                        value={seedTyped[r.id] ?? ''}
                        oninput={(e) => {
                          seedTyped = { ...seedTyped, [r.id]: e.currentTarget.value };
                        }}
                        data-testid="lottning-seed-input"
                      />
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </fieldset>
      {/if}

      <!-- Pursuit and reverse pursuit (SOFT TR 7.4.1) -->
      {#if fields.pursuit}
        <fieldset class="group" data-testid="lottning-pursuit">
          <legend>{t('lottning.pursuitSettings')}</legend>
          <p class="hint">{t('lottning.pursuitHint')}</p>
          <PreviousResultsUpload
          {competitionId}
          className={selectedClassName}
          loaded={previousResults?.classId === selectedClassId ? previousResults : null}
          onbusy={(b) => (resultsBusy = b)}
          onuploaded={() => loadStartList()}
        />
          <Field label={t('lottning.restart')} htmlFor="lottning-restart">
            <Input
              id="lottning-restart"
              type="time"
              bind:value={restartHHMM}
              data-testid="lottning-restart"
            />
          </Field>
          <Field label={t('lottning.maxBehind')} htmlFor="lottning-max-behind">
            <Input
              id="lottning-max-behind"
              type="number"
              min="1"
              bind:value={maxBehindMin}
              data-testid="lottning-max-behind"
            />
          </Field>
          <Field label={t('lottning.scale')} hint={t('lottning.scaleHint')} htmlFor="lottning-scale">
            <Input
              id="lottning-scale"
              type="number"
              min="0.1"
              max="10"
              step="0.1"
              bind:value={scale}
              data-testid="lottning-scale"
            />
          </Field>
        </fieldset>
      {/if}

    </fieldset>

    <!-- Max time -->
    <Field
      label={t('lottning.maxTime')}
      hint={t('lottning.maxTimeHint')}
      htmlFor="lottning-max-time"
    >
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

    <!-- Class without timing (02.1-14 Task 9) -->
    <label class="check-row">
      <input
        type="checkbox"
        checked={selectedNoTiming}
        disabled={!selectedClassId}
        onchange={(e) => void saveClassFlag({ no_timing: e.currentTarget.checked })}
        data-testid="lottning-no-timing"
      />
      <span>{t('lottning.noTiming')}</span>
    </label>

    <!-- Which start the class's times run from (02.1-14 Task 14) -->
    <Field label={t('lottning.startMethod')} htmlFor="lottning-start-method">
      <Select
        id="lottning-start-method"
        value={selectedStartMethod}
        disabled={!selectedClassId}
        onchange={(e) =>
          void saveClassFlag({ start_method: e.currentTarget.value as StartMethod })}
        data-testid="lottning-start-method"
      >
        {#each START_METHODS as m (m)}
          <option value={m}>{t(`lottning.startMethod.${m}`)}</option>
        {/each}
      </Select>
    </Field>

    <!-- SOFT TR 7.5.4: start place and bibs -->
    <Field label={t('lottning.startName')} hint={t('lottning.startNameHint')} htmlFor="lottning-start-name">
      <div class="max-time-row">
        <Input
          id="lottning-start-name"
          type="text"
          placeholder="Start 1"
          bind:value={startNameInput}
          disabled={!selectedClassId}
          data-testid="lottning-start-name"
        />
        <Button variant="secondary" onclick={saveStartName} disabled={!selectedClassId} data-testid="lottning-start-name-save">
          {t('info.save')}
        </Button>
      </div>
    </Field>

    <fieldset class="group" data-testid="lottning-bibs">
      <legend>{t('lottning.bibs.legend')}</legend>
      <p class="hint">{t('lottning.bibs.hint')}</p>
      <div class="bib-row">
        <Field label={t('lottning.bibs.prefix')} htmlFor="lottning-bib-prefix">
          <Input id="lottning-bib-prefix" type="text" maxlength={8} bind:value={bibPrefix} data-testid="lottning-bib-prefix" />
        </Field>
        <Field label={t('lottning.bibs.base')} htmlFor="lottning-bib-base">
          <Input id="lottning-bib-base" type="text" inputmode="numeric" placeholder="101" bind:value={bibBaseInput} data-testid="lottning-bib-base" />
        </Field>
      </div>
      <div class="draw-btn-row">
        <Button
          variant="secondary"
          onclick={() => void assignBibs()}
          disabled={numbering || !selectedClassId || startList.length === 0}
          data-testid="lottning-bibs-assign"
        >
          {t('lottning.bibs.assign')}
        </Button>
      </div>
    </fieldset>

    {#if error}
      <p class="err" role="alert">{error}</p>
    {/if}

    {#if refusal !== null}
      <div class="refusal" role="alert" data-testid="lottning-refusal">
        <p class="err">{refusalText}</p>
        {#if refusal.fix === 'class_kind' && selectedClassId}
          <ClassKindsPanel
            {competitionId}
            onlyClassId={selectedClassId}
            onSaved={() => void onKindSaved()}
          />
        {:else if refusal.fix === 'level'}
          <a href={infoHref} data-testid="lottning-set-level">{t('lottning.setLevelLink')}</a>
        {/if}
      </div>
    {/if}

    {#if done !== null}
      <p class="done" role="status" data-testid="lottning-done">{done}</p>
    {/if}
    {#if closingMove !== null && clock !== null}
      <p class="warn" role="status" data-testid="lottning-closing-moved">
        {t('lottning.closingMoved', {
          from: clockHmLabel(closingMove.from, clock),
          to: clockHmLabel(closingMove.to, clock),
        })}
      </p>
    {/if}

    <!-- What the draw will do (ADR-0016 rule 1) -->
    {#if selectedClassId && startListLoaded}
      <p class="preview" data-testid="lottning-preview">{preview}</p>
    {/if}

    {#if resultsBusy}
      <p class="preview" role="status" data-testid="lottning-wait-results">
        {t('lottning.waitResults')}
      </p>
    {/if}

    <!-- Draw button — label changes based on whether a start list exists -->
    <div class="draw-btn-row">
      <Button
        variant="primary"
        onclick={() => void submitDraw()}
        disabled={submitting || resultsBusy || !selectedClassId || !startListLoaded}
        data-testid="lottning-draw-btn"
      >
        {submitting
          ? '…'
          : effectiveDrawType !== 'All'
            ? t('lottning.drawLate')
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

  <!-- Recent start-time changes with undo (ADR-0016 rule 2) -->
  <StartTimeHistory
    {competitionId}
    {classNames}
    refreshKey={historyKey}
    onUndone={() => void loadStartList()}
  />

  <!-- Start list result table -->
  {#if startListLoaded && startList.length > 0}
    <section class="start-list" data-testid="lottning-start-list">
      <h2 class="start-list-heading">
        {t('lottning.drawn', { count: startList.length })}
      </h2>
      {#if classInfo?.start_name || classInfo?.course_length_m != null}
        <p class="class-info" data-testid="lottning-class-info">
          {[
            classInfo?.start_name ? t('lottning.classInfo.startName', { name: classInfo.start_name }) : null,
            classInfo?.course_length_m != null
              ? t('lottning.classInfo.length', { length: classInfo.course_length_m })
              : null,
          ]
            .filter((x) => x !== null)
            .join(' · ')}
        </p>
      {/if}
      <table class="start-table" data-testid="lottning-table">
        <thead>
          <tr>
            <th class="col-pos">#</th>
            {#if showBibs}
              <th class="col-bib">{t('lottning.bibs.col')}</th>
            {/if}
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
              {#if showBibs}
                <td class="col-bib mono" data-testid="lottning-bib">
                  {#if editingBib[runner.id] !== undefined}
                    <input
                      type="text"
                      class="bib-edit-input"
                      maxlength="16"
                      aria-label={t('lottning.bibs.col')}
                      value={editingBib[runner.id]}
                      oninput={(e) => { editingBib = { ...editingBib, [runner.id]: (e.currentTarget as HTMLInputElement).value }; }}
                      data-testid="lottning-edit-bib-input"
                    />
                  {:else}
                    {runner.bib ?? '—'}
                  {/if}
                </td>
              {/if}
              <td class="col-name">
                {runner.name}
                {#if runner.marker || runner.seed_group !== null}
                  <span class="markers" data-testid="lottning-marker">
                    {[
                      runner.marker ? t(`lottning.marker.${runner.marker}`) : null,
                      runner.seed_group !== null
                        ? t('lottning.marker.seeded', { group: runner.seed_group })
                        : null,
                    ]
                      .filter((x) => x !== null)
                      .join(' · ')}
                  </span>
                {/if}
              </td>
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
                    onclick={() => startEditTime(runner.id, runner.start_time_ms, runner.bib)}
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
  .check-row {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
  }
  .draw-settings {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }
  .context {
    display: grid;
    gap: 2px;
  }
  .context p,
  .preview,
  .done,
  .warn {
    margin: 0;
    font-size: var(--fs-body);
  }
  .warn {
    color: var(--mp-fg);
    font-weight: 600;
  }
  .context a,
  .refusal a {
    color: var(--accent);
    margin-left: var(--space-xs);
  }
  .radio-group,
  .group {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--space-sm) var(--space-md);
    margin: 0;
    display: grid;
    gap: var(--space-xs);
  }
  .radio-group legend,
  .group legend {
    font-size: 13px;
    font-weight: 500;
    color: var(--fg-muted);
    padding: 0 4px;
  }
  .radio-row {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    min-height: var(--hit);
  }
  .hint {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--fg-muted);
  }
  .seed-input {
    width: 4.5rem;
    min-height: var(--hit);
    padding: 0 var(--space-sm);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
  }
  .refusal {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-xs);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    padding: var(--space-sm);
    background: var(--bg-sunken);
  }
  .refusal .err {
    font-size: var(--fs-body);
    font-weight: 600;
  }
  .preview {
    font-weight: 600;
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
  .markers {
    display: block;
    font-size: var(--fs-label);
    color: var(--fg-muted);
  }
  .col-bib {
    width: 4.5rem;
    white-space: nowrap;
  }
  .bib-edit-input {
    width: 4.5rem;
    font-family: var(--font-mono);
  }
  .bib-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-sm);
  }
  .class-info {
    margin: 0;
    font-size: var(--fs-body);
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
    font-size: var(--fs-label);
    cursor: pointer;
    min-height: var(--hit);
    padding: 0 var(--space-xs);
  }
  .time-edit-input {
    width: 8rem;
    font-family: var(--font-mono);
  }
  .edit-actions {
    display: flex;
    gap: var(--space-xs);
    justify-content: flex-end;
  }
  .edit-action-btn {
    background: none;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    font: inherit;
    font-size: var(--fs-label);
    min-height: var(--hit);
    padding: 0 var(--space-sm);
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
