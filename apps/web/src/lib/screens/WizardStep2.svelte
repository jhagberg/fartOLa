<!--
  Authored for fartola. Not ported from upstream.

  Wizard step 2 — file drop + import preview.

  Per UI-SPEC §"File import flow" + plan-12 deferred-POST contract:
   - The drop-zone accepts `.xml` files only. Filename re-checked
     client-side BEFORE we touch the file bytes.
   - Once a file is picked, we read it as text (limited to the first
     ~4 KB — enough to land the root element) and run a regex check
     for `<CourseData` or `<EntryList` at the document root. This is
     the cheap "is this even XML I can handle?" gate.
   - The actual XSD validation runs server-side inside the atomic
     /api/competitions/from-wizard POST (step 3). We do NOT POST here.
   - The File object is handed back up to the wizard via `onfile`;
     the wizard owns `state.pendingFile` until step 3 commits.
   - On rejection (non-.xml or root-element regex miss): inline error
     surfaces in the drop-zone; the file is NOT stored.

  Codex C-H3 LOCKED: this step performs ZERO network requests. All
  competition state lives in browser memory until step 3 fires the
  single atomic POST.

  Locked by:
  - 01-UI-SPEC.md §"File import flow"
  - 01-REVIEWS.md §C-H3
  - 01-12-PLAN.md task 2
-->
<script lang="ts">
  import { t } from '#lib/i18n/index.ts';
  import DropZone from '#lib/components/DropZone.svelte';

  interface PreviewMeta {
    filename: string;
    kind: 'CourseData' | 'EntryList';
  }

  interface Props {
    file: File | null;
    preview: PreviewMeta | null;
    error: string | null;
    onfile: (file: File, preview: PreviewMeta) => void;
    onerror: (msg: string) => void;
    onclear: () => void;
  }

  let { file, preview, error, onfile, onerror, onclear }: Props = $props();

  // Sample the first 4 KB — enough to land the root element while
  // staying cheap on browser memory. Reading the whole file here is
  // wasted work; bytes only need to flow when step 3 base64-encodes.
  const HEAD_BYTES = 4096;

  async function inspectFile(f: File): Promise<void> {
    onclear();
    const slice = f.slice(0, HEAD_BYTES);
    let head: string;
    try {
      head = await slice.text();
    } catch (e) {
      onerror((e as Error).message);
      return;
    }
    // Strip BOM / leading whitespace / XML declaration / comments to
    // land on the first real element. Comments must be stripped (not
    // just skipped) because their prose can contain `<TagName` literals
    // that would otherwise win the root-element regex race — the
    // corrupt-CourseData fixture has exactly this property (it
    // documents the missing-Name violation inline).
    const cleaned = head
      .replace(/^﻿/, '')
      .replace(/<\?xml[^?]*\?>/i, '')
      .replace(new RegExp('<!--[\\s\\S]*?(?:-->|$)', 'g'), '')
      .replace(new RegExp('<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>|$)', 'g'), '');
    const root = cleaned.match(/<\s*([A-Za-z_][A-Za-z0-9_-]*)/);
    if (!root) {
      onerror(
        'Filen kunde inte läsas — förväntar Purple Pen .xml eller IOF XML 3.0.'
      );
      return;
    }
    const rootName = root[1] ?? '';
    if (rootName !== 'CourseData' && rootName !== 'EntryList') {
      onerror(
        `Root-elementet är <${rootName}> — förväntar <CourseData> eller <EntryList>.`
      );
      return;
    }
    onfile(f, {
      filename: f.name,
      kind: rootName as 'CourseData' | 'EntryList',
    });
  }

  function handleFile(f: File): void {
    void inspectFile(f);
  }

  function handleReject(filename: string): void {
    onerror(`Endast .xml-filer accepteras (såg: ${filename}).`);
  }
</script>

<div class="step-grid">
  <p class="muted">{t('wiz.step2.desc')}</p>
  <DropZone {file} {error} onfile={handleFile} onreject={handleReject} />
  {#if preview && !error}
    <div class="preview" data-testid="wiz-preview">
      <div class="kind">
        {preview.kind === 'CourseData' ? 'Purple Pen / IOF CourseData' : 'IOF EntryList'}
      </div>
      <div class="mono">{preview.filename}</div>
      <div class="hint">
        Klassantal + kontrollantal verifieras serverside i steg 3.
      </div>
    </div>
  {/if}
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
  .preview {
    background: var(--ok-soft);
    border: 1px solid var(--ok);
    border-radius: var(--radius);
    padding: 14px;
    color: var(--ok);
    display: grid;
    gap: 4px;
  }
  .preview .kind {
    font-weight: 600;
  }
  .preview .mono {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--fg);
  }
  .preview .hint {
    font-size: 12px;
    color: var(--fg-muted);
  }
</style>
