<!--
  Authored for fartola. Not ported from upstream.

  "Rätta resultat": the secretariat's corrections for one runner, each saved
  as an event with a reason and undone by removing it (ADR-0016 rule 2):
    - Måltid: a finish time by hand when the finish unit failed or the card
      is missing (SOFT TR 4.20.6; MeOS "Måltid:", TabRunner.cpp:3446).
    - Stämplar: a control punched by hand from the start card or a pin punch,
      no time (SOFT TR 8.1.4 kommentar; MeOS "<< Lägg till stämpling",
      TabRunner.cpp:3571). The missing controls are offered.
    - Tidstillägg: 1–5 whole minutes (SOFT TR 10.4.2), one minute for a false
      start (TR 4.18.14, its own button); part of the time and the place
      (MeOS "Tidstillägg:", TabRunner.cpp:3455).
  A later read-out does not overwrite a correction. Shows the result the
  corrections give, so the operator sees the effect. Logic lives in
  screens/corrections.ts.
-->
<script lang="ts">
  import { t } from '#lib/i18n/index.ts';
  import { formatClockTime } from '@fartola/shared-types';
  import {
    addManualPunch,
    clearManualFinish,
    clearTimeAddition,
    getCorrections,
    removeManualPunch,
    setManualFinish,
    setTimeAddition,
    type CorrectionsDTO,
  } from '#lib/api/client.ts';
  import { fetchCompetitionClock, type CompetitionClock } from '#lib/screens/competition-clock.ts';
  import { parseControlCode, resolveFinishInput } from '#lib/screens/corrections.ts';
  import { formatElapsed } from '#lib/screens/readout-types.ts';
  import Button from '#lib/ui/Button.svelte';
  import StatusPill from '#lib/ui/StatusPill.svelte';

  interface Props {
    competitionId: string;
    competitorId: string;
    /** Called after a correction is saved or removed. */
    onChanged?: () => void;
  }

  let { competitionId, competitorId, onChanged }: Props = $props();

  let data = $state<CorrectionsDTO | null>(null);
  let clock = $state<CompetitionClock | null>(null);
  let loadError = $state<string | null>(null);
  let busy = $state(false);
  let saveError = $state<string | null>(null);

  let finishText = $state('');
  let finishReason = $state('');
  let finishError = $state<string | null>(null);

  let punchText = $state('');
  let punchReason = $state('');
  let punchError = $state<string | null>(null);

  const MINUTES = [1, 2, 3, 4, 5];
  let additionMin = $state(1);
  let additionReason = $state('');

  /** Only the latest load may set the data (a reload can overlap). */
  let generation = 0;
  async function load(): Promise<void> {
    const mine = ++generation;
    try {
      const [res, c] = await Promise.all([
        getCorrections(competitionId, competitorId),
        fetchCompetitionClock(competitionId),
      ]);
      if (mine !== generation) return;
      data = res;
      clock = c;
      loadError = null;
    } catch (e) {
      if (mine !== generation) return;
      loadError = (e as Error).message;
    }
  }

  $effect(() => {
    void competitionId;
    void competitorId;
    finishText = '';
    finishReason = t('corr.finish.reasonDefault');
    finishError = null;
    punchText = '';
    punchReason = t('corr.punch.reasonDefault');
    punchError = null;
    additionMin = 1;
    additionReason = '';
    saveError = null;
    void load();
  });

  /** Save or remove a correction, then reload; false when it failed. */
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    busy = true;
    saveError = null;
    try {
      await action();
      await load();
      onChanged?.();
      return true;
    } catch (e) {
      saveError = t('corr.err.save', { error: (e as Error).message });
      return false;
    } finally {
      busy = false;
    }
  }

  function setFinish(): void {
    if (data === null || clock === null) return;
    const entry = resolveFinishInput(finishText, data.start_time_ms, clock);
    if ('error' in entry) {
      finishError = t(entry.error === 'invalid' ? 'corr.err.time' : 'corr.err.beforeStart');
      return;
    }
    finishError = null;
    void run(() =>
      setManualFinish(competitionId, competitorId, entry.finishMs, finishReason.trim())
    ).then((ok) => {
      if (ok) finishText = '';
    });
  }

  function addPunch(): void {
    const code = parseControlCode(punchText);
    if (code === null) {
      punchError = t('corr.err.code');
      return;
    }
    punchError = null;
    void run(() => addManualPunch(competitionId, competitorId, code, punchReason.trim())).then(
      (ok) => {
        if (ok) punchText = '';
      }
    );
  }

  const clockTime = (ms: number): string => (clock === null ? '' : formatClockTime(ms, clock.offsetMin));
</script>

