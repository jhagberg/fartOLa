<!--
  Authored for fartola. Not ported from upstream.

  Export view (/competition/[id]/export). The dedicated page the operator
  reaches via the Export nav. Layout (UI-SPEC §"Export IOF XML 3.0
  ResultList"):

    1. "Exporttyp" — radio toggle Slutgiltig (Final, default) /
       Provisorisk (Provisional). Flipping the toggle re-triggers the
       preview fetch so the validation panel reflects the actual XML
       that will be downloaded.
    2. "Validering" — green box "✓ Validering OK · N klasser · M
       personresultat" when valid; red box listing line + message per
       XSD error when invalid.
    3. "Nedladdning" — primary CTA "↓ Hämta ResultList.xml". Disabled
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
  import { onMount } from 'svelte';
  import { t } from '#lib/i18n/index.ts';
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
  let lastError = $state<string | null>(null);

  const downloadUrl = $derived(exportDownloadUrl(competitionId, status));
  const canDownload = $derived(preview !== null && preview.valid);

  onMount(() => {
    void refresh();
  });

  // Re-fetch when the user flips the toggle. $effect runs on initial mount
  // too; the `if` guards against firing during the SSR/hydration cycle.
  $effect(() => {
    // Track `status` so the effect re-runs when it changes. The initial
    // onMount call already fetched for 'Final'; this branch handles the
    // flip to 'Provisional' and back.
    void status;
    if (typeof window !== 'undefined') {
      void refresh();
    }
  });

  async function refresh(): Promise<void> {
    loading = true;
    lastError = null;
    try {
      const result = await exportPreview(competitionId, status);
      preview = result;
    } catch (err) {
      preview = null;
      lastError = err instanceof Error ? err.message : 'Okänt fel';
    } finally {
      loading = false;
    }
  }

  // SOFT TA till TR 7.8.2: unread is not "not started". Runners never read
  // out are left out of the list until the operator sets them to Ej start.
  let unreadMessage = $state<string | null>(null);
  async function unreadDns(undo: boolean): Promise<void> {
    try {
      const { count } = await setUnreadDns(competitionId, undo);
      unreadMessage = t(undo ? 'export.unreadDns.undone' : 'export.unreadDns.done', {
        n: count,
      });
      await refresh();
    } catch (err) {
      unreadMessage = err instanceof Error ? err.message : 'Okänt fel';
    }
  }

  function onStatusChange(next: ExportStatus): void {
    status = next;
  }

  function errorRows(): ExportPreviewError[] {
    if (preview === null || preview.valid) return [];
    return preview.errors;
  }
</script>

<div class="export" data-testid="export-view">
  <header class="hd">
    <h1 class="h0">Export — IOF XML 3.0 ResultList</h1>
    <p class="muted">
      Validera projektionen mot IOF.xsd och ladda ner resultatlistan som ett standardiserat XML-dokument.
    </p>
  </header>

  <section class="sec" data-testid="export-section-type">
    <h2 class="h1">Exporttyp</h2>
    <label class="radio">
      <input
        type="radio"
        name="export-status"
        value="Final"
        checked={status === 'Final'}
        data-testid="export-status-final"
        onchange={() => onStatusChange('Final')}
      />
      <span>Slutgiltig (Final)</span>
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
      <span>Provisorisk (Provisional)</span>
    </label>
  </section>

  <section class="sec" data-testid="export-section-validation">
    <h2 class="h1">Validering</h2>
    {#if loading}
      <p class="loading" data-testid="export-loading">Validerar …</p>
    {:else if lastError !== null}
      <div class="box err" data-testid="export-error-network">
        <strong>Validering misslyckades</strong>
        <p>{lastError}</p>
      </div>
    {:else if preview === null}
      <p class="muted">—</p>
    {:else if preview.valid}
      <div class="box ok" data-testid="export-valid">
        <strong>✓ Validering OK</strong>
        <p>
          {preview.summary.class_count} klasser · {preview.summary.person_result_count} personresultat
          · status {preview.summary.status}
        </p>
      </div>
    {:else}
      <div class="box err" data-testid="export-invalid">
        <strong>✗ XSD-fel</strong>
        <ul>
          {#each errorRows() as e, i (i)}
            <li>
              {#if e.line !== null && e.line !== undefined}
                <span class="mono">rad {e.line}:</span>
              {/if}
              {e.message}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </section>

  <section class="sec" data-testid="export-section-unread">
    <h2 class="h1">{t('export.unreadDns.title')}</h2>
    {#if preview !== null && preview.valid && preview.summary.pending_count > 0}
      <div class="box err" data-testid="export-pending">
        <strong>{t('export.pending', { n: preview.summary.pending_count })}</strong>
        <p>{t('export.pendingHint')}</p>
      </div>
    {/if}
    <div class="row">
      <button class="btn" data-testid="export-unread-dns" onclick={() => unreadDns(false)}>
        {t('export.unreadDns.set')}
      </button>
      <button class="btn" data-testid="export-unread-dns-undo" onclick={() => unreadDns(true)}>
        {t('export.unreadDns.undo')}
      </button>
    </div>
    {#if unreadMessage !== null}
      <p class="muted" data-testid="export-unread-message">{unreadMessage}</p>
    {/if}
  </section>

  <section class="sec" data-testid="export-section-download">
    <h2 class="h1">Nedladdning</h2>
    <a
      class="btn primary"
      class:disabled={!canDownload}
      href={canDownload ? downloadUrl : undefined}
      data-testid="export-download"
      aria-disabled={!canDownload}
      onclick={(ev) => {
        if (!canDownload) ev.preventDefault();
      }}
    >
      ↓ Hämta ResultList.xml
    </a>
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
    font-size: 28px;
    font-weight: 600;
  }
  .h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }
  .muted {
    color: var(--fg-muted);
  }
  .radio {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  .loading {
    color: var(--fg-muted);
  }
  .box {
    border-radius: 8px;
    padding: 12px 16px;
  }
  .box.ok {
    background: color-mix(in srgb, var(--ok) 12%, transparent);
    border: 1px solid var(--ok);
  }
  .box.err {
    background: color-mix(in srgb, var(--err) 12%, transparent);
    border: 1px solid var(--err);
  }
  .box ul {
    margin: 8px 0 0;
    padding-left: 20px;
  }
  .box li {
    margin-bottom: 4px;
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
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 10px 20px;
    border-radius: 8px;
    background: var(--accent);
    color: var(--accent-fg);
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
    width: max-content;
  }
  .btn.disabled {
    background: var(--fg-muted);
    color: var(--bg);
    cursor: not-allowed;
    pointer-events: none;
  }
</style>
