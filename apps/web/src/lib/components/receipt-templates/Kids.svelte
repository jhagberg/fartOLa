<!--
  Authored for fartola. Not ported from upstream.

  Kids receipt template — Skogis collectible critter. Inline SVG figure
  generated procedurally by skogis.ts from (cardNumber, name, club,
  classId); race outcome drives the accessory + stats only.

  Port of the `if (tpl === 'kids')` branch + SkogisFigure component in
  01-SKETCHES/.../screens-readout.jsx (lines 921-1017 + 523-711). The
  generator lives in $lib/skogis/skogis.ts so plan 15 (print) can reuse
  it from the ESC/POS pipeline without dragging in Svelte.

  Mono-printable: every fill / stroke is `#1a1a1a` (ink) or `#fdfcf7`
  (paper) or `#fff` (eye highlight). No accent / status colours leak.

  Locked by:
  - 01-13-PLAN.md task 1
  - 01-UI-SPEC.md §"Receipt templates" — Kids is monochrome procedural
-->
<script lang="ts">
  import { t } from '$lib/i18n/index.ts';
  import {
    skogisFromInput,
    skogisGeometry,
    skogisDisplayName,
    SKOGIS_INK,
    SKOGIS_PAPER,
  } from '$lib/skogis/skogis.ts';
  import type { ReceiptTemplateProps } from './types.ts';

  let { read }: ReceiptTemplateProps = $props();

  const ctrlCount = $derived(read.punches.filter((p) => !p.finish).length);
  const totalLegs = $derived(Math.max(1, read.punches.length));
  const bestLegs = $derived(read.punches.filter((p) => p.legRank === 1).length);

  const skogis = $derived(
    skogisFromInput({
      cardNumber: read.cardNumber,
      name: read.name,
      club: read.club,
      classId: read.classId,
      status: read.status,
      place: read.place,
      controlCount: ctrlCount,
      bestLegs,
      totalLegs,
      startersInClass: read.progress.startersInClass,
    })
  );

  const geom = $derived(skogisGeometry(skogis));
  const displayName = $derived(skogisDisplayName(skogis));

  const subtitle = $derived(
    read.place === 1
      ? '★ Klassens snabbaste ★'
      : read.place === 2
        ? 'Silvermedalj'
        : read.place === 3
          ? 'Bronsmedalj'
          : read.status === 'OK'
            ? 'Mål i skogen!'
            : read.status === 'MP'
              ? 'Tappade bort en kontroll'
              : read.status === 'DNF'
                ? 'Bröt loppet'
                : 'I full fart!'
  );

  // Pair-up the punches into 2-column rows for the kids splits layout.
  const punchPairs = $derived.by(() => {
    const rows: Array<typeof read.punches> = [];
    for (let i = 0; i < read.punches.length; i += 2) {
      rows.push(read.punches.slice(i, i + 2));
    }
    return rows;
  });
</script>

<div class="rcpt-title kids-title">{t('rcpt.kids.title')}</div>

