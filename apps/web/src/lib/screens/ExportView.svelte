<!--
  Authored for fartola. Not ported from upstream.

  Export view (/competition/[id]/export). The dedicated page the operator
  reaches via the Export nav. Layout (UI-SPEC §"Export IOF XML 3.0
  ResultList"):

    1. "Typ" — radio toggle Slutgiltig (default) /
       Preliminär. Flipping the toggle re-triggers the
       preview fetch so the validation panel reflects the actual XML
       that will be downloaded.
    2. "Kontroll" — green box "Filen är giltig · N klasser · M
       resultat" when valid; red box with the error lines when invalid.
    3. "Hämta fil" — primary CTA "Hämta resultatfilen". Disabled
       until preview returns valid=true. Click navigates the window to
       the download URL so the browser handles the file save via the
       server-set Content-Disposition header (no fetch + blob URL
       gymnastics; the browser already knows how to do this).

  SC#6 binding contract: the download CTA is the only way to fetch the
  XML, and it goes through GET /api/competitions/:id/export which gates
  the body on validateXml at the server (apps/edge/src/routes/export.ts).

  Locked by:
  - 01-16-PLAN.md task 2
  - 01-UI-SPEC.md §"Export IOF XML 3.0 ResultList"
  - REQ-EVT-CMP-008 + REQ-STD-002 + SC#6
-->
<script lang="ts">
  import { t } from '#lib/i18n/index.ts';
  import Icon from '#lib/ui/Icon.svelte';
  import Button from '#lib/ui/Button.svelte';
  import {
    exportPreview,
    exportDownloadUrl,
    setUnreadDns,
    type ExportStatus,
    type ExportPreviewResult,
    type ExportPreviewError,
  } from '#lib/api/client.ts';

  interface Props {
    competitionId: string;
  }

  let { competitionId }: Props = $props();

  let status = $state<ExportStatus>('Final');
  let loading = $state<boolean>(false);
  let preview = $state<ExportPreviewResult | null>(null);
  // The type the shown preview was made for: a download is only safe when
  // it matches the chosen type.
  let previewStatus = $state<ExportStatus | null>(null);
  let lastError = $state<string | null>(null);
  let downloaded = $state<boolean>(false);

  const downloadUrl = $derived(exportDownloadUrl(competitionId, status));
  const canDownload = $derived(
    preview !== null && preview.valid && !loading && previewStatus === status
  );
  const pending = $derived(
    preview !== null && preview.valid ? preview.summary.pending_count : 0
  );

  // Only the newest request may set the preview or clear `loading`.
  let requestGen = 0;

  // The one place the preview is fetched: on load and when the type flips.
  $effect(() => {
    void status;
    void refresh();
  });

  async function refresh(): Promise<void> {
    const gen = ++requestGen;
    const asked = status;
    loading = true;
    lastError = null;
    try {
      const result = await exportPreview(competitionId, asked);
      if (gen !== requestGen) return;
      preview = result;
      previewStatus = asked;
    } catch (err) {
      if (gen !== requestGen) return;
      preview = null;
      previewStatus = null;
      lastError = err instanceof Error ? err.message : t('common.unknownError');
    } finally {
      if (gen === requestGen) loading = false;
    }
  }

  // SOFT TA till TR 7.8.2: unread is not "not started". Runners never read
  // out are left out of the list until the operator sets them to Ej start.
  let unreadMessage = $state<string | null>(null);
  let busy = $state<boolean>(false);
  async function unreadDns(undo: boolean): Promise<void> {
    busy = true;
    downloaded = false;
    try {
      const { count } = await setUnreadDns(competitionId, undo);
      unreadMessage = t(undo ? 'export.unreadDns.undone' : 'export.unreadDns.done', {
        n: count,
      });
      await refresh();
    } catch (err) {
      unreadMessage = err instanceof Error ? err.message : t('common.unknownError');
    } finally {
      busy = false;
    }
  }

  function onStatusChange(next: ExportStatus): void {
    status = next;
    downloaded = false;
  }

  function errorRows(): ExportPreviewError[] {
    if (preview === null || preview.valid) return [];
    return preview.errors;
  }
</script>

<div class="export" data-testid="export-view">
  <header class="hd">
    <h1 class="h0">{t('export.title')}</h1>
    <p class="muted">{t('export.intro')}</p>
  </header>

  <section class="sec" data-testid="export-section-type">
    <h2 class="h1">{t('export.typeHeading')}</h2>
    <label class="radio">
      <input
        type="radio"
        name="export-status"
        value="Final"
        checked={status === 'Final'}
        data-testid="export-status-final"
        onchange={() => onStatusChange('Final')}
      />
      <span>{t('export.type.final')}</span>
    </label>
    <label class="radio">
      <input
        type="radio"
        name="export-status"
        value="Provisional"
        checked={status === 'Provisional'}
        data-testid="export-status-provisional"
        onchange={() => onStatusChange('Provisional')}
      />
      <span>{t('export.type.provisional')}</span>
    </label>
  </section>

  <section class="sec" data-testid="export-section-validation">
    <h2 class="h1">{t('export.check')}</h2>
    {#if loading}
      <p class="loading" data-testid="export-loading">{t('export.checking')}</p>
    {:else if lastError !== null}
      <div class="box err" data-testid="export-error-network">
        <strong><Icon name="alert-triangle" size={18} /> {t('export.error')}</strong>
        <p>{t('export.loadError')}</p>
        <details>
          <summary>{t('export.details')}</summary>
          <p>{lastError}</p>
        </details>
      </div>
    {:else if preview === null}
      <p class="muted">—</p>
    {:else if preview.valid}
      <div class="box ok" data-testid="export-valid">
        <strong><Icon name="check" size={18} /> {t('export.valid')}</strong>
        <p>
          {t('export.counts', {
            classes: preview.summary.class_count,
            results: preview.summary.person_result_count,
          })}
        </p>
      </div>
    {:else}
      <div class="box err" data-testid="export-invalid">
        <strong><Icon name="alert-triangle" size={18} /> {t('export.error')} {t('export.invalid')}</strong>
        <details>
          <summary>{t('export.details')}</summary>
          <ul>
            {#each errorRows() as e, i (i)}
              <li>
                {#if e.line !== null && e.line !== undefined}
                  <span class="mono">{t('export.line', { line: e.line })}</span>
                {/if}
                {e.message}
              </li>
            {/each}
          </ul>
        </details>
      </div>
    {/if}
  </section>

  <section class="sec" data-testid="export-section-unread">
    <h2 class="h1">{t('export.unreadDns.title')}</h2>
    {#if preview !== null && preview.valid && preview.summary.pending_count > 0}
      <div class="box err" data-testid="export-pending">
        <strong><Icon name="alert-triangle" size={18} /> {t('export.pending', { n: preview.summary.pending_count })}</strong>
        <p>{t('export.pendingHint')}</p>
      </div>
    {/if}
    <div class="row">
      <Button
        variant="primary"
        disabled={pending === 0 || busy}
        data-testid="export-unread-dns"
        onclick={() => unreadDns(false)}
      >
        {busy ? t('export.unreadDns.busy') : t('export.unreadDns.set', { n: pending })}
      </Button>
      <Button
        variant="secondary"
        disabled={busy}
        data-testid="export-unread-dns-undo"
        onclick={() => unreadDns(true)}
      >
        {t('export.unreadDns.undo')}
      </Button>
    </div>
    {#if unreadMessage !== null}
      <p class="muted" data-testid="export-unread-message">{unreadMessage}</p>
    {/if}
  </section>

  <section class="sec" data-testid="export-section-download">
    <h2 class="h1">{t('export.downloadHeading')}</h2>
    <a
      class="download"
      href={canDownload ? downloadUrl : undefined}
      data-testid="export-download"
      aria-disabled={!canDownload}
      onclick={(ev) => {
        if (!canDownload) ev.preventDefault();
        else downloaded = true;
      }}
    >
      <Icon name="download" size={18} /> {t('export.download')}
    </a>
    {#if downloaded}
      <p class="muted" data-testid="export-next">
        {t('export.next')}
        <a href={`/competition/${encodeURIComponent(competitionId)}/eventor-publish`}
          >{t('export.nextLink')}</a
        >
      </p>
    {/if}
  </section>
</div>

<style>
  .export {
    display: flex;
    flex-direction: column;
    gap: 24px;
    max-width: 720px;
  }
  .hd .muted {
    margin-top: 4px;
  }
  .sec {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .h0 {
    margin: 0;
    font-size: var(--fs-display);
    font-weight: 600;
  }
  .h1 {
    margin: 0;
    font-size: var(--fs-heading);
    font-weight: 600;
  }
  .muted {
    color: var(--fg-muted);
  }
  .radio {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: var(--hit);
    cursor: pointer;
  }
  .radio input {
    width: 24px;
    height: 24px;
    accent-color: var(--accent);
  }
  .loading {
    color: var(--fg-muted);
  }
  .box {
    border-radius: var(--radius);
    padding: 12px 16px;
  }
  .box.ok {
    background: color-mix(in srgb, var(--ok) 12%, transparent);
    border: 1px solid var(--ok);
  }
  .box.err {
    border: 1px solid var(--dnf);
    background: var(--dnf-soft);
    color: var(--fg);
  }
  .box ul {
    margin: 8px 0 0;
    padding-left: 20px;
  }
  .box li {
    margin-bottom: 4px;
  }
  .box summary {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: var(--hit);
    cursor: pointer;
  }
  /* display: flex drops the native marker; draw it back. */
  .box summary::before {
    content: '\25B8' / '';
  }
  .box details[open] > summary::before {
    content: '\25BE' / '';
  }
  .mono {
    font-family: var(--font-mono);
    color: var(--fg-muted);
    margin-right: 4px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .download {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: var(--hit);
    padding: 0 var(--space-md);
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--accent-fg);
    border: 1px solid var(--accent);
    font-weight: 600;
    text-decoration: none;
    width: max-content;
  }
  .download[aria-disabled='true'] {
    background: var(--bg-sunken);
    color: var(--fg-muted);
    border-color: var(--border);
    cursor: not-allowed;
  }
</style>