<section class="corr" data-testid="corrections" aria-labelledby="corr-h">
  <h3 id="corr-h">{t('corr.title')}</h3>
  <p class="muted">{t('corr.hint')}</p>
  {#if loadError !== null}
    <p class="err" role="alert">{t('corr.err.load', { error: loadError })}</p>
  {:else if data !== null}
    <p class="now" data-testid="corr-now">
      {t('corr.now')}
      <StatusPill status={data.status} small />
      <span class="mono">{formatElapsed(data.elapsed_time_ms)}</span>
    </p>

    <div class="part" data-testid="corr-finish">
      <h4>{t('corr.finish')}</h4>
      {#if data.manual_finish_ms !== null}
        <div class="current">
          <span class="mono" data-testid="corr-finish-time">{clockTime(data.manual_finish_ms)}</span>
          <span class="reason">{data.manual_finish_reason}</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            data-testid="corr-finish-remove"
            onclick={() => void run(() => clearManualFinish(competitionId, competitorId))}
          >
            {t('corr.remove')}
          </Button>
        </div>
      {:else}
        <div class="entry">
          <label class="field">
            <span>{t('corr.finish.time')}</span>
            <input
              type="text"
              class="mono"
              placeholder="HH:MM:SS"
              bind:value={finishText}
              aria-invalid={finishError !== null}
              aria-describedby={finishError !== null ? 'corr-finish-err' : undefined}
              data-testid="corr-finish-input"
            />
          </label>
          <label class="field grow">
            <span>{t('corr.reason')}</span>
            <input
              type="text"
              maxlength="500"
              bind:value={finishReason}
              data-testid="corr-finish-reason"
            />
          </label>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || finishText.trim() === '' || finishReason.trim() === ''}
            data-testid="corr-finish-set"
            onclick={setFinish}
          >
            {t('corr.finish.set')}
          </Button>
        </div>
        {#if finishError !== null}
          <p id="corr-finish-err" class="err" role="alert">{finishError}</p>
        {/if}
      {/if}
    </div>

    <div class="part" data-testid="corr-punches">
      <h4>{t('corr.punch')}</h4>
      {#each data.manual_punches as p, i (i)}
        <div class="current" data-testid="corr-punch">
          <span class="mono">{p.control_code}</span>
          <span class="reason">{p.reason}</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            data-testid="corr-punch-remove"
            onclick={() => void run(() => removeManualPunch(competitionId, competitorId, p.control_code))}
          >
            {t('corr.remove')}
          </Button>
        </div>
      {/each}
      {#if data.missing_codes.length > 0}
        <div class="missing">
          <span>{t('corr.punch.missing')}</span>
          {#each data.missing_codes as code, i (i)}
            <Button
              variant="ghost"
              size="sm"
              data-testid="corr-punch-pick"
              onclick={() => (punchText = String(code))}
            >
              {code}
            </Button>
          {/each}
        </div>
      {/if}
      <div class="entry">
        <label class="field">
          <span>{t('corr.punch.code')}</span>
          <input
            type="text"
            inputmode="numeric"
            class="mono"
            bind:value={punchText}
            aria-invalid={punchError !== null}
            aria-describedby={punchError !== null ? 'corr-punch-err' : undefined}
            data-testid="corr-punch-input"
          />
        </label>
        <label class="field grow">
          <span>{t('corr.reason')}</span>
          <input type="text" maxlength="500" bind:value={punchReason} data-testid="corr-punch-reason" />
        </label>
        <Button
          variant="primary"
          size="sm"
          disabled={busy || punchText.trim() === '' || punchReason.trim() === ''}
          data-testid="corr-punch-add"
          onclick={addPunch}
        >
          {t('corr.punch.add')}
        </Button>
      </div>
      {#if punchError !== null}
        <p id="corr-punch-err" class="err" role="alert">{punchError}</p>
      {/if}
    </div>

    <div class="part" data-testid="corr-addition">
      <h4>{t('corr.addition')}</h4>
      {#if data.time_addition_min > 0}
        <div class="current">
          <span class="mono" data-testid="corr-addition-min">
            {t('corr.addition.minutes', { minutes: data.time_addition_min })}
          </span>
          <span class="reason">{data.time_addition_reason}</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            data-testid="corr-addition-remove"
            onclick={() => void run(() => clearTimeAddition(competitionId, competitorId))}
          >
            {t('corr.remove')}
          </Button>
        </div>
      {:else}
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          data-testid="corr-false-start"
          onclick={() =>
            void run(() =>
              setTimeAddition(competitionId, competitorId, 1, t('corr.addition.falseStart'))
            )}
        >
          {t('corr.addition.falseStartBtn')}
        </Button>
        <div class="entry">
          <label class="field">
            <span>{t('corr.addition.min')}</span>
            <select bind:value={additionMin} data-testid="corr-addition-select">
              {#each MINUTES as m (m)}
                <option value={m}>{t('corr.addition.minutes', { minutes: m })}</option>
              {/each}
            </select>
          </label>
          <label class="field grow">
            <span>{t('corr.reason')}</span>
            <input
              type="text"
              maxlength="500"
              bind:value={additionReason}
              data-testid="corr-addition-reason"
            />
          </label>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || additionReason.trim() === ''}
            data-testid="corr-addition-set"
            onclick={() =>
              void run(() =>
                setTimeAddition(competitionId, competitorId, additionMin, additionReason.trim())
              )}
          >
            {t('corr.addition.set')}
          </Button>
        </div>
      {/if}
    </div>

    {#if saveError !== null}
      <p class="err" role="alert" data-testid="corr-error">{saveError}</p>
    {/if}
  {/if}
</section>

<style>
  .corr {
    display: grid;
    gap: var(--space-sm);
  }
  h3,
  h4 {
    margin: 0;
    font-size: var(--fs-label);
    font-weight: 600;
  }
  .muted,
  .err,
  .now {
    margin: 0;
    font-size: var(--fs-body);
  }
  .muted {
    color: var(--fg-muted);
  }
  .err {
    color: var(--dnf);
  }
  .now {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
  }
  .mono {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum' 1;
  }
  .part {
    display: grid;
    gap: var(--space-xs);
    padding-top: var(--space-xs);
    border-top: 1px solid var(--border);
  }
  .current,
  .entry {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-xs) var(--space-sm);
    font-size: var(--fs-body);
  }
  .current {
    align-items: center;
  }
  .reason {
    flex: 1;
    color: var(--fg-muted);
  }
  .missing {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-xs);
    font-size: var(--fs-body);
    color: var(--fg-muted);
  }
  .field {
    display: grid;
    gap: 4px;
  }
  .field.grow {
    flex: 1;
    min-width: 12rem;
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
  .field input.mono {
    width: 8rem;
  }
  .field input[aria-invalid='true'] {
    border-color: var(--dnf);
  }
</style>
