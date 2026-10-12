<!--
  Authored for fartola. Not ported from upstream.

  Sidebar race-phase control. Reads the active competition's
  race_started_at_ms (Phase 2.1 column added 2026-05-18) and renders one
  of two states:

    - Pre-race (race_started_at_ms === null):
        ▢ "Före tävling" gray pill
        ▢ "Starta tävling" primary CTA (with 2-step confirm; the flip is
          a one-shot per competition so we don't let it happen on a
          stray mis-tap)

    - Race in progress (race_started_at_ms set):
        ▢ "Tävling pågår sedan HH:MM" green pill (no CTA)

  Under the hood: `card_read` events landing BEFORE this timestamp stay
  PEND (the reducer treats them as identity-only scans — e.g. a SIAC
  still carrying punches from a different race scanned at the
  registration desk). Reads AT or AFTER score normally.

  Hidden entirely when no competition is active (no point dangling
  the CTA before the operator has chosen scope).

  The reset is for a start made by mistake. When cards have been read
  since the start the edge refuses it (409 reads_since_start): the
  confirm step then says how many read-outs stop counting and needs a
  tick before "Återställ ändå". A reset that took read-outs away can be
  undone from here, also after a new start and after a reload.
-->
<script lang="ts">
  import { activeCompetition } from '../stores/activeCompetition.svelte.ts';
  import {
    ApiError,
    getResetRaceUndo,
    resetRace,
    startRace,
    undoResetRace,
    type ResetRaceUndo,
  } from '../api/client.ts';
  import { t } from '../i18n/index.ts';

  const active = $derived(activeCompetition.value);
  const isRaceStarted = $derived(
    active !== null && active.race_started_at_ms !== null
  );

  type Mode = 'idle' | 'confirm-start' | 'confirm-reset' | 'confirm-undo';
  let mode: Mode = $state('idle');
  let busy = $state(false);
  let err: string | null = $state(null);
  // Read-outs since the start, once the edge has refused a plain reset, and
  // the start that warning was for: "Återställ ändå" confirms that start.
  let readsAtRisk: number | null = $state(null);
  let riskStartMs: number | null = null;
  let forceTicked = $state(false);
  let undo: ResetRaceUndo | null = $state(null);
  let undoLoadFailed = $state(false);
  // The newest request for the undo wins.
  let undoLoads = 0;

  const activeId = $derived(active?.id ?? null);
  const startedAtMs = $derived(active?.race_started_at_ms ?? null);
  function loadUndo(id: string): void {
    const n = ++undoLoads;
    getResetRaceUndo(id).then(
      (r) => {
        if (n !== undoLoads) return;
        undo = r.undo;
        undoLoadFailed = false;
      },
      () => {
        if (n === undoLoads) undoLoadFailed = true;
      }
    );
  }
  $effect(() => {
    // A start, reset or undo changes what there is to undo.
    void startedAtMs;
    if (activeId !== null) loadUndo(activeId);
  });

  function toIdle(): void {
    mode = 'idle';
    err = null;
    readsAtRisk = null;
    riskStartMs = null;
    forceTicked = false;
  }

  // A confirm step, a read count or a tick belongs to the competition it was
  // given for: none of it carries over when another one becomes active.
  $effect(() => {
    void activeId;
    toIdle();
    undo = null;
    undoLoadFailed = false;
  });

  function formatHHMM(ms: number): string {
    const d = new Date(ms);
    return `${d.getHours().toString().padStart(2, '0')}:${d
      .getMinutes()
      .toString()
      .padStart(2, '0')}`;
  }

  async function onConfirmStart(): Promise<void> {
    if (active === null) return;
    busy = true;
    err = null;
    try {
      // The answer goes into the cached list, so the pill flips at once for
      // every consumer of activeCompetition (Sidebar pill, readout phase
      // indicator, results header) without a list refetch that may fail.
      activeCompetition.update(await startRace(active.id));
      mode = 'idle';
    } catch (e) {
      err = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function onConfirmReset(): Promise<void> {
    // `busy` also stops a second click that lands before the button is disabled.
    if (active === null || busy) return;
    const id = active.id;
    busy = true;
    err = null;
    // A forced reset is for the start the warning named, a plain one for the
    // start on screen; the edge refuses either when the start is another now.
    const forced = readsAtRisk !== null;
    try {
      activeCompetition.update(
        await resetRace(id, forced ? riskStartMs : active.race_started_at_ms, forced)
      );
      if (activeId === id) toIdle();
    } catch (e) {
      // An answer for a competition that is no longer the active one.
      if (activeId !== id) return;
      const body =
        e instanceof ApiError
          ? (e.body as { error?: unknown; reads?: unknown; started_at_ms?: unknown })
          : null;
      if (
        body?.error === 'reads_since_start' &&
        typeof body.reads === 'number' &&
        typeof body.started_at_ms === 'number'
      ) {
        readsAtRisk = body.reads;
        riskStartMs = body.started_at_ms;
        forceTicked = false;
      } else if (body?.error === 'start_changed') {
        err = t('race.reset.startChanged');
        readsAtRisk = null;
        riskStartMs = null;
        forceTicked = false;
        void activeCompetition.refreshList();
      } else {
        err = (e as Error).message;
      }
    } finally {
      busy = false;
    }
  }

  async function onConfirmUndo(): Promise<void> {
    if (active === null || undo === null || busy) return;
    const id = active.id;
    busy = true;
    err = null;
    try {
      activeCompetition.update(await undoResetRace(id, undo));
      if (activeId !== id) return;
      undo = null;
      toIdle();
    } catch (e) {
      if (activeId !== id) return;
      if (e instanceof ApiError && (e.body as { error?: unknown })?.error === 'undo_changed') {
        // Not the undo the card described any more: show what it is now.
        err = t('race.undo.changed');
        loadUndo(id);
      } else {
        err = (e as Error).message;
      }
    } finally {
      busy = false;
    }
  }
</script>

{#if active !== null}
  <div class="phase-wrap">
    {#if mode === 'idle'}
      {#if isRaceStarted && active.race_started_at_ms !== null}
        <div class="phase-pill running" data-testid="race-phase-pill">
          <span class="dot" aria-hidden="true"></span>
          <span class="text">
            {t('race.phase.running', { time: formatHHMM(active.race_started_at_ms) })}
          </span>
        </div>
        <button
          type="button"
          class="reset-btn"
          onclick={() => (mode = 'confirm-reset')}
          data-testid="reset-race-btn"
        >
          {t('race.reset.cta')}
        </button>
      {:else}
        <div class="phase-pill prerace" data-testid="race-phase-pill">
          <span class="dot" aria-hidden="true"></span>
          <span class="text">{t('race.phase.preRace')}</span>
        </div>
        <button
          type="button"
          class="start-btn"
          onclick={() => (mode = 'confirm-start')}
          data-testid="start-race-btn"
        >
          {t('race.start.cta')}
        </button>
      {/if}
      {#if undo !== null}
        <p class="undo-note" data-testid="undo-reset-note">
          {t('race.undo.note', { time: formatHHMM(undo.started_at_ms), count: undo.reads })}
        </p>
        <button
          type="button"
          class="undo-btn"
          onclick={() => (mode = 'confirm-undo')}
          data-testid="undo-reset-btn"
        >
          {t('race.undo.cta')}
        </button>
      {:else if undoLoadFailed}
        <p class="undo-note" role="alert" data-testid="undo-reset-failed">
          {t('race.undo.loadFailed')}
        </p>
        <button
          type="button"
          class="undo-btn"
          onclick={() => activeId !== null && loadUndo(activeId)}
          data-testid="undo-reset-retry"
        >
          {t('race.undo.retry')}
        </button>
      {/if}
    {:else if mode === 'confirm-start'}
      <div class="confirm-card" role="dialog" aria-labelledby="race-confirm-title">
        <p id="race-confirm-title" class="confirm-title">
          {t('race.confirm.title')}
        </p>
        <p class="confirm-body">{t('race.confirm.body')}</p>
        <div class="confirm-actions">
          <button
            type="button"
            class="confirm-cancel"
            onclick={() => {
              mode = 'idle';
              err = null;
            }}
            disabled={busy}
            data-testid="start-race-cancel"
          >
            {t('race.confirm.cancel')}
          </button>
          <button
            type="button"
            class="confirm-go"
            onclick={() => void onConfirmStart()}
            disabled={busy}
            data-testid="start-race-confirm"
          >
            {busy ? t('race.confirm.starting') : t('race.confirm.go')}
          </button>
        </div>
        {#if err}
          <p class="confirm-err" role="alert">{err}</p>
        {/if}
      </div>
    {:else if mode === 'confirm-reset'}
      <div class="confirm-card danger" role="dialog" aria-labelledby="race-reset-title">
        <p id="race-reset-title" class="confirm-title">
          {t('race.reset.title')}
        </p>
        {#if readsAtRisk === null}
          <p class="confirm-body">{t('race.reset.body')}</p>
        {:else}
          <p class="confirm-body" role="alert">
            {t('race.reset.readsBody', { count: readsAtRisk })}
          </p>
          <label class="confirm-check">
            <input
              type="checkbox"
              bind:checked={forceTicked}
              disabled={busy}
              data-testid="reset-race-force-check"
            />
            {t('race.reset.forceCheck')}
          </label>
        {/if}
        <div class="confirm-actions">
          <button
            type="button"
            class="confirm-cancel"
            onclick={toIdle}
            disabled={busy}
            data-testid="reset-race-cancel"
          >
            {t('race.confirm.cancel')}
          </button>
          <button
            type="button"
            class="confirm-go danger"
            onclick={() => void onConfirmReset()}
            disabled={busy || (readsAtRisk !== null && !forceTicked)}
            data-testid="reset-race-confirm"
          >
            {busy
              ? t('race.reset.resetting')
              : readsAtRisk === null
                ? t('race.reset.go')
                : t('race.reset.force')}
          </button>
        </div>
        {#if err}
          <p class="confirm-err" role="alert">{err}</p>
        {/if}
      </div>
    {:else}
      <div class="confirm-card" role="dialog" aria-labelledby="race-undo-title">
        <p id="race-undo-title" class="confirm-title">
          {t('race.undo.title')}
        </p>
        {#if undo !== null}
          <p class="confirm-body">
            {t('race.undo.body', { time: formatHHMM(undo.started_at_ms), count: undo.reads })}
          </p>
        {/if}
        <div class="confirm-actions">
          <button
            type="button"
            class="confirm-cancel"
            onclick={toIdle}
            disabled={busy}
            data-testid="undo-reset-cancel"
          >
            {t('race.confirm.cancel')}
          </button>
          <button
            type="button"
            class="confirm-go"
            onclick={() => void onConfirmUndo()}
            disabled={busy || undo === null}
            data-testid="undo-reset-confirm"
          >
            {busy ? t('race.undo.undoing') : t('race.undo.go')}
          </button>
        </div>
        {#if err}
          <p class="confirm-err" role="alert">{err}</p>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .phase-wrap {
    padding: 0 var(--space-sm) var(--space-sm);
    display: grid;
    gap: var(--space-2xs);
  }
  .phase-pill {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 999px;
    font-size: var(--fs-label);
    font-weight: 600;
    letter-spacing: 0.02em;
    line-height: 1;
  }
  .phase-pill .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
  }
  .phase-pill.prerace {
    background: var(--pend-soft);
    color: var(--fg-muted);
  }
  .phase-pill.running {
    background: var(--ok-soft);
    color: var(--ok);
  }
  .start-btn {
    width: 100%;
    min-height: var(--hit);
    padding: 0 var(--space-md);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--accent-fg);
    font: inherit;
    font-size: var(--fs-label);
    font-weight: 600;
    cursor: pointer;
  }
  .start-btn:hover {
    background: var(--accent-strong);
  }
  .undo-note {
    margin: 0;
    font-size: var(--fs-label);
    color: var(--fg);
    line-height: 1.4;
  }
  .confirm-check {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--hit);
    font-size: var(--fs-label);
    font-weight: 600;
    cursor: pointer;
  }
  .reset-btn,
  .undo-btn {
    width: 100%;
    min-height: var(--hit);
    padding: 0 var(--space-md);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: transparent;
    color: var(--fg-muted);
    font: inherit;
    font-size: var(--fs-label);
    font-weight: 500;
    cursor: pointer;
  }
  .reset-btn:hover {
    background: var(--bg-sunken);
    color: var(--dnf);
    border-color: var(--dnf);
  }
  .undo-btn {
    color: var(--fg);
    font-weight: 600;
  }
  .undo-btn:hover {
    background: var(--bg-sunken);
  }
  .confirm-card {
    padding: var(--space-sm);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    background: var(--accent-soft);
    color: var(--fg);
    display: grid;
    gap: 6px;
  }
  .confirm-title {
    margin: 0;
    font-size: var(--fs-label);
    font-weight: 600;
    color: var(--fg);
  }
  .confirm-body {
    margin: 0;
    font-size: var(--fs-label);
    color: var(--fg-muted);
    line-height: 1.4;
  }
  .confirm-actions {
    display: flex;
    gap: 6px;
  }
  .confirm-cancel,
  .confirm-go {
    flex: 1;
    min-height: var(--hit);
    padding: 0 8px;
    border-radius: var(--radius);
    font: inherit;
    font-size: var(--fs-label);
    font-weight: 600;
    cursor: pointer;
  }
  .confirm-cancel {
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--fg);
  }
  .confirm-cancel:hover:not(:disabled) {
    background: var(--bg-sunken);
  }
  .confirm-go {
    background: var(--accent);
    border: 1px solid var(--accent);
    color: var(--accent-fg);
  }
  .confirm-go:hover:not(:disabled) {
    background: var(--accent-strong);
  }
  .confirm-card.danger {
    border-color: var(--dnf);
    background: var(--dnf-soft, var(--bg-elev));
  }
  .confirm-go.danger {
    background: var(--dnf);
    border-color: var(--dnf);
  }
  .confirm-go.danger:hover:not(:disabled) {
    filter: brightness(0.92);
  }
  .confirm-cancel:disabled,
  .confirm-go:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .confirm-err {
    margin: 0;
    color: var(--dnf);
    font-size: var(--fs-label);
    word-break: break-word;
  }
</style>
