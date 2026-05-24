<!--
  Authored for fartola. Not ported from upstream.

  Wizard step 3 — reader detect + ▶ Starta avläsning.

  Reader-handshake simulation (plan 12 dev mode):
   - On mount, `readerStatus` flips 'opening' → 'open' after 1600ms.
     The real bridge `connection_changed` channel lands authoritatively
     in plan 13's readout view; for the wizard, the 1.6s timeout
     mirrors the locked UI-SPEC §"Visual Anchors" pulse keyframe.
   - The Starta-avläsning button is disabled until readerStatus === 'open'.

  Single atomic POST (Codex C-H3 LOCKED):
   - On Starta-avläsning click, we base64-encode the pendingFile bytes
     and fire ONE POST to /api/competitions/from-wizard. The endpoint
     wraps competition INSERT + XML ingest in a single SQLite
     transaction; on any failure NO orphan row persists.
   - On 201: setActiveCompetition + goto(/competition/{id}/readout).
   - On 4xx/5xx: map error code → Swedish message; wizard stays open;
     no navigation, no setActiveCompetition.

  Base64 encoding: arrayBuffer → Uint8Array → String.fromCharCode → btoa.
  We avoid FileReader.readAsDataURL because it prefixes a `data:` URL
  that we'd then have to strip; the manual route is one less foot-gun.

  Locked by:
  - 01-UI-SPEC.md §"Click 1, Click 2, Click 3"
  - 01-REVIEWS.md §C-H3
  - 01-12-PLAN.md task 2
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n/index.ts';
  import {
    createCompetitionFromWizard,
    setActiveCompetition,
  } from '$lib/api/client.ts';

  type ReaderStatus = 'opening' | 'open' | 'error';

  interface Props {
    name: string;
    date: string;
    pendingFile: File | null;
    /** Plan 11 — Eventor event ID from the wizard quickstart. When set,
     * passed through to the from-wizard POST so ImportRunnersView can
     * show the linked-event card after creation. */
    eventorEventId?: number | null;
    /** Surface the result back up to the wizard so it can drive the
     * inline error banner. */
    onerror: (msg: string) => void;
  }

  let { name, date, pendingFile, eventorEventId = null, onerror }: Props = $props();

  let readerStatus: ReaderStatus = $state('opening');
  let submitting = $state(false);

  // Dev-mode 1600ms handshake. The clearTimeout in the cleanup return
  // covers the case where the user clicks Avbryt before the timer fires.
  $effect(() => {
    if (readerStatus !== 'opening') return;
    const handle = setTimeout(() => {
      readerStatus = 'open';
    }, 1600);
    return () => clearTimeout(handle);
  });

  async function fileToBase64(file: File): Promise<string> {
    const buf = await file.arrayBuffer();
    const u8 = new Uint8Array(buf);
    // Chunk to avoid arg-spread blowing the call stack on large files
    // (e.g. a 5 MB XML would be ~5e6 args otherwise).
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < u8.length; i += CHUNK) {
      const slice = u8.subarray(i, i + CHUNK);
      bin += String.fromCharCode.apply(null, Array.from(slice));
    }
    return btoa(bin);
  }

  function mapServerError(status: number, body: { error: string; detail?: string; errors?: unknown }): string {
    const code = body.error;
    if (code === 'parse_failed') {
      return 'Filen kunde inte läsas — förväntar Purple Pen .xml eller IOF XML 3.0.';
    }
    if (code === 'xsd_invalid') {
      const errs = Array.isArray(body.errors) ? body.errors : [];
      const count = errs.length;
      const first = (errs[0] as { message?: string } | undefined)?.message ?? '';
      return `Filen är inte giltig IOF XML 3.0. ${count} fel${first ? `: ${first}` : ''}.`;
    }
    if (code === 'ingest_failed') {
      return `Importen misslyckades: ${body.detail ?? 'okänt fel'}.`;
    }
    if (code === 'entrylist_without_courses') {
      return 'EntryList kräver att en banfil importerats först — ladda CourseData i en separat tävling.';
    }
    if (code === 'bad_filename' || code === 'bad_base64' || code === 'file_too_large') {
      return 'Filen kunde inte hanteras.';
    }
    if (status === 413) return 'Filen är för stor (max 5 MB).';
    return `Något gick fel (HTTP ${status}).`;
  }

  async function start(): Promise<void> {
    if (!pendingFile || readerStatus !== 'open' || submitting) return;
    submitting = true;
    try {
      const content_base64 = await fileToBase64(pendingFile);
      const result = await createCompetitionFromWizard({
        name,
        date,
        xml_file: { name: pendingFile.name, content_base64 },
        // Plan 11 — pass Eventor linkage through to the atomic POST so
        // the row is linked from creation without a separate PATCH.
        ...(eventorEventId !== null ? { eventor_event_id: eventorEventId } : {}),
      });
      if (result.ok) {
        // Set the active competition so reload + bridge reconnect both
        // point at the freshly-created row. Failure here is non-fatal —
        // the readout view will fall back to the URL parameter.
        try {
          await setActiveCompetition(result.data.competition_id);
        } catch {
          /* non-fatal */
        }
        await goto(`/competition/${result.data.competition_id}/readout`);
        return;
      }
      // Codex C-H3: server's atomic transaction rolled back; no
      // competition row exists. Surface the inline error and stay at
      // /competition/_new?wizard=1.
      onerror(mapServerError(result.status, result.data));
    } catch (e) {
      onerror((e as Error).message || 'Nätverksfel');
    } finally {
      submitting = false;
    }
  }
