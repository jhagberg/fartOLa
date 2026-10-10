<!--
  Authored for fartola. Not ported from upstream.

  Appearance controls (UI-SPEC §"Tweaks panel"), shown as the last section of
  the settings page: language, density, accent, bright-sun contrast, type pair.

  Every change calls persistTweaks() so a reload restores the choice;
  applyTweaksToRoot() runs synchronously so the page flips immediately
  without waiting on the layout's $effect re-run.
-->
<script lang="ts">
  import Field from '../ui/Field.svelte';
  import Select from '../ui/Select.svelte';
  import {
    tweaks,
    persistTweaks,
    applyTweaksToRoot,
    type TweaksDensity,
    type TweaksAccent,
    type TweaksFontPair,
  } from '../stores/tweaks.svelte.ts';
  import { setLocale, t } from '../i18n/index.ts';

  function flush(): void {
    if (typeof document !== 'undefined') applyTweaksToRoot(document.documentElement);
    persistTweaks();
  }

  function onLocaleChange(e: Event): void {
    const v = (e.currentTarget as HTMLInputElement).value;
    if (v === 'sv' || v === 'en') {
      setLocale(v);
      flush();
    }
  }

  function onDensityChange(d: TweaksDensity): void {
    tweaks.density = d;
    flush();
  }

  function onAccentChange(a: TweaksAccent): void {
    tweaks.accent = a;
    flush();
  }

  function onContrastChange(e: Event): void {
    tweaks.contrast_high = (e.currentTarget as HTMLInputElement).checked;
    flush();
  }

  function onFontChange(e: Event): void {
    const v = (e.currentTarget as HTMLSelectElement).value as TweaksFontPair;
    tweaks.font_pair = v;
    flush();
  }

  const DENSITIES: TweaksDensity[] = ['low', 'med', 'high'];
  const ACCENTS: TweaksAccent[] = ['forest', 'blue', 'magenta', 'charcoal'];
  const FONT_PAIRS: TweaksFontPair[] = ['plex', 'geist', 'source', 'atkinson'];
</script>

<div class="grid">
  <!-- Locale -->
  <Field label={t('tw.locale')}>
    <div class="row">
      <label class="radio">
        <input
          type="radio"
          name="locale"
          value="sv"
          checked={tweaks.locale === 'sv'}
          onchange={onLocaleChange}
        />
        <span>Svenska</span>
      </label>
      <label class="radio">
        <input
          type="radio"
          name="locale"
          value="en"
          checked={tweaks.locale === 'en'}
          onchange={onLocaleChange}
        />
        <span>English</span>
      </label>
    </div>
  </Field>

  <!-- Density -->
  <Field label={t('tw.density')}>
    <div class="row" role="radiogroup">
      {#each DENSITIES as d (d)}
        <button
          type="button"
          class="seg"
          class:active={tweaks.density === d}
          onclick={() => onDensityChange(d)}
          aria-pressed={tweaks.density === d}
        >
          {t(`tw.density.${d}`)}
        </button>
      {/each}
    </div>
  </Field>

  <!-- Accent -->
  <Field label={t('tw.accent')}>
    <div class="swatches" role="radiogroup">
      {#each ACCENTS as a (a)}
        <button
          type="button"
          class="swatch sw-{a}"
          class:active={tweaks.accent === a}
          onclick={() => onAccentChange(a)}
          aria-label={t(`tw.accent.${a}`)}
          aria-pressed={tweaks.accent === a}
          title={t(`tw.accent.${a}`)}
        ></button>
      {/each}
    </div>
  </Field>

  <!-- Contrast -->
  <Field label={t('tw.contrast')}>
    <label class="toggle">
      <input
        type="checkbox"
        checked={tweaks.contrast_high}
        onchange={onContrastChange}
      />
      <span>{tweaks.contrast_high ? t('tw.on') : t('tw.off')}</span>
    </label>
  </Field>

  <!-- Font pair -->
  <Field label={t('tw.font')}>
    <Select value={tweaks.font_pair} onchange={onFontChange}>
      {#each FONT_PAIRS as fp (fp)}
        <option value={fp}>{fp}</option>
      {/each}
    </Select>
  </Field>
</div>

<style>
  .grid {
    display: grid;
    gap: var(--space-md);
  }
  .row {
    display: flex;
    gap: var(--space-xs);
    flex-wrap: wrap;
  }
  .radio {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-label);
    min-height: var(--hit);
    padding: 0 var(--space-sm);
    cursor: pointer;
  }
  .radio input {
    accent-color: var(--accent);
  }
  .seg {
    flex: 1;
    min-height: var(--hit);
    padding: 0 var(--space-sm);
    border-radius: var(--radius);
    border: 1px solid var(--border-strong);
    background: var(--bg-elev);
    color: var(--fg);
    font-size: var(--fs-label);
    font-weight: 500;
  }
  .seg.active {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-strong);
  }
  .swatches {
    display: flex;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }
  .swatch {
    width: var(--hit);
    height: var(--hit);
    border-radius: var(--radius);
    border: 2px solid var(--border-strong);
    cursor: pointer;
  }
  .swatch.active {
    outline: 2px solid var(--fg);
    outline-offset: 2px;
  }
  .sw-forest {
    background: oklch(0.5 0.08 145);
  }
  .sw-blue {
    background: oklch(0.5 0.1 245);
  }
  .sw-magenta {
    background: oklch(0.5 0.13 330);
  }
  .sw-charcoal {
    background: oklch(0.3 0.01 240);
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    min-height: var(--hit);
    font-size: var(--fs-label);
    cursor: pointer;
  }
  .toggle input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
</style>
