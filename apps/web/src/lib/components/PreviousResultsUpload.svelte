<!--
  Authored for fartola. Not ported from upstream.

  "Resultat från förra etappen": upload an IOF XML 3.0 ResultList (day 1
  from MeOS, OLA or Eventor) that a pursuit and reverse pursuit are drawn
  from (SOFT TR 7.4.1). Says what it read and lists the runners it could
  not match; they start in the restart block. A new file replaces the
  results of the classes it contains. Shown in LottningView's pursuit
  fields.
-->
<script lang="ts">
  import { t } from '#lib/i18n/index.ts';
  import {
    ApiError,
    importPreviousResults,
    type PreviousResultsImport,
  } from '#lib/api/client.ts';
  import Button from '#lib/ui/Button.svelte';

  interface Props {
    competitionId: string;
    /** Told when an upload starts and ends: the parent holds the pursuit
     * draw until the input times are in. */
    onbusy?: (busy: boolean) => void;
  }

  let { competitionId, onbusy }: Props = $props();

  let file = $state<File | null>(null);
  let busy = $state(false);
  /** The last upload's answer, with the name of the file it read. */
  let result = $state<(PreviousResultsImport & { file: string }) | null>(null);
  let error = $state<string | null>(null);

  const ERRORS: Record<string, string> = {
    xsd_invalid: 'pursuitResults.err.xsdInvalid',
    parse_failed: 'pursuitResults.err.parseFailed',
    no_file: 'pursuitResults.err.noFile',
    file_too_large: 'pursuitResults.err.tooLarge',
  };

  async function upload(): Promise<void> {
    if (file === null) return;
    const sent = file;
    busy = true;
    onbusy?.(true);
    error = null;
    result = null;
    try {
      result = { ...(await importPreviousResults(competitionId, sent)), file: sent.name };
    } catch (e) {
      const code =
        e instanceof ApiError && e.body !== null && typeof e.body === 'object'
          ? (e.body as { error?: string }).error
          : undefined;
      const key = code !== undefined ? ERRORS[code] : undefined;
      error =
        key !== undefined ? t(key) : t('pursuitResults.err.failed', { error: (e as Error).message });
    } finally {
      busy = false;
      onbusy?.(false);
    }
  }
</script>

<div class="upload" data-testid="pursuit-results">
  <label class="file-label" for="pursuit-results-file">{t('pursuitResults.label')}</label>
  <p class="hint" id="pursuit-results-hint">{t('pursuitResults.hint')}</p>
  <div class="row">
    <input
      id="pursuit-results-file"
      type="file"
      accept=".xml,application/xml,text/xml"
      aria-describedby="pursuit-results-hint"
      disabled={busy}
      onchange={(e) => {
        file = e.currentTarget.files?.[0] ?? null;
        result = null;
        error = null;
      }}
      data-testid="pursuit-results-file"
    />
    <Button
      variant="secondary"
      disabled={file === null || busy}
      onclick={() => void upload()}
      data-testid="pursuit-results-upload"
    >
      {busy ? t('pursuitResults.uploading') : t('pursuitResults.upload')}
    </Button>
  </div>

  {#if error !== null}
    <p class="err" role="alert" data-testid="pursuit-results-error">{error}</p>
  {/if}

  {#if result !== null}
    <div role="status" data-testid="pursuit-results-done">
      <p class="done">
        {t('pursuitResults.done', {
          file: result.file,
          results: result.results,
          matched: result.matched,
        })}
      </p>
      {#if result.unmatched.length > 0}
        <p>{t('pursuitResults.unmatched', { count: result.unmatched.length })}</p>
        <ul class="unmatched" data-testid="pursuit-results-unmatched">
          {#each result.unmatched as u (u.competitor_id)}
            <li>{u.class_name}: {u.name}{u.club ? `, ${u.club}` : ''}</li>
          {/each}
        </ul>
      {:else}
        <p>{t('pursuitResults.allMatched')}</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .upload {
    display: grid;
    gap: var(--space-xs);
  }
  .file-label {
    font-size: 13px;
    color: var(--fg-muted);
    font-weight: 500;
  }
  .hint {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--fg-muted);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-sm);
    align-items: center;
  }
  .row input[type='file'] {
    min-height: var(--hit);
    font: inherit;
    font-size: var(--fs-body);
  }
  p {
    margin: 0;
    font-size: var(--fs-body);
  }
  .err {
    color: var(--dnf);
  }
  .done {
    font-weight: 600;
  }
  .unmatched {
    margin: var(--space-2xs, 4px) 0 0;
    padding-left: 1.2rem;
    max-height: 12rem;
    overflow-y: auto;
    font-size: var(--fs-body);
  }
</style>
