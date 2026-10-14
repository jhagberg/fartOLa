<!--
  Authored for fartola. Not ported from upstream.

  ReadoutView — primary operator surface. Grid (1fr / 380px → 340px at
  ≤1280px). Left column: LatestReadCard, then auto-print + ReceiptMirror.
  Right column: radio panel + HistoryList. Stacked below 958 px: card,
  rail, extras (the DOM order, so Tab follows it).

  Data flow:
   - On mount: GET /api/competitions/:id (competition + classes) +
     GET /api/competitions/:id/readout (history + pendingUnknownCards) +
     GET /api/competitions/:id/competitors. Active competition is set
     server-side; the readout view does not toggle it.
   - WS subscribe to readoutChannel(competitionId). The bridge URL
     defaults to ws://localhost:3000/ws but we read the runtime origin
     so the SPA also works behind a reverse proxy.
   - Envelope handlers:
       card_read       → prepend to history (cap 12), set currentRead,
                         flashIn for 1.6s. If unmatched AND no walkup
                         overlay is currently open, after 600ms goto
                         ?walkup=<n> on the SAME readout URL (C-M3
                         LOCKED — plan 14 overlays here).
       manual_dnf      → refetch /readout so StatusPill flips in-place.
       un_dnf          → refetch /readout.
       card_bound      → refetch competitors so the next card_read
                         shows the new name.
       results_update  → refetch /readout (recent reads may have
                         received OK / MP gates).
   - Tweaks density drives the PunchGrid vs SplitsTable toggle.
   - Keyboard 'P' fires the print toast (plan 15 wires the real ESC/POS).
     'Esc' closes the manual-DNF popover via LatestReadCard's own state.

  Walk-up trigger (C-M3 LOCKED — query-param variant):
   - Unknown card_read → `goto(`?walkup=${cardNumber}`)` on the SAME
     readout URL. NO `/walkup` route file is created.
   - Plan 14 mounts <WalkupModal /> as an overlay when this view sees
     `$page.url.searchParams.get('walkup')` non-null.

  Locked by:
  - 01-13-PLAN.md task 2 + interfaces
  - 01-UI-SPEC.md §"Readout view live behavior" (LOCKED — cap 12,
    flashIn 1.6s, click-history-row re-renders)
  - 01-UI-SPEC.md §"Auto-print toggle"
  - 01-UI-SPEC.md §"Manual DNF override"
  - 01-REVIEWS.md §C-M3 (?walkup= variant)
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { t } from '#lib/i18n/index.ts';
  import Icon from '#lib/ui/Icon.svelte';
  import Button from '#lib/ui/Button.svelte';
  import { tweaks } from '#lib/stores/tweaks.svelte.ts';
  import { getEventorStatus, refreshEventorStatus } from '#lib/stores/eventorStatus.svelte.ts';
  import { bridgeStatus } from '#lib/stores/bridgeStatus.svelte.ts';
  import { resultsChannel, formatClockTime } from '@fartola/shared-types';
  import { createCardSubscription } from '#lib/services/cardSubscription.ts';
  import type {
    CompetitionDTO,
    ClassDTO,
    CourseDTO,
    CompetitorDTO,
  } from '@fartola/shared-types';
  import {
    getCompetition,
    getReadout,
    listCompetitors,
    manualDnf as apiManualDnf,
    unDnf as apiUnDnf,
    setManualStatus as apiSetManualStatus,
    clearManualStatus as apiClearManualStatus,
    type ManualStatus,
    patchCompetition,
    devSimulateRead,
    printReceipt as apiPrintReceipt,
    setActiveCompetition,
    getBridgeStatus,
    lookupEventorBySiCard,
    returnHiredCard,
  } from '#lib/api/client.ts';
  import type { EventorLookupHit, EventorLookupMany } from '@fartola/shared-types';
  import LatestReadCard from '#lib/components/LatestReadCard.svelte';
  import { punchProgress } from '#lib/components/receipt-templates/punchLabels.ts';
  import PunchGrid from '#lib/components/PunchGrid.svelte';
  import SplitsTable from '#lib/components/SplitsTable.svelte';
  import HistoryList from '#lib/components/HistoryList.svelte';
  import ReceiptMirror from '#lib/components/ReceiptMirror.svelte';
  import WalkupModal from '#lib/screens/WalkupModal.svelte';
  import CardRebindNotices from '#lib/components/CardRebindNotices.svelte';
  import type { CardRebind } from '#lib/api/client.ts';
  import EditCompetitorModal from '#lib/components/EditCompetitorModal.svelte';
  import ConsentConfirmationToast from '#lib/components/ConsentConfirmationToast.svelte';
  import HyrbrickaToast from '#lib/components/HyrbrickaToast.svelte';
  import RadioStatusPanel from '#lib/components/RadioStatusPanel.svelte';
  import type { ReceiptTemplate } from '#lib/components/receipt-templates/types.ts';
  import {
    type ReadoutResponse,
    type ReadoutHistoryRow,
    type ReadoutStatus,
    historyKey,
    formatTimeOfDay,
    formatElapsed,
    formatElapsedTenths,
    toReceiptRead,
    missingStartHint,
    startWarning,
    setStartFromInput,
  } from './readout-types.ts';
  import { correctionLines } from './corrections.ts';

  interface Props {
    competitionId: string;
  }

  let { competitionId }: Props = $props();

  // --- state ----------------------------------------------------------------

  let competition: CompetitionDTO | null = $state(null);
  let classes: ClassDTO[] = $state([]);
  // courses is fetched alongside the competition payload; we keep a typed slot
  // so plan 15 can attach control codes when wiring the splits projection.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let courses: CourseDTO[] = $state([]);
  let competitors: CompetitorDTO[] = $state([]);
  let history: ReadoutHistoryRow[] = $state([]);
  let voidedCodes: number[] = $state([]);
  let pendingUnknownCards: number[] = $state([]);
  /** The competition clock's UTC offset (ADR-0017), from the same /readout
   * payload as the times it formats, so a corrected offset arrives with the
   * shifted data on the next refetch. */
  let clockOffsetMin: number | null = $state(null);
  /** Currently-displayed read — usually history[0] but the operator can
   * click a history row to pin a different one. Null = empty state. */
  let pinnedKey: string | null = $state(null);
  let flashKey: string | null = $state(null);
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  let walkupTimer: ReturnType<typeof setTimeout> | null = null;
  let selectedTemplate: ReceiptTemplate = $state('classic');
  let autoPrint = $state(false);
  /** Notices on screen, newest first; each leaves after its own 3 s. */
  let toasts: Array<{ id: number; msg: string }> = $state([]);
  let toastSeq = 0;
  const toastTimers = new Set<ReturnType<typeof setTimeout>>();
  /** The last print, for the read it was for; another read shows none. */
  let prints: Record<string, { status: 'busy' | 'ok' | 'failed'; error: string }> = $state({});
  /** The dev-only simulate button shows only when the edge says dev mode. */
  const dev = $derived(getEventorStatus().fartola_dev);

  let subscription: ReturnType<typeof createCardSubscription> | null = null;
  /** Per card number: did the latest classified read add a row the page did
   * not have? Set by classifyCard, consumed by onCardRead. */
  const newTopByCard = new Map<number, boolean>();

  // Walk-up overlay open flag — reactive from the URL. Plan 14 mounts a
  // modal when this is non-null; for plan 13 we expose the same signal
  // so the auto-redirect skips when the modal is already open.
  const walkupCard = $derived(page.url.searchParams.get('walkup'));
  /** Firmware-side card_holder hint from the latest unmatched history row
   * for the walk-up card. Pre-fills the walk-up modal's name field when
   * the SI card was programmed at issuance (PR #3 Gemini suggestion).
   * Most rental fleet cards have no hint; personal cards usually do. */
  const walkupHint = $derived.by((): string | null => {
    if (walkupCard === null) return null;
    const n = Number(walkupCard);
    if (!Number.isInteger(n) || n <= 0) return null;
    const row = history.find((r) => r.card_number === n && r.unmatched);
    return row?.card_holder_hint ?? null;
  });

  // Phase 2.0 Plan 02-02 — fetch the Eventor cache lookup whenever the
  // walkup card changes so the modal can pre-fill name + klubb.
  // Plan 02.1-10: also passes 'many' results so WalkupModal auto-opens the
  // disambiguation picker for same-competition shared cards.
  let eventorHint: EventorLookupHit | EventorLookupMany | null = $state(null);
  let _lastLookedUpCard: number | null = $state(null);
  $effect(() => {
    // Re-evaluate when walkupCard changes.
    const card = walkupCard;
    if (card === null) {
      eventorHint = null;
      _lastLookedUpCard = null;
      return;
    }
    const n = Number(card);
    if (!Number.isInteger(n) || n <= 0) {
      eventorHint = null;
      return;
    }
    if (_lastLookedUpCard === n) return;
    _lastLookedUpCard = n;
    void (async () => {
      try {
        const r = await lookupEventorBySiCard(n, competitionId);
        // Pass hit: true (single resolved) and hit: 'many' (same-competition
        // shared card) to the modal. WalkupModal handles both: auto-fills on
        // hit: true and auto-opens the picker on hit: 'many'.
        // hit: false (miss) clears the hint so the form starts empty.
        eventorHint = r.hit === false ? null : r;
      } catch {
        eventorHint = null;
      }
    })();
  });

  // C-M4 consent-confirmation toast state (plan 14). Set when a card_read
  // resolves to a competitor with consent_status='pending_first_read' AND
  // the operator has not already dismissed it this session.
  let pendingConsentToast: {
    competitorId: string;
    competitorName: string;
    className: string;
    /** The card replacement that raised it (rebindKey); undoing that
     * replacement withdraws it. */
    fromRebind?: string;
  } | null = $state(null);
  /** Per-session set of competitor ids the operator has dismissed (chose
   * "Senare") so the toast doesn't re-pop on subsequent reads for the
   * same runner. consent_status stays 'pending_first_read' server-side. */
  const dismissedConsentForCompetitorIds: Set<string> = new Set();

  // Phase 2.0 Plan 02-05 — Hyrbricka finish-readout toast state. Set when
  // a card_read resolves to a row whose hired_card_open is non-null AND
  // the operator hasn't already returned/dismissed for this card this
  // session.
  let pendingHyrbrickaToast: {
    cardNumber: number;
    contactName: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    note: string | null;
    fromRebind?: string;
  } | null = $state(null);
  /** Per-session set of card_numbers the operator has acknowledged (via
   * Returnerad OR Ignorera). RESEARCH §Assumption A8: Svelte 5's
   * reactivity on Set mutation is unreliable — use the replacement form
   * `new Set([...prev, x])` everywhere this is updated. */
  let returnedHiredCardNumbers: Set<number> = $state(new Set());

  // Edit-competitor modal — non-null = open with that competitor id loaded
  // from the competitors map. Save flows through editCompetitorProfile
  // (PATCH /api/competitors/:id/profile) and refetchCompetitors.
  let editingCompetitorId: string | null = $state(null);

  /** Card replacements from the walk-up overlay's "anmäld?" step, newest
   * first, each shown with undo until the operator closes it (ADR-0016
   * rule 2). */
  let rebinds: CardRebind[] = $state([]);

  // --- derived UI shapes ----------------------------------------------------

  /** Index competitors by id for O(1) lookup when projecting a read. */
  const competitorsById = $derived.by(() => {
    const m = new Map<string, CompetitorDTO>();
    for (const c of competitors) m.set(c.id, c);
    return m;
  });
  const classesById = $derived.by(() => {
    const m = new Map<string, ClassDTO>();
    for (const c of classes) m.set(c.id, c);
    return m;
  });

  /** The history row currently displayed in the LatestReadCard. */
  const currentRow = $derived.by(() => {
    if (pinnedKey) {
      const found = history.find((r) => historyKey(r) === pinnedKey);
      if (found) return found;
    }
    return history[0] ?? null;
  });

  const currentKey = $derived(currentRow ? historyKey(currentRow) : null);
  const shownPrint = $derived(
    (currentKey !== null ? prints[currentKey] : undefined) ?? { status: 'idle' as const, error: '' }
  );
  /** An older read is pinned and a newer one exists: the card says so. */
  const pinnedOlder = $derived(
    pinnedKey !== null &&
      currentKey !== null &&
      history[0] !== undefined &&
      currentKey !== historyKey(history[0])
  );

  /** Format a start_time_ms value (epoch ms) as HH:MM:SS on the competition clock. */
  function formatStartTimeMs(ms: number | null, offsetMin: number | null): string {
    if (ms === null || offsetMin === null) return '—';
    return formatClockTime(ms, offsetMin);
  }

  /** Build the LatestReadCard input. */
  const latestReadProp = $derived.by(() => {
    const row = currentRow;
    if (!row) return null;
    const competitor = row.competitor_id ? competitorsById.get(row.competitor_id) : null;
    const cls = competitor ? classesById.get(competitor.class_id) : null;
    return {
      cardNumber: row.card_number,
      cardType: row.card_type,
      name: row.competitor_name,
      cls: cls?.name ?? '—',
      club: competitor?.club ?? null,
      startTime: formatStartTimeMs(row.start_time_ms, clockOffsetMin),
      readTime: formatTimeOfDay(row.event_time_ms),
      elapsed: (() => {
        // The backend's running time (scoring), never recomputed here.
        const elapsedMs = row.elapsed_time_ms;
        // 02.1-14 Task 9: no running time for a class without timing.
        if (elapsedMs === null || cls?.no_timing) return '—';
        return competition?.timing_format === 'tenths'
          ? formatElapsedTenths(elapsedMs)
          : formatElapsed(elapsedMs);
      })(),
      status: row.status as ReadoutStatus,
      // Phase 2.1 (plan 13): pass manual_status through so LatestReadCard
      // can distinguish auto-DNF (no clear button) from operator override.
      manual_status: row.manual_status,
      place: row.class_place ?? null,
      untimed: cls?.no_timing ?? false,
      unknown: row.unmatched,
      competitorId: row.competitor_id,
      // 02.1-14 Task 13: "Saknar starttid" + suggestion.
      missingStart: row.missing_start,
      missingStartHint: clockOffsetMin === null ? null : missingStartHint(row, clockOffsetMin),
      // 02.1-14 Task 14: late / early start punch (jury warning).
      startWarning: startWarning(row),
      corrections: correctionLines(row, clockOffsetMin),
    };
  });

  /** Build the ReceiptMirror input. Punches + elapsed are derived inside
   * toReceiptRead from the raw card data on the history row. */
  const receiptRead = $derived.by(() => {
    const row = currentRow;
    if (!row || row.unmatched) return null;
    const competitor = row.competitor_id ? competitorsById.get(row.competitor_id) : null;
    const cls = competitor ? classesById.get(competitor.class_id) : null;
    // Elapsed: the backend's running time (scoring), never recomputed here.
    const elapsedMs = row.elapsed_time_ms;
    return toReceiptRead({
      row,
      className: cls?.name ?? '—',
      classId: competitor?.class_id ?? '',
      club: competitor?.club ?? null,
      bib: competitor?.bib ?? null,
      competitionName: competition?.name ?? '',
      competitionDate: competition?.date ?? '',
      elapsedMs,
      noTiming: cls?.no_timing ?? false,
      voidedCodes,
    });
  });

  /** HistoryList row shape — flattens our wire-side row with the helper
   * key + display fields. */
  const historyRows = $derived(
    history.map((r) => {
      const competitor = r.competitor_id ? competitorsById.get(r.competitor_id) : null;
      const cls = competitor ? classesById.get(competitor.class_id) : null;
      return {
        cardNumber: r.card_number,
        name: r.competitor_name,
        cls: cls?.name ?? '—',
        readTime: formatTimeOfDay(r.event_time_ms),
        elapsed: '—',
        status: r.status as ReadoutStatus,
        unknown: r.unmatched,
        key: historyKey(r),
      };
    })
  );

  // --- effects --------------------------------------------------------------

  onMount(() => {
    void mountReadout();
    void refreshEventorStatus();
    window.addEventListener('keydown', onKeydown);
  });

  onDestroy(() => {
    if (subscription) subscription.disconnect();
    if (flashTimer) clearTimeout(flashTimer);
    if (walkupTimer) clearTimeout(walkupTimer);
    for (const h of toastTimers) clearTimeout(h);
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeydown);
  });

  async function mountReadout(): Promise<void> {
    try {
      const [compRes, readoutRes, compsRes] = await Promise.all([
        getCompetition(competitionId),
        getReadout(competitionId) as Promise<ReadoutResponse>,
        listCompetitors(competitionId),
      ]);
      competition = compRes.competition;
      classes = compRes.classes;
      courses = compRes.courses;
      competitors = compsRes.competitors;
      history = readoutRes.history;
      pendingUnknownCards = readoutRes.pending_unknown_cards;
      voidedCodes = readoutRes.voided_codes;
      clockOffsetMin = readoutRes.clock_offset_min;
      selectedTemplate = compRes.competition.receipt_template;
      autoPrint = compRes.competition.auto_print;
      // Claim this competition as the bridge's active feed. Without this
      // the bridge keeps broadcasting card_reads on whichever channel the
      // last active comp held (e.g. left over from an e2e run), and this
      // page sits silent.
      if (!readoutRes.active) {
        try {
          await setActiveCompetition(competitionId);
        } catch {
          // Soft fail — operator can still toggle from settings.
        }
      }
      // bridgeStatus is primed + kept fresh by the layout-level 2s poll
      // (apps/web/src/routes/+layout.svelte). The WS connection_changed
      // handler below still updates it eagerly for sub-second feedback
      // while on /readout, but the prime fetch that used to live here is
      // no longer needed.
    } catch (err) {
      // Surface a transient toast — readout still mounts so the WS
      // can paint the next card_read. Note: in dev this can fire when
      // the competition row was deleted under us.
      const msg = (err as Error).message;
      toast(`${t('err.network')} (${msg})`);
    }
    connectWs();
  }

  function connectWs(): void {
    // The shared cardSubscription service owns the WsClient + replay
    // unwrap + dispatch loop (extracted by 02-02b-PLAN.md task 2).
    // /readout supplies classifyCard so the existing
    // silent-drop-when-modal-open semantics keep working; every other
    // envelope (manual_dnf, card_bound, results_update, meos_merge,
    // hired_card_returned) flows through onOtherEnvelope to the same
    // dispatch logic Phase 1 inlined.
    subscription = createCardSubscription({
      competitionId,
      onCardRead: (cardNumber, _hint, _classification, replay) => {
        // The classifyCard resolver already refetched /readout +
        // /competitors; the projection is now authoritative for the
        // post-read side effects (walkup redirect, consent toast,
        // hyrbricka toast). The classification value is informational —
        // triggerCardReadSideEffects re-checks history[0].unmatched
        // (the existing C-M3 site) to decide the walkup branch.
        // A replay of a read the page already had (the hello after load or a
        // reconnect) is no news; a live or a missed one is, and takes over.
        const isNew = !replay || (newTopByCard.get(cardNumber) ?? true);
        newTopByCard.delete(cardNumber);
        if (isNew) triggerCardReadSideEffects(cardNumber);
      },
      classifyCard: async (cardNumber) => {
        // Refetch BOTH endpoints so history[0].unmatched + competitor
        // consent_status reflect the post-read state. This is the
        // same Promise.all that the Phase 1 inline `onCardRead` ran.
        const seen = new Set(history.map(historyKey));
        await Promise.all([refetchReadout(), refetchCompetitors()]);
        // This read's own row: a later read may already be on top.
        const row = readRow(cardNumber);
        newTopByCard.set(cardNumber, row !== undefined && !seen.has(historyKey(row)));
        const isUnmatched = row?.unmatched ?? false;
        const cardHolderHint = isUnmatched ? row?.card_holder_hint ?? null : null;
        return { isUnmatched, cardHolderHint };
      },
      onConnectionChange: (state) => {
        bridgeStatus.set(state);
      },
      onOtherEnvelope: (eventType, payload) => {
        switch (eventType) {
          case 'manual_dnf':
          case 'un_dnf':
          case 'results_update':
            void refetchReadout();
            break;
          case 'card_bound':
            void refetchCompetitors();
            void refetchReadout();
            break;
          case 'meos_merge': {
            // Phase 2.0 plan 02-04 (D-MOP-3): MOP receiver auto-merged
            // N MeOS-only competitors into our competitors table;
            // surface a Swedish toast so the operator sees the
            // recovery happened. No re-fetch — the next card_read
            // flow already re-queries competitors when needed
            // (PATTERNS S-4 + RESEARCH "Plan 5 nuance").
            const count = (payload as { count?: number } | null)?.count;
            if (typeof count === 'number' && count > 0) {
              toast(t('ro.meosMerge', { count }));
            }
            break;
          }
          case 'hired_card_returned': {
            // Phase 2.0 plan 02-05: another operator marked this card
            // returned (typically via the admin "Aktiva hyrbrickor"
            // view). Add it to our dismissal Set so future card_reads
            // for this card don't re-pop the toast. Same Set
            // replacement pattern as onHyrbrickaReturn — Assumption A8.
            const cn = (payload as { card_number?: number } | null)?.card_number;
            if (typeof cn === 'number' && Number.isInteger(cn) && cn > 0) {
              returnedHiredCardNumbers = new Set([...returnedHiredCardNumbers, cn]);
              // If the toast is currently open for this same card,
              // dismiss it — the cross-operator return obviates our
              // own pending action.
              if (pendingHyrbrickaToast && pendingHyrbrickaToast.cardNumber === cn) {
                pendingHyrbrickaToast = null;
              }
            }
            break;
          }
          default:
            break;
        }
      },
      extraChannels: [resultsChannel(competitionId)],
    });
    subscription.connect();
  }

  /** Refetches overlap; an answer older than the one shown is dropped. */
  let readoutSeq = 0;
  let readoutShown = 0;
  let readoutNewest: Promise<void> = Promise.resolve();
  /** The newest refetch failed: the readout may be behind (ADR-0016 rule 5). */
  let readoutFailed = $state(false);

  /** Resolves once the newest refetch has landed, so a caller that reads
   * `history` afterwards (classifyCard) never sees an older state. */
  async function refetchReadout(): Promise<void> {
    let waited = fetchReadout(++readoutSeq);
    readoutNewest = waited;
    await waited;
    while (waited !== readoutNewest) {
      waited = readoutNewest;
      await waited;
    }
  }

  async function fetchReadout(mine: number): Promise<void> {
    try {
      const res = (await getReadout(competitionId)) as ReadoutResponse;
      if (mine < readoutShown) return;
      readoutShown = mine;
      if (mine === readoutSeq) readoutFailed = false;
      history = res.history;
      pendingUnknownCards = res.pending_unknown_cards;
      voidedCodes = res.voided_codes;
      clockOffsetMin = res.clock_offset_min;
    } catch {
      // Keep what is shown; the retry or the next event fetches again.
      if (mine === readoutSeq) readoutFailed = true;
    }
  }

  async function refetchCompetitors(): Promise<void> {
    try {
      const res = await listCompetitors(competitionId);
      competitors = res.competitors;
    } catch {
      // Soft fail.
    }
  }

  // --- WS envelope dispatch -------------------------------------------------
  //
  // WS connect + replay-unwrap + dispatch loop live in cardSubscription
  // (extracted by 02-02b-PLAN.md task 2). The per-event side effects
  // below (triggerCardReadSideEffects + the consent/hyrbricka logic)
  // stay in-screen because they read screen-local state.

  /** The newest history row of `cardNumber`: the read itself, even when a
   * later read in the same refetch is on top. */
  function readRow(cardNumber: number): ReadoutHistoryRow | undefined {
    return history.find((r) => r.card_number === cardNumber);
  }

  function triggerCardReadSideEffects(cardNumber: number): void {
    // A new read takes over at once; if it replaced a pinned older read, a
    // notice says that read is still in the history (RO-9).
    const top = history[0];
    const replacedPin = pinnedKey !== null && top !== undefined && pinnedKey !== historyKey(top);
    pinnedKey = null;
    if (replacedPin) {
      toast(t('ro.pinned.replaced', { name: top.competitor_name ?? t('ro.unknownCard') }));
    }
    if (top) {
      const key = historyKey(top);
      flashKey = key;
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        flashKey = null;
      }, 1600);
    }
    // Unknown card → walk-up redirect after 600ms (UI-SPEC). Skip if a
    // walk-up overlay is already open for some other card (subsequent-
    // cards behavior: operator picks up from history when ready).
    const row = readRow(cardNumber);
    if (row?.unmatched && walkupCard === null) {
      if (walkupTimer) clearTimeout(walkupTimer);
      walkupTimer = setTimeout(() => {
        void goto(`/competition/${competitionId}/readout?walkup=${cardNumber}`);
      }, 600);
    }

    if (row) firstReadPrompts(row, cardNumber);
  }

  /** The prompts a competitor's read-out raises: consent confirmation
   * (C-M4) and the hyrbricka return (Plan 02-05). Run for the latest read
   * and for a read just attached by a card replacement. `row` is the
   * refetched history row of `cardNumber`. */
  function firstReadPrompts(
    row: ReadoutHistoryRow,
    cardNumber: number,
    fromRebind?: string
  ): void {
    // C-M4: first card_read for a competitor whose consent_status ===
    // 'pending_first_read' surfaces the one-time confirmation toast. The
    // toast is local UI sugar — the card_read is fully accepted server-
    // side regardless of consent state. We refetch competitors on every
    // card_read (card_bound + card_read both trigger refetch indirectly)
    // so the lookup reflects the current server-side state.
    if (row.competitor_id && !row.unmatched && pendingConsentToast === null) {
      const competitor = competitorsById.get(row.competitor_id);
      if (
        competitor &&
        competitor.consent_status === 'pending_first_read' &&
        !dismissedConsentForCompetitorIds.has(competitor.id)
      ) {
        const cls = classesById.get(competitor.class_id);
        pendingConsentToast = {
          competitorId: competitor.id,
          competitorName: competitor.name,
          className: cls?.name ?? '—',
          ...(fromRebind !== undefined ? { fromRebind } : {}),
        };
      }
    }

    // Phase 2.0 Plan 02-05: surface the Hyrbricka finish-readout toast on
    // every card_read whose history row has a non-null hired_card_open
    // payload AND the operator has not already returned/dismissed this
    // card_number in the session (RESEARCH §"Pattern 6"). The readout
    // refetch above guarantees the row's `hired_card_open` is the
    // authoritative server view.
    if (
      row.card_number === cardNumber &&
      row.hired_card_open !== null &&
      !returnedHiredCardNumbers.has(cardNumber) &&
      pendingHyrbrickaToast === null
    ) {
      const hco = row.hired_card_open;
      pendingHyrbrickaToast = {
        cardNumber,
        contactName: hco.contact_name,
        contactPhone: hco.contact_phone,
        contactEmail: hco.contact_email,
        note: hco.note,
        ...(fromRebind !== undefined ? { fromRebind } : {}),
      };
    }
  }

  /** A card replacement attached an unknown read to an entered runner: it
   * is that runner's read-out now, so refetch and raise its prompts. */
  const rebindKey = (r: CardRebind): string => `${r.card_event.node_id}:${r.card_event.local_seq}`;
  /** Replacements undone this session: their prompts must not (re)appear. */
  const undoneRebinds = new Set<string>();

  async function onRebound(r: CardRebind): Promise<void> {
    rebinds = [r, ...rebinds];
    await Promise.all([refetchCompetitors(), refetchReadout()]);
    if (undoneRebinds.has(rebindKey(r))) return;
    const row = history.find((h) => h.card_number === r.card_number && !h.unmatched);
    if (row) firstReadPrompts(row, r.card_number, rebindKey(r));
  }

  /** Undo of a replacement: the read is unknown again, so the consent and
   * hyrbricka prompts it raised for the chosen runner are withdrawn. */
  function onRebindUndone(r: CardRebind): void {
    const key = rebindKey(r);
    undoneRebinds.add(key);
    if (pendingConsentToast?.fromRebind === key) pendingConsentToast = null;
    if (pendingHyrbrickaToast?.fromRebind === key) pendingHyrbrickaToast = null;
    void refetchCompetitors();
    void refetchReadout();
  }

  async function onHyrbrickaReturn(cardNumber: number): Promise<void> {
    try {
      await returnHiredCard(competitionId, cardNumber);
    } catch (e) {
      toast(`${t('err.network')} (${(e as Error).message})`);
      return;
    }
    // Set replacement form — Assumption A8 (Svelte 5 mutation reactivity).
    returnedHiredCardNumbers = new Set([...returnedHiredCardNumbers, cardNumber]);
    pendingHyrbrickaToast = null;
    toast(t('readout.hyrbricka.returnedConfirmed'));
  }

  function onHyrbrickaDismiss(cardNumber: number): void {
    // Local dismissal — no server PATCH. The card stays open server-side;
    // the Set-based suppression keeps the toast from re-popping this session.
    returnedHiredCardNumbers = new Set([...returnedHiredCardNumbers, cardNumber]);
    pendingHyrbrickaToast = null;
  }

  function onConsentToastResolved(action: 'confirmed' | 'dismissed'): void {
    if (pendingConsentToast === null) return;
    if (action === 'dismissed') {
      dismissedConsentForCompetitorIds.add(pendingConsentToast.competitorId);
    } else {
      // On 'confirmed' we refetch competitors so consent_status reflects
      // the server-side flip ('confirmed_on_read'); subsequent reads for
      // this runner won't re-trigger the toast.
      void refetchCompetitors();
    }
    pendingConsentToast = null;
  }

  // --- handlers -------------------------------------------------------------

  function onSelectHistory(row: { key: string; cardNumber: number; unknown: boolean }): void {
    // The newest row is the latest read: showing it is not "pinning".
    pinnedKey = history[0] !== undefined && row.key === historyKey(history[0]) ? null : row.key;
    if (row.unknown) {
      void goto(`/competition/${competitionId}/readout?walkup=${row.cardNumber}`);
    }
  }

  function onWalkupCta(cardNumber: number): void {
    void goto(`/competition/${competitionId}/readout?walkup=${cardNumber}`);
  }

  async function onManualDnfHandler(competitorId: string, reason: string): Promise<void> {
    try {
      await apiManualDnf(competitionId, competitorId, reason);
      // WS will broadcast manual_dnf and trigger refetch; we also refetch
      // synchronously so the StatusPill flip is observable inside the
      // 500ms e2e assertion window.
      await refetchReadout();
    } catch (err) {
      toast(`${t('err.network')} (${(err as Error).message})`);
    }
  }

  async function onUnDnfHandler(competitorId: string): Promise<void> {
    try {
      await apiUnDnf(competitionId, competitorId);
      await refetchReadout();
    } catch (err) {
      toast(`${t('err.network')} (${(err as Error).message})`);
    }
  }

  // Phase 2.0 — generalized manual-status override + clear. Uses the new
  // /status + /clear-status endpoints so the operator can pick DNF/DNS/DQ/
  // CANCEL/MAX rather than only DNF.
  async function onManualStatusHandler(
    competitorId: string,
    status: ManualStatus,
    reason: string
  ): Promise<void> {
    // Throws on failure: the card keeps its popover open with the reason.
    try {
      await apiSetManualStatus(competitionId, competitorId, status, reason);
    } catch (err) {
      // The shown read changed while saving: the popover is gone, so the
      // failure is told in a toast instead of being lost.
      if (latestReadProp?.competitorId === competitorId) throw err;
      const name = competitorsById.get(competitorId)?.name ?? '';
      toast(t('ro.status.failedFor', { name }));
      return;
    }
    await refetchReadout();
    const name = competitorsById.get(competitorId)?.name ?? latestReadProp?.name ?? '';
    toast(t('ro.status.done', { name, status: t(`status.${status}`) }));
  }

  async function onClearManualStatusHandler(competitorId: string): Promise<void> {
    try {
      await apiClearManualStatus(competitionId, competitorId);
      await refetchReadout();
    } catch (err) {
      toast(`${t('err.network')} (${(err as Error).message})`);
    }
  }

  // 02.1-14 Task 13: "Sätt starttid" on a read without a start. The time is
  // read on the competition clock, before the read's finish.
  async function onSetStartTimeHandler(competitorId: string, text: string): Promise<void> {
    const row = currentRow;
    if (!row || clockOffsetMin === null) return;
    try {
      const result = await setStartFromInput(
        competitionId,
        competitorId,
        text,
        row.finish_ms,
        clockOffsetMin
      );
      if (result !== 'ok') {
        toast(t(result === 'after_finish' ? 'ms.startAfterFinish' : 'lottning.invalidTime'));
        return;
      }
      await Promise.all([refetchReadout(), refetchCompetitors()]);
    } catch (err) {
      toast(`${t('err.network')} (${(err as Error).message})`);
    }
  }

  async function onToggleAutoPrint(): Promise<void> {
    const next = !autoPrint;
    autoPrint = next;
    if (!competition) return;
    try {
      const updated = await patchCompetition(competitionId, { auto_print: next });
      competition = updated;
    } catch {
      // Roll back on failure.
      autoPrint = !next;
      toast(t('err.network'));
    }
  }

  function onTemplate(tpl: ReceiptTemplate): void {
    selectedTemplate = tpl;
    if (!competition) return;
    // Best-effort PATCH so the choice persists across reloads. The
    // server returns the updated row; we mirror it back into local state.
    void patchCompetition(competitionId, { receipt_template: tpl }).then(
      (updated) => {
        competition = updated;
      },
      () => {
        // Silent fail — the local UI is the source of truth for the session.
      }
    );
  }

  async function onSimulate(): Promise<void> {
    try {
      // Pick a card number that exists in the local competitor list so
      // the synthetic read renders a known runner. Falls back to a
      // sentinel that lands as an unknown card (good for testing walk-up).
      const cardNum =
        competitors.find((c) => c.card_number !== null)?.card_number ?? 9_999_999;
      await devSimulateRead({
        competition_id: competitionId,
        card_number: cardNum,
        card_type: 'SI10',
        punches: [
          { control_code: 31, time_ms: 35_000 },
          { control_code: 32, time_ms: 78_000 },
          { control_code: 33, time_ms: 140_000 },
        ],
      });
    } catch (err) {
      toast(`${t('err.network')} (${(err as Error).message})`);
    }
  }

  async function onPrintClick(): Promise<void> {
    if (autoPrint) return;
    const competitorId = latestReadProp?.competitorId ?? null;
    const key = currentKey;
    if (competitorId === null || key === null) {
      // The button is disabled with a hint; the 'P' shortcut says the same.
      toast(t('ro.print.none'));
      return;
    }
    if (shownPrint.status === 'busy') return;
    // State is kept per read: a late result only touches its own read.
    prints = { ...prints, [key]: { status: 'busy', error: '' } };
    try {
      await apiPrintReceipt(competitionId, competitorId, selectedTemplate);
      prints = { ...prints, [key]: { status: 'ok', error: '' } };
    } catch (err) {
      const error = (err as Error).message || t('common.unknownError');
      prints = { ...prints, [key]: { status: 'failed', error } };
    }
  }

  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'P' || ev.key === 'p') {
      // Typing a P, a browser shortcut (Ctrl/Cmd/Alt) or any open dialog is
      // not a request to print.
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const el = ev.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (el?.isContentEditable || el?.closest?.('[contenteditable]')) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      ev.preventDefault();
      void onPrintClick();
    } else if (ev.key === 'Escape' && walkupCard !== null) {
      void goto(`/competition/${competitionId}/readout`);
    }
  }

  /** The modal's close: back to the plain readout, and say who was saved. */
  function onWalkupClose(saved: boolean, runner?: { name: string; className: string }): void {
    void goto(`/competition/${competitionId}/readout`);
    if (saved && runner) toast(t('walk.saved', { name: runner.name, class: runner.className }));
  }

  function toast(msg: string): void {
    const id = ++toastSeq;
    toasts = [{ id, msg }, ...toasts];
    const h = setTimeout(() => {
      toasts = toasts.filter((x) => x.id !== id);
      toastTimers.delete(h);
    }, 3000);
    toastTimers.add(h);
  }
