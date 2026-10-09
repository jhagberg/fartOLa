<!--
  Authored for fartola. Not ported from upstream.

  Sidebar SI-bridge status card. UI-SPEC §"Visual Anchors" sketch shows
  this lives at the bottom of the sidebar showing reader state. Three
  status modes:
    - 'online' → green PulseDot + "Ansluten"
    - 'connecting' → amber PulseDot + "Söker läsare…"
    - 'offline' → red PulseDot + "Frånkopplad"

  Props are minimal — the WS client wired from +layout.svelte feeds
  status + the station serial; readout view (plan 13) feeds the rest.
-->
<script lang="ts">
  import PulseDot from '../ui/PulseDot.svelte';
  import Icon from '../ui/Icon.svelte';
  import { t } from '../i18n/index.ts';
  import { reconnectBridge, ApiError } from '../api/client.ts';

  type Status = 'online' | 'offline' | 'connecting';

  interface Props {
    stationName?: string;
    serial?: string;
    devicePath?: string;
    baud?: number;
    status?: Status;
  }

  let {
    stationName = 'BSM7-USB',
    serial = '—',
    devicePath = '/dev/ttyUSB0',
    baud = 38400,
    status = 'offline',
  }: Props = $props();

  const variant = $derived(
    status === 'online' ? 'green' : status === 'connecting' ? 'amber' : 'red'
  );

  const label = $derived(
    status === 'online' ? t('ro.online') : status === 'connecting' ? t('wiz.detecting') : t('ro.offline')
  );

  const labelColor = $derived(
    status === 'online' ? 'var(--ok)' : status === 'connecting' ? 'var(--mp-fg)' : 'var(--dnf)'
  );

  let reconnecting = $state(false);
  let reconnectError: string | null = $state(null);

  async function doReconnect(): Promise<void> {
    reconnecting = true;
    reconnectError = null;
    try {
      await reconnectBridge();
      // Status update arrives via the layout's 2s poll on the next tick;
      // we don't need to refetch here.
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        reconnectError = t('ro.bridgeNotAttached');
      } else {
        reconnectError = (e as Error).message;
      }
    } finally {
      reconnecting = false;
    }
  }
</script>

<div class="station-card">
  <div class="row title">{t('ro.station')}</div>
  <div class="row">
    <PulseDot {variant} label={label} />
    <b class="mono name">{stationName}</b>
  </div>
  <div class="row spread">
    <span class="mono faint">{serial}</span>
    <span class="status-label" style="color: {labelColor}"><Icon name="circle" size={10} fill="currentColor" /> {label}</span>
  </div>
  <div class="row spread small">
    <span class="faint">{devicePath}</span>
    <span class="mono faint">{baud}</span>
  </div>
  {#if status !== 'online'}
    <button
      type="button"
      class="reconnect-btn"
      onclick={doReconnect}
      disabled={reconnecting}
      data-testid="bridge-reconnect"
    >
      {reconnecting ? t('ro.reconnecting') : t('ro.reconnect')}
    </button>
    {#if reconnectError}
      <div class="reconnect-error" role="alert">{reconnectError}</div>
    {/if}
  {/if}
</div>

<style>
  .station-card {
    margin: var(--space-xs) 0;
    padding: 10px var(--space-sm);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: var(--fs-caption);
    display: grid;
    gap: var(--space-2xs);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
  }
  .row.spread {
    justify-content: space-between;
  }
  .row.small {
    font-size: 11px;
  }
  .row.title {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
    font-weight: 600;
  }
  .name {
    font-size: 12px;
  }
  .status-label {
    font-size: 11px;
  }
  .faint {
    color: var(--fg-faint);
  }
  .mono {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum' 1, 'zero' 1;
  }
  .reconnect-btn {
    margin-top: var(--space-2xs);
    min-height: var(--hit);
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: var(--fs-label);
    cursor: pointer;
    width: 100%;
  }
  .reconnect-btn:hover:not(:disabled) {
    background: var(--bg-hover, var(--bg-elev));
  }
  .reconnect-btn:focus-visible {
    outline: 2px solid var(--fg);
    outline-offset: 2px;
  }
  .reconnect-btn:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  .reconnect-error {
    font-size: 11px;
    color: var(--dnf);
    margin-top: var(--space-2xs);
    word-break: break-word;
  }
</style>