</script>

<div class="step-grid">
  <p class="muted">{t('wiz.step3.desc')}</p>
  <div class="detect-card">
    <div class="detect-light {readerStatus === 'opening' ? 'searching' : readerStatus === 'open' ? 'ok' : 'err'}">
      {#if readerStatus === 'open'}
        <span class="ok-dot"></span>
      {/if}
    </div>
    <div class="detect-text">
      {#if readerStatus === 'opening'}
        <div class="title">{t('wiz.detecting')}</div>
        <div class="muted small">Söker på /dev/ttyUSB*</div>
      {:else if readerStatus === 'open'}
        <div class="title ok">✓ {t('wiz.detected')} · {t('wiz.handshake')}</div>
        <div class="muted small mono">BSM7-USB · /dev/ttyUSB0 · 38400 baud</div>
      {:else}
        <div class="title err">Läsare hittades inte</div>
      {/if}
    </div>
  </div>

  <button
    type="button"
    class="start-btn"
    disabled={readerStatus !== 'open' || submitting || !pendingFile}
    onclick={start}
    data-testid="wiz-start"
  >
    {#if submitting}<span class="spinner" aria-hidden="true"></span>{/if}
    ▶ {t('wiz.start')}
  </button>
</div>

<style>
  .step-grid {
    display: grid;
    gap: 16px;
  }
  .muted {
    margin: 0;
    color: var(--fg-muted);
  }
  .small {
    font-size: 12px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .detect-card {
    padding: 28px;
    background: var(--bg-sunken);
    border-radius: var(--radius-lg);
    display: flex;
    align-items: center;
    gap: 18px;
  }
  .detect-light {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--bg-elev);
    border: 1.5px solid var(--border-strong);
    display: grid;
    place-items: center;
    flex-shrink: 0;
    position: relative;
  }
  .detect-light.searching::after {
    content: '';
    position: absolute;
    inset: -6px;
    border: 2px solid var(--accent);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  .detect-light.ok {
    background: var(--ok-soft);
    border-color: var(--ok);
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--ok) 16%, transparent);
  }
  .detect-light.err {
    background: var(--bg-elev);
    border-color: var(--dnf);
  }
  .ok-dot {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--ok);
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .detect-text .title {
    font-weight: 600;
    font-size: 15px;
  }
  .detect-text .title.ok {
    color: var(--ok);
  }
  .detect-text .title.err {
    color: var(--dnf);
  }
  .start-btn {
    height: 56px;
    min-height: var(--hit);
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--accent-fg);
    border: 1px solid var(--accent);
    font-size: var(--fs-body);
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  .start-btn:hover {
    background: var(--accent-strong);
  }
  .start-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--accent-fg);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
</style>