</script>

<div class="readout-wrap">
<div class="readout" data-density={tweaks.density} data-testid="readout-view">
  <div class="ro-card">
    <LatestReadCard
      read={latestReadProp}
      flashKey={flashKey !== null && flashKey === currentKey ? flashKey : null}
      autoPrint={autoPrint}
      printState={shownPrint}
      {pinnedOlder}
      onShowLatest={() => {
        pinnedKey = null;
      }}
      onSimulate={dev ? () => void onSimulate() : undefined}
      onPrint={() => void onPrintClick()}
      onWalkup={onWalkupCta}
      onManualDnf={(id, reason) => void onManualDnfHandler(id, reason)}
      onUnDnf={(id) => void onUnDnfHandler(id)}
      onManualStatus={onManualStatusHandler}
      onClearManualStatus={(id) => void onClearManualStatusHandler(id)}
      onEdit={(id) => { editingCompetitorId = id; }}
      onSetStartTime={(id, text) => void onSetStartTimeHandler(id, text)}
    >
      {#snippet controls()}
        {#if latestReadProp && !latestReadProp.unknown && receiptRead && receiptRead.punches.length > 0}
          <div class="controls-head">
            <h3>{t('ro.course')}</h3>
            <span class="muted mono">
              {punchProgress(receiptRead.punches).ok}/{punchProgress(receiptRead.punches).total}
            </span>
          </div>
          {#if tweaks.density === 'high'}
            <SplitsTable punches={receiptRead.punches} />
          {:else}
            <PunchGrid
              punches={receiptRead.punches}
              verdict={(currentRow?.expected_codes.length ?? 0) > 0}
            />
          {/if}
        {/if}
      {/snippet}
    </LatestReadCard>
  </div>

  <aside class="ro-side">
    <RadioStatusPanel {competitionId} />

    {#if readoutFailed}
      <div class="refetch-failed" role="alert" data-testid="readout-refetch-failed">
        <Icon name="alert-triangle" size={16} />
        <span>{t('ro.refetchFailed')}</span>
        <Button variant="secondary" size="sm" onclick={() => void refetchReadout()}>
          {t('common.retry')}
        </Button>
      </div>
    {/if}

    <HistoryList
      rows={historyRows}
      activeKey={currentRow ? historyKey(currentRow) : null}
      flashKey={flashKey}
      onSelect={onSelectHistory}
    />

    <CardRebindNotices
      {competitionId}
      {rebinds}
      onUndone={onRebindUndone}
      onClose={(r) => {
        rebinds = rebinds.filter((x) => x !== r);
      }}
    />

    {#if pendingUnknownCards.length > 0}
      <section class="card pending-card">
        <header class="head">
          <h3>{t('ro.unknownCard')}</h3>
          <span class="badge">{pendingUnknownCards.length}</span>
        </header>
        <ul class="pending-list">
          {#each pendingUnknownCards as cn (cn)}
            <li>
              <button
                type="button"
                class="pending-row"
                data-testid="pending-unknown-row"
                onclick={() => onWalkupCta(cn)}
              >
                <span class="mono">{cn}</span>
                <span class="cta">{t('ro.register')} <Icon name="arrow-right" size={16} /></span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </aside>

  <div class="ro-extras">
    <div class="auto-print-row">
      <label class="auto-toggle">
        <span class="sw" data-on={autoPrint}>
          <input
            type="checkbox"
            data-testid="auto-print-toggle"
            checked={autoPrint}
            onchange={() => void onToggleAutoPrint()}
          />
          <span class="sw-thumb"></span>
        </span>
        <span class="lbl">{t('ro.autoprint')}</span>
        <span class="state">{autoPrint ? t('ro.autoprint.on') : t('ro.autoprint.off')}</span>
      </label>
    </div>

    {#if receiptRead}
      <ReceiptMirror
        read={receiptRead}
        selected={selectedTemplate}
        autoPrint={autoPrint}
        printed={shownPrint.status === 'ok'}
        onSelect={onTemplate}
      />
    {/if}
  </div>
</div>
</div>

{#if walkupCard !== null}
  <WalkupModal
    cardNumber={Number(walkupCard)}
    {competitionId}
    {classes}
    cardHolderHint={walkupHint}
    {eventorHint}
    onClose={onWalkupClose}
    onRebound={(r) => void onRebound(r)}
  />
{/if}

<div class="toast-stack" data-testid="toast-stack">
  {#each toasts as x (x.id)}
    <div class="toast" role="status" data-testid="toast">{x.msg}</div>
  {/each}
{#if pendingConsentToast}
  <ConsentConfirmationToast
    competitorId={pendingConsentToast.competitorId}
    competitorName={pendingConsentToast.competitorName}
    className={pendingConsentToast.className}
    onResolved={onConsentToastResolved}
  />
{/if}

{#if pendingHyrbrickaToast}
  <HyrbrickaToast
    cardNumber={pendingHyrbrickaToast.cardNumber}
    contactName={pendingHyrbrickaToast.contactName}
    contactPhone={pendingHyrbrickaToast.contactPhone}
    contactEmail={pendingHyrbrickaToast.contactEmail}
    note={pendingHyrbrickaToast.note}
    onReturn={onHyrbrickaReturn}
    onDismiss={onHyrbrickaDismiss}
  />
{/if}
</div>

<EditCompetitorModal
  open={editingCompetitorId !== null}
  competitor={editingCompetitorId ? competitorsById.get(editingCompetitorId) ?? null : null}
  {competitionId}
  {classes}
  onClose={() => { editingCompetitorId = null; }}
  onSaved={(updated) => {
    // Refetch so derived shapes (competitorsById, history rows) pick
    // up the new name/club/class. Single source of truth = server.
    editingCompetitorId = null;
    void refetchCompetitors();
    void refetchReadout();
  }}
/>

<style>
  .readout-wrap {
    container: readout / inline-size;
    height: 100%;
  }
  .readout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 380px;
    gap: 18px;
    height: 100%;
    position: relative;
  }
  @container readout (max-width: 1280px) {
    .readout {
      grid-template-columns: minmax(0, 1fr) 340px;
    }
  }
  /* DOM order card, rail, extras is the reading order in both layouts
     (ADR-0016: Tab follows what is seen): side by side, row by row (card
     | rail, then auto-print and the receipt preview under the card); stacked,
     top to bottom. */
  .readout {
    grid-template-rows: auto 1fr;
    grid-template-areas:
      'card side'
      'extras side';
  }
  .ro-card {
    grid-area: card;
    min-width: 0;
  }
  .ro-side {
    grid-area: side;
  }
  .ro-extras {
    grid-area: extras;
    align-self: start;
    display: flex;
    flex-direction: column;
    gap: 18px;
    min-width: 0;
  }
  /* History rail below the card whenever the readout column would be
     narrower than ~600px (340 rail + 18 gap + 600). */
  @container readout (max-width: 958px) {
    .readout {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: none;
      grid-template-areas: none;
      height: auto;
    }
    .ro-card,
    .ro-side,
    .ro-extras {
      grid-area: auto;
    }
  }
  .ro-side {
    display: flex;
    flex-direction: column;
    gap: 18px;
    min-width: 0;
  }
  .refetch-failed {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding: 8px 12px;
    border: 1px solid var(--dnf);
    border-radius: var(--radius);
    background: var(--dnf-soft);
    font-size: var(--fs-label);
  }
  .controls-head {
    margin-top: 22px;
    margin-bottom: 8px;
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  .controls-head h3 {
    margin: 0;
    font-size: var(--fs-heading);
    font-weight: 600;
  }
  .muted {
    color: var(--fg-muted);
  }
  .mono {
    font-family: var(--font-mono);
    font-feature-settings:
      'tnum' 1,
      'zero' 1;
    font-size: var(--fs-label);
  }
  .auto-print-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 4px;
  }
  .auto-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: var(--hit);
    cursor: pointer;
    user-select: none;
  }
  .auto-toggle .sw {
    position: relative;
    width: 44px;
    height: 24px;
    background: var(--bg-sunken);
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    transition:
      background 0.16s,
      border 0.16s;
    flex-shrink: 0;
  }
  .auto-toggle .sw input {
    position: absolute;
    opacity: 0;
    inset: 0;
    cursor: pointer;
  }
  .auto-toggle .sw .sw-thumb {
    position: absolute;
    left: 2px;
    top: 1px;
    width: 20px;
    height: 20px;
    background: var(--bg-elev);
    border-radius: 50%;
    box-shadow: var(--shadow-sm);
    transition: left 0.16s;
  }
  .auto-toggle .sw[data-on='true'] {
    background: var(--accent);
    border-color: var(--accent);
  }
  .auto-toggle .sw[data-on='true'] .sw-thumb {
    left: 21px;
    background: var(--accent-fg);
  }
  .auto-toggle .lbl,
  .auto-toggle .state {
    font-size: var(--fs-label);
    font-weight: 500;
  }
  .auto-toggle .state {
    min-width: 2ch;
  }
  .card {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .pending-card .head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  .pending-card .head h3 {
    margin: 0;
    font-size: var(--fs-label);
    font-weight: 600;
    color: var(--fg);
  }
  .pending-card .badge {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    background: var(--bg-sunken);
    color: var(--fg);
    padding: 2px 8px;
    border-radius: 999px;
  }
  .pending-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .pending-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 10px 14px;
    background: transparent;
    border: 0;
    border-top: 1px solid var(--border);
    cursor: pointer;
    font-family: inherit;
    color: inherit;
  }
  .pending-row:hover {
    background: var(--bg-sunken);
  }
  .pending-row .cta {
    font-size: var(--fs-label);
    color: var(--accent);
    font-weight: 600;
  }
  .toast-stack {
    position: fixed;
    right: max(24px, env(safe-area-inset-right));
    bottom: max(24px, env(safe-area-inset-bottom));
    width: min(420px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 100;
    pointer-events: none;
  }
  .toast-stack > :global(*) {
    pointer-events: auto;
  }
  .toast {
    background: var(--fg);
    color: var(--bg-elev);
    padding: 10px 18px;
    border-radius: var(--radius);
    font-size: var(--fs-label);
    box-shadow: var(--shadow-lg);
  }
</style>