<div class="critter-card">
  <!-- Inline SVG so the receipt is fully self-contained (plan 15 ESC/POS
       pass can rasterise it directly). -->
  <svg
    width="170"
    height={(170 * geom.height) / geom.width}
    viewBox="0 0 {geom.width} {geom.height}"
    aria-hidden="true"
  >
    <defs>
      <pattern
        id="skogisCrownPat"
        patternUnits="userSpaceOnUse"
        width="4"
        height="4"
        patternTransform="rotate(45)"
      >
        <rect width="4" height="4" fill={SKOGIS_PAPER} />
        <line x1="0" y1="0" x2="0" y2="4" stroke={SKOGIS_INK} stroke-width="1.2" />
      </pattern>
    </defs>

    <!-- feet -->
    <ellipse cx={geom.cx - 22} cy={geom.cy + geom.ry - 4} rx="12" ry="6" fill={SKOGIS_INK} />
    <ellipse cx={geom.cx + 22} cy={geom.cy + geom.ry - 4} rx="12" ry="6" fill={SKOGIS_INK} />

    <!-- ears / headpiece -->
    {#if skogis.ears === 'tuft'}
      <polygon
        points="{geom.cx - 22},{geom.cy - geom.ry + 6} {geom.cx - 8},{geom.cy - geom.ry - 18} {geom.cx - 4},{geom.cy - geom.ry + 2}"
        fill={SKOGIS_INK}
      />
      <polygon
        points="{geom.cx + 22},{geom.cy - geom.ry + 6} {geom.cx + 8},{geom.cy - geom.ry - 18} {geom.cx + 4},{geom.cy - geom.ry + 2}"
        fill={SKOGIS_INK}
      />
    {:else if skogis.ears === 'bunny'}
      <ellipse
        cx={geom.cx - 16}
        cy={geom.cy - geom.ry - 12}
        rx="7"
        ry="20"
        fill={SKOGIS_PAPER}
        stroke={SKOGIS_INK}
        stroke-width="2"
      />
      <ellipse
        cx={geom.cx + 16}
        cy={geom.cy - geom.ry - 12}
        rx="7"
        ry="20"
        fill={SKOGIS_PAPER}
        stroke={SKOGIS_INK}
        stroke-width="2"
      />
      <ellipse
        cx={geom.cx - 16}
        cy={geom.cy - geom.ry - 8}
        rx="3"
        ry="12"
        fill={SKOGIS_INK}
        opacity="0.2"
      />
      <ellipse
        cx={geom.cx + 16}
        cy={geom.cy - geom.ry - 8}
        rx="3"
        ry="12"
        fill={SKOGIS_INK}
        opacity="0.2"
      />
    {:else if skogis.ears === 'antennae'}
      <g stroke={SKOGIS_INK} stroke-width="2" stroke-linecap="round">
        <line
          x1={geom.cx - 10}
          y1={geom.cy - geom.ry + 2}
          x2={geom.cx - 18}
          y2={geom.cy - geom.ry - 22}
        />
        <line
          x1={geom.cx + 10}
          y1={geom.cy - geom.ry + 2}
          x2={geom.cx + 18}
          y2={geom.cy - geom.ry - 22}
        />
        <circle cx={geom.cx - 18} cy={geom.cy - geom.ry - 22} r="4" fill={SKOGIS_INK} stroke="none" />
        <circle cx={geom.cx + 18} cy={geom.cy - geom.ry - 22} r="4" fill={SKOGIS_INK} stroke="none" />
      </g>
    {:else if skogis.ears === 'leaf'}
      <g>
        <ellipse
          cx={geom.cx}
          cy={geom.cy - geom.ry - 8}
          rx="10"
          ry="18"
          fill={SKOGIS_PAPER}
          stroke={SKOGIS_INK}
          stroke-width="2"
          transform="rotate(-18 {geom.cx} {geom.cy - geom.ry - 8})"
        />
        <line
          x1={geom.cx}
          y1={geom.cy - geom.ry - 22}
          x2={geom.cx - 2}
          y2={geom.cy - geom.ry + 2}
          stroke={SKOGIS_INK}
          stroke-width="2"
        />
      </g>
    {:else if skogis.ears === 'horns'}
      <g fill={SKOGIS_INK}>
        <polygon
          points="{geom.cx - 16},{geom.cy - geom.ry + 2} {geom.cx - 12},{geom.cy - geom.ry - 16} {geom.cx - 6},{geom.cy - geom.ry + 0}"
        />
        <polygon
          points="{geom.cx + 16},{geom.cy - geom.ry + 2} {geom.cx + 12},{geom.cy - geom.ry - 16} {geom.cx + 6},{geom.cy - geom.ry + 0}"
        />
      </g>
    {/if}

    <!-- arms -->
    {#if skogis.hasArms}
      <ellipse
        cx={geom.cx - geom.rx + 4}
        cy={geom.cy + 8}
        rx="10"
        ry="6"
        fill={SKOGIS_PAPER}
        stroke={SKOGIS_INK}
        stroke-width="2"
        transform="rotate(-18 {geom.cx - geom.rx + 4} {geom.cy + 8})"
      />
      <ellipse
        cx={geom.cx + geom.rx - 4}
        cy={geom.cy + 8}
        rx="10"
        ry="6"
        fill={SKOGIS_PAPER}
        stroke={SKOGIS_INK}
        stroke-width="2"
        transform="rotate(18 {geom.cx + geom.rx - 4} {geom.cy + 8})"
      />
    {/if}

    <!-- body -->
    <ellipse
      cx={geom.cx}
      cy={geom.cy}
      rx={geom.rx}
      ry={geom.ry}
      fill={SKOGIS_PAPER}
      stroke={SKOGIS_INK}
      stroke-width="2.5"
    />

    <!-- pattern -->
    {#if skogis.pattern === 'spots'}
      <g fill={SKOGIS_INK} opacity="0.55">
        <circle cx={geom.cx - 22} cy={geom.cy + 10} r="6" />
        <circle cx={geom.cx + 18} cy={geom.cy + 18} r="5" />
        <circle cx={geom.cx + 8} cy={geom.cy - 18} r="4" />
        <circle cx={geom.cx - 10} cy={geom.cy + 24} r="4" />
      </g>
    {:else if skogis.pattern === 'stripes'}
      <g stroke={SKOGIS_INK} stroke-width="3" fill="none" opacity="0.5">
        <path
          d="M{geom.cx - geom.rx + 6} {geom.cy - 6} Q{geom.cx} {geom.cy - 2} {geom.cx + geom.rx - 6} {geom.cy - 6}"
        />
        <path
          d="M{geom.cx - geom.rx + 4} {geom.cy + 10} Q{geom.cx} {geom.cy + 14} {geom.cx + geom.rx - 4} {geom.cy + 10}"
        />
        <path
          d="M{geom.cx - geom.rx + 10} {geom.cy + 26} Q{geom.cx} {geom.cy + 30} {geom.cx + geom.rx - 10} {geom.cy + 26}"
        />
      </g>
    {:else if skogis.pattern === 'belly'}
      <ellipse
        cx={geom.cx}
        cy={geom.cy + 14}
        rx={geom.rx - 18}
        ry={geom.ry - 24}
        fill={SKOGIS_INK}
        opacity="0.1"
      />
    {/if}

    <!-- blush -->
    {#if skogis.blush}
      <g fill={SKOGIS_INK} opacity="0.18">
        <circle cx={geom.cx - geom.eyeDX - 6} cy={geom.eyeY + 12} r="5" />
        <circle cx={geom.cx + geom.eyeDX + 6} cy={geom.eyeY + 12} r="5" />
      </g>
    {/if}

    <!-- eyes -->
    {#if skogis.eyeStyle === 'round'}
      <circle
        cx={geom.cx - geom.eyeDX}
        cy={geom.eyeY}
        r="7"
        fill="#fff"
        stroke={SKOGIS_INK}
        stroke-width="1.5"
      />
      <circle
        cx={geom.cx + geom.eyeDX}
        cy={geom.eyeY}
        r="7"
        fill="#fff"
        stroke={SKOGIS_INK}
        stroke-width="1.5"
      />
      <circle cx={geom.cx - geom.eyeDX + 1.5} cy={geom.eyeY + 1} r="3.2" fill={SKOGIS_INK} />
      <circle cx={geom.cx + geom.eyeDX + 1.5} cy={geom.eyeY + 1} r="3.2" fill={SKOGIS_INK} />
      <circle cx={geom.cx - geom.eyeDX + 2.5} cy={geom.eyeY - 0.5} r="1" fill="#fff" />
      <circle cx={geom.cx + geom.eyeDX + 2.5} cy={geom.eyeY - 0.5} r="1" fill="#fff" />
    {:else if skogis.eyeStyle === 'oval'}
      <ellipse cx={geom.cx - geom.eyeDX} cy={geom.eyeY} rx="5" ry="8" fill={SKOGIS_INK} />
      <ellipse cx={geom.cx + geom.eyeDX} cy={geom.eyeY} rx="5" ry="8" fill={SKOGIS_INK} />
      <circle cx={geom.cx - geom.eyeDX + 1.5} cy={geom.eyeY - 2} r="1.6" fill="#fff" />
      <circle cx={geom.cx + geom.eyeDX + 1.5} cy={geom.eyeY - 2} r="1.6" fill="#fff" />
    {:else if skogis.eyeStyle === 'sleepy'}
      <g stroke={SKOGIS_INK} stroke-width="2.5" fill="none" stroke-linecap="round">
        <path
          d="M{geom.cx - geom.eyeDX - 6} {geom.eyeY} Q{geom.cx - geom.eyeDX} {geom.eyeY + 5} {geom.cx - geom.eyeDX + 6} {geom.eyeY}"
        />
        <path
          d="M{geom.cx + geom.eyeDX - 6} {geom.eyeY} Q{geom.cx + geom.eyeDX} {geom.eyeY + 5} {geom.cx + geom.eyeDX + 6} {geom.eyeY}"
        />
      </g>
    {:else if skogis.eyeStyle === 'spark'}
      <g fill={SKOGIS_INK}>
        <polygon
          points="{geom.cx - geom.eyeDX},{geom.eyeY - 7} {geom.cx - geom.eyeDX + 2},{geom.eyeY - 1} {geom.cx - geom.eyeDX + 7},{geom.eyeY} {geom.cx - geom.eyeDX + 2},{geom.eyeY + 1} {geom.cx - geom.eyeDX},{geom.eyeY + 7} {geom.cx - geom.eyeDX - 2},{geom.eyeY + 1} {geom.cx - geom.eyeDX - 7},{geom.eyeY} {geom.cx - geom.eyeDX - 2},{geom.eyeY - 1}"
        />
        <polygon
          points="{geom.cx + geom.eyeDX},{geom.eyeY - 7} {geom.cx + geom.eyeDX + 2},{geom.eyeY - 1} {geom.cx + geom.eyeDX + 7},{geom.eyeY} {geom.cx + geom.eyeDX + 2},{geom.eyeY + 1} {geom.cx + geom.eyeDX},{geom.eyeY + 7} {geom.cx + geom.eyeDX - 2},{geom.eyeY + 1} {geom.cx + geom.eyeDX - 7},{geom.eyeY} {geom.cx + geom.eyeDX - 2},{geom.eyeY - 1}"
        />
      </g>
    {/if}

    <!-- mouth -->
    {#if skogis.mouth === 'smile'}
      <path
        d="M{geom.cx - 10} {geom.eyeY + 18} Q{geom.cx} {geom.eyeY + 26} {geom.cx + 10} {geom.eyeY + 18}"
        stroke={SKOGIS_INK}
        stroke-width="2"
        fill="none"
        stroke-linecap="round"
      />
    {:else if skogis.mouth === 'o'}
      <circle cx={geom.cx} cy={geom.eyeY + 22} r="4" fill={SKOGIS_INK} />
    {:else if skogis.mouth === 'line'}
      <line
        x1={geom.cx - 6}
        y1={geom.eyeY + 22}
        x2={geom.cx + 6}
        y2={geom.eyeY + 22}
        stroke={SKOGIS_INK}
        stroke-width="2"
        stroke-linecap="round"
      />
    {:else if skogis.mouth === 'w'}
      <path
        d="M{geom.cx - 9} {geom.eyeY + 20} Q{geom.cx - 4.5} {geom.eyeY + 26} {geom.cx} {geom.eyeY + 22} Q{geom.cx + 4.5} {geom.eyeY + 26} {geom.cx + 9} {geom.eyeY + 20}"
        stroke={SKOGIS_INK}
        stroke-width="2"
        fill="none"
        stroke-linecap="round"
      />
    {:else if skogis.mouth === 'tongue'}
      <path
        d="M{geom.cx - 10} {geom.eyeY + 18} Q{geom.cx} {geom.eyeY + 28} {geom.cx + 10} {geom.eyeY + 18}"
        stroke={SKOGIS_INK}
        stroke-width="2"
        fill="none"
        stroke-linecap="round"
      />
      <ellipse cx={geom.cx + 2} cy={geom.eyeY + 24} rx="3" ry="4" fill={SKOGIS_INK} opacity="0.3" />
    {/if}

    <!-- accessory: race outcome -->
    {#if skogis.accessory === 'crown'}
      <polygon
        points="{geom.cx - 22},{geom.cy - geom.ry - 2} {geom.cx - 22},{geom.cy - geom.ry - 18} {geom.cx - 12},{geom.cy - geom.ry - 8} {geom.cx},{geom.cy - geom.ry - 22} {geom.cx + 12},{geom.cy - geom.ry - 8} {geom.cx + 22},{geom.cy - geom.ry - 18} {geom.cx + 22},{geom.cy - geom.ry - 2}"
        fill="url(#skogisCrownPat)"
        stroke={SKOGIS_INK}
        stroke-width="1.5"
      />
      <circle cx={geom.cx - 22} cy={geom.cy - geom.ry - 18} r="2.5" fill={SKOGIS_INK} />
      <circle cx={geom.cx} cy={geom.cy - geom.ry - 22} r="2.5" fill={SKOGIS_INK} />
      <circle cx={geom.cx + 22} cy={geom.cy - geom.ry - 18} r="2.5" fill={SKOGIS_INK} />
    {:else if skogis.accessory === 'silver'}
      <polygon
        points="{geom.cx},{geom.cy - geom.ry - 22} {geom.cx + 4},{geom.cy - geom.ry - 12} {geom.cx + 14},{geom.cy - geom.ry - 10} {geom.cx + 6},{geom.cy - geom.ry - 3} {geom.cx + 8},{geom.cy - geom.ry + 8} {geom.cx},{geom.cy - geom.ry + 2} {geom.cx - 8},{geom.cy - geom.ry + 8} {geom.cx - 6},{geom.cy - geom.ry - 3} {geom.cx - 14},{geom.cy - geom.ry - 10} {geom.cx - 4},{geom.cy - geom.ry - 12}"
        fill={SKOGIS_PAPER}
        stroke={SKOGIS_INK}
        stroke-width="1.2"
      />
    {:else if skogis.accessory === 'bronze'}
      <circle
        cx={geom.cx}
        cy={geom.cy - geom.ry - 12}
        r="11"
        fill={SKOGIS_INK}
        stroke={SKOGIS_INK}
        stroke-width="1.5"
      />
      <text
        x={geom.cx}
        y={geom.cy - geom.ry - 8}
        text-anchor="middle"
        font-size="11"
        font-weight="700"
        fill={SKOGIS_PAPER}
        font-family="sans-serif">3</text
      >
    {:else if skogis.accessory === 'bandage'}
      <rect
        x={geom.cx - 16}
        y={geom.cy - 2}
        width="32"
        height="10"
        rx="2"
        fill={SKOGIS_PAPER}
        stroke={SKOGIS_INK}
        stroke-width="1.2"
        transform="rotate(-12 {geom.cx} {geom.cy + 3})"
      />
      <line
        x1={geom.cx - 3}
        y1={geom.cy}
        x2={geom.cx + 3}
        y2={geom.cy + 8}
        stroke={SKOGIS_INK}
        stroke-width="1"
      />
      <line
        x1={geom.cx + 3}
        y1={geom.cy}
        x2={geom.cx - 3}
        y2={geom.cy + 8}
        stroke={SKOGIS_INK}
        stroke-width="1"
      />
    {:else if skogis.accessory === 'flag'}
      <line
        x1={geom.cx + geom.rx + 6}
        y1={geom.cy + 16}
        x2={geom.cx + geom.rx + 6}
        y2={geom.cy - 18}
        stroke={SKOGIS_INK}
        stroke-width="2"
      />
      <polygon
        points="{geom.cx + geom.rx + 6},{geom.cy - 18} {geom.cx + geom.rx + 22},{geom.cy - 12} {geom.cx + geom.rx + 6},{geom.cy - 6}"
        fill={SKOGIS_PAPER}
        stroke={SKOGIS_INK}
        stroke-width="1.5"
      />
      <polygon
        points="{geom.cx + geom.rx + 6},{geom.cy - 12} {geom.cx + geom.rx + 14},{geom.cy - 9} {geom.cx + geom.rx + 6},{geom.cy - 6}"
        fill={SKOGIS_INK}
      />
    {/if}
  </svg>

  <div class="critter-name" data-testid="skogis-name">{displayName}</div>
  <div class="critter-species">
    {skogis.species} · {t('rcpt.kids.level')} {skogis.level}
  </div>
</div>

<div class="stats-grid">
  <div class="stat-bar">
    <span class="lbl">{t('rcpt.kids.stat.fart')}</span>
    <span class="bars">
      {#each [1, 2, 3, 4, 5] as i (i)}
        <span class="bar" class:on={i <= skogis.stats.fart}></span>
      {/each}
    </span>
  </div>
  <div class="stat-bar">
    <span class="lbl">{t('rcpt.kids.stat.stig')}</span>
    <span class="bars">
      {#each [1, 2, 3, 4, 5] as i (i)}
        <span class="bar" class:on={i <= skogis.stats.stig}></span>
      {/each}
    </span>
  </div>
  <div class="stat-bar">
    <span class="lbl">{t('rcpt.kids.stat.kart')}</span>
    <span class="bars">
      {#each [1, 2, 3, 4, 5] as i (i)}
        <span class="bar" class:on={i <= skogis.stats.kart}></span>
      {/each}
    </span>
  </div>
  <div class="stat-bar">
    <span class="lbl">{t('rcpt.kids.stat.tur')}</span>
    <span class="bars">
      {#each [1, 2, 3, 4, 5] as i (i)}
        <span class="bar" class:on={i <= skogis.stats.tur}></span>
      {/each}
    </span>
  </div>
</div>

<div class="rcpt-sep"></div>

<div class="rcpt-row strong"><span>{read.name}</span><span>{read.cls}</span></div>
<div class="rcpt-row sub">
  <span>{read.club ?? ''}</span><span>{t('rcpt.kids.born')} {read.competitionDate}</span>
</div>

<div class="kids-hero">
  <div class="kids-subtitle">{subtitle}</div>
  <div class="kids-time">{read.elapsed}</div>
  <div class="kids-meta">
    {read.statusLabel} · {ctrlCount}
    {t('rcpt.kids.controls')}{read.place ? ` · ${t('rcpt.place').toLowerCase()} ${read.place}` : ''}
  </div>
</div>

<div class="rcpt-sep-dot"></div>

<table class="kids-splits">
  <tbody>
    {#each punchPairs as pair, i (i)}
      <tr>
        <td>{i * 2 + 1}. {pair[0].finish ? 'M' : pair[0].code}</td>
        <td class="t">{pair[0].split}</td>
        <td>{pair[1] ? `${i * 2 + 2}. ${pair[1].finish ? 'M' : pair[1].code}` : ''}</td>
        <td class="t">{pair[1] ? pair[1].split : ''}</td>
      </tr>
    {/each}
  </tbody>
</table>

<div class="rcpt-foot kids-foot">{t('rcpt.kids.foot')}</div>

<style>
  .kids-title {
    letter-spacing: 0.18em;
  }
  .critter-card {
    background: #fdfcf7;
    border: 1.5px dashed #1a1a1a;
    border-radius: 10px;
    padding: 8px 6px 4px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .critter-name {
    margin-top: 2px;
    font-weight: 800;
    font-size: 18px;
    letter-spacing: -0.01em;
    color: #1a1a1a;
  }
  .critter-species {
    font-size: 10px;
    font-family: var(--font-mono);
    color: #1a1a1a;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 12px;
    margin: 10px 2px 2px;
  }
  .stat-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10.5px;
    font-family: var(--font-mono);
  }
  .stat-bar .lbl {
    width: 32px;
    font-weight: 700;
    color: #1a1a1a;
  }
  .stat-bar .bars {
    display: inline-flex;
    gap: 2px;
  }
  .stat-bar .bar {
    width: 8px;
    height: 10px;
    border-radius: 1px;
    border: 1px solid #999;
    background: transparent;
  }
  .stat-bar .bar.on {
    background: #1a1a1a;
    border-color: #1a1a1a;
  }
  .strong {
    font-weight: 700;
  }
  .sub {
    font-size: 10.5px;
    color: #555;
  }
  .kids-hero {
    text-align: center;
    padding: 8px 0 2px;
  }
  .kids-subtitle {
    font-size: 11px;
    color: #555;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .kids-time {
    font-size: 30px;
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.1;
    margin-top: 2px;
  }
  .kids-meta {
    font-size: 10.5px;
    font-family: var(--font-mono);
    color: #1a1a1a;
    margin-top: 2px;
  }
  .kids-splits {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5px;
  }
  .kids-splits td {
    padding: 1px 4px 1px 0;
  }
  .kids-splits td.t {
    font-family: var(--font-mono);
    text-align: right;
    padding-right: 6px;
    width: 36px;
  }
  .kids-splits td:nth-child(1) {
    width: 38px;
    font-family: var(--font-mono);
  }
  .kids-splits td:nth-child(3) {
    width: 38px;
    font-family: var(--font-mono);
    border-left: 1px dotted #bbb;
    padding-left: 6px;
  }
  .kids-foot {
    margin-top: 6px;
  }
</style>
