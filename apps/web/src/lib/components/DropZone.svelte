<!--
  Authored for fartola. Not ported from upstream.

  File drag-and-drop + click-to-pick primitive. The wizard step 2 owns
  the only caller today; future plans (re-import into an existing
  competition, results-CSV export) can compose the same primitive.

  Behavior contract (UI-SPEC §"File import flow"):
   - empty state: dashed border, accent on hover
   - has-file state: solid green border + ok-soft background
   - error state: solid red border + dnf-soft background + inline message
   - .xml extension filter is client-side: the file picker `accept=".xml"`
     attribute is advisory only — operators on Linux can pick any file —
     so we re-check the extension after the browser hands us the File and
     reject non-`.xml` BEFORE any upload happens.

  The primitive does NOT POST anything itself. It hands the File up via
  the `onfile` callback; the wizard owns the deferred-POST contract
  (C-H3 — file bytes stay in memory until step 3's atomic POST).

  Locked by:
  - 01-UI-SPEC.md §"File import flow"
  - 01-SKETCHES/.../screens-home.jsx `.drop-zone`
  - 01-12-PLAN.md task 1
-->
<script lang="ts">
  import { t } from '#lib/i18n/index.ts';
  import Icon from '#lib/ui/Icon.svelte';

  interface Props {
    /** Currently selected file (display-only); the parent owns state. */
    file?: File | null;
    /** Inline error message rendered in the error state. */
    error?: string | null;
    /** Called when a valid `.xml` file is picked / dropped. */
    onfile?: (file: File) => void;
    /** Called when the picker rejects (non-`.xml` filename). */
    onreject?: (filename: string) => void;
  }

  let { file = null, error = null, onfile, onreject }: Props = $props();

  let hover = $state(false);
  let inputRef: HTMLInputElement | null = $state(null);

  function isXml(f: File): boolean {
    return /\.xml$/i.test(f.name);
  }

  function handleFile(f: File): void {
    if (!isXml(f)) {
      onreject?.(f.name);
      return;
    }
    onfile?.(f);
  }

  function onPickClick(): void {
    inputRef?.click();
  }

  function onInputChange(e: Event): void {
    const target = e.currentTarget as HTMLInputElement;
    const f = target.files?.[0];
    if (f) handleFile(f);
    // Reset so picking the same filename twice still fires `change`.
    target.value = '';
  }

  function onDragOver(e: DragEvent): void {
    e.preventDefault();
    hover = true;
  }

  function onDragLeave(): void {
    hover = false;
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault();
    hover = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPickClick();
    }
  }

  const klass = $derived(
    'drop-zone' +
      (file ? ' has-file' : '') +
      (error ? ' has-error' : '') +
      (hover ? ' is-hover' : '')
  );
</script>

<div
  class={klass}
  role="button"
  tabindex="0"
  onclick={onPickClick}
  onkeydown={onKey}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
  data-testid="drop-zone"
>
  <input
    bind:this={inputRef}
    type="file"
    accept=".xml,application/xml,text/xml"
    onchange={onInputChange}
    class="hidden-input"
    data-testid="drop-zone-input"
  />
  {#if error}
    <div class="icon">!</div>
    <div class="title">{error}</div>
    <div class="sub">{t('wiz.drop.formats')}</div>
  {:else if file}
    <div class="icon ok"><Icon name="check" size={28} /></div>
    <div class="title">{t('wiz.imported')}: {file.name}</div>
    <div class="sub">Klicka för att byta fil</div>
  {:else}
    <div class="icon"><Icon name="download" size={28} /> XML</div>
    <div class="title">{t('wiz.drop')}</div>
    <div class="sub">{t('wiz.drop.formats')}</div>
  {/if}
</div>

<style>
  .drop-zone {
    border: 2px dashed var(--border-strong);
    border-radius: var(--radius-lg);
    padding: 36px;
    text-align: center;
    background: var(--bg-sunken);
    cursor: pointer;
    transition:
      border 0.12s,
      background 0.12s;
    min-height: var(--hit);
  }
  .drop-zone:hover,
  .drop-zone.is-hover {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .drop-zone.has-file {
    border-style: solid;
    border-color: var(--ok);
    background: var(--ok-soft);
    color: var(--ok);
  }
  .drop-zone.has-error {
    border-style: solid;
    border-color: var(--dnf);
    background: var(--bg-elev);
    color: var(--dnf);
  }
  .drop-zone .icon {
    font-size: 32px;
    margin-bottom: 8px;
    font-family: var(--font-mono);
  }
  .drop-zone .icon.ok {
    color: var(--ok);
  }
  .drop-zone .title {
    font-size: 15px;
    font-weight: 600;
    color: var(--fg);
  }
  .drop-zone.has-file .title,
  .drop-zone.has-error .title {
    color: inherit;
  }
  .drop-zone .sub {
    font-size: 12px;
    color: var(--fg-muted);
    margin-top: 4px;
  }
  .hidden-input {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
  }
</style>
