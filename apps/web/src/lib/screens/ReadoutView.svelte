<!--
  Authored for fartola. Not ported from upstream.

  ReadoutView — primary operator surface. Grid (1fr / 380px → 340px at
  ≤1280px). Left column: LatestReadCard + ReceiptMirror. Right column:
  HistoryList.

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
  import { t } from '$lib/i18n/index.ts';
  import { tweaks } from '$lib/stores/tweaks.svelte.ts';
  import { bridgeStatus } from '$lib/stores/bridgeStatus.svelte.ts';
  import { resultsChannel } from '@fartola/shared-types';
  import { createCardSubscription } from '$lib/services/cardSubscription.ts';
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
  } from '$lib/api/client.ts';
  import type { EventorLookupHit, EventorLookupMany } from '@fartola/shared-types';
  import LatestReadCard from '$lib/components/LatestReadCard.svelte';
  import PunchGrid from '$lib/components/PunchGrid.svelte';
  import SplitsTable from '$lib/components/SplitsTable.svelte';
  import HistoryList from '$lib/components/HistoryList.svelte';
  import ReceiptMirror from '$lib/components/ReceiptMirror.svelte';
  import WalkupModal from '$lib/screens/WalkupModal.svelte';
  import EditCompetitorModal from '$lib/components/EditCompetitorModal.svelte';
  import ConsentConfirmationToast from '$lib/components/ConsentConfirmationToast.svelte';
  import HyrbrickaToast from '$lib/components/HyrbrickaToast.svelte';
  import type { ReceiptTemplate } from '$lib/components/receipt-templates/types.ts';
  import {
    type ReadoutResponse,
    type ReadoutHistoryRow,
    type ReadoutStatus,
    historyKey,
    formatTimeOfDay,
    toReceiptRead,
  } from './readout-types.ts';

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
  let pendingUnknownCards: number[] = $state([]);
  /** Currently-displayed read — usually history[0] but the operator can
   * click a history row to pin a different one. Null = empty state. */
  let pinnedKey: string | null = $state(null);
  let flashKey: string | null = $state(null);
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  let walkupTimer: ReturnType<typeof setTimeout> | null = null;
  let selectedTemplate: ReceiptTemplate = $state('classic');
  let autoPrint = $state(false);
  let toastMessage: string | null = $state(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  let subscription: ReturnType<typeof createCardSubscription> | null = null;

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
  } | null = $state(null);
  /** Per-session set of competitor ids the operator has dismissed (chose
   * "Avfärda") so the toast doesn't re-pop on subsequent reads for the
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

  /** Build the LatestReadCard input. */
  const latestReadProp = $derived.by(() => {
    const row = currentRow;
    if (!row) return null;
    const competitor = row.competitor_id ? competitorsById.get(row.competitor_id) : null;
    const cls = competitor ? classesById.get(competitor.class_id) : null;
    return {
      cardNumber: row.card_number,
      name: row.competitor_name,
      cls: cls?.name ?? '—',
      club: competitor?.club ?? null,
      startTime: '—',
      readTime: formatTimeOfDay(row.event_time_ms),
      elapsed: '—',
      status: row.status as ReadoutStatus,
      // Phase 2.1 (plan 13): pass manual_status through so LatestReadCard
      // can distinguish auto-DNF (no clear button) from operator override.
      manual_status: row.manual_status,
      place: null,
      unknown: row.unmatched,
      competitorId: row.competitor_id,
    };
  });

  /** Build the ReceiptMirror input. Punches + elapsed are derived inside
   * toReceiptRead from the raw card data on the history row. */
  const receiptRead = $derived.by(() => {
    const row = currentRow;
    if (!row || row.unmatched) return null;
    const competitor = row.competitor_id ? competitorsById.get(row.competitor_id) : null;
    const cls = competitor ? classesById.get(competitor.class_id) : null;
    // Elapsed in ms: finish - start (or first-punch fallback) on the
    // half-day clock; add a half-day's worth of seconds if the delta
    // wraps negative.
    let elapsedMs: number | null = null;
    if (row.finish_seconds_in_half_day !== null) {
      const base = row.start_seconds_in_half_day ?? row.punches[0]?.seconds_in_half_day ?? null;
      if (base !== null) {
        let delta = row.finish_seconds_in_half_day - base;
        if (delta < 0) delta += 43200;
        elapsedMs = delta * 1000;
      }
    }
    return toReceiptRead({
      row,
      className: cls?.name ?? '—',
      classId: competitor?.class_id ?? '',
      club: competitor?.club ?? null,
      competitionName: competition?.name ?? '',
      competitionDate: competition?.date ?? '',
      elapsedMs,
      place: null,
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
        cls: cls?.name ?? (r.unmatched ? '⚠' : '—'),
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
    window.addEventListener('keydown', onKeydown);
  });

  onDestroy(() => {
    if (subscription) subscription.disconnect();
    if (flashTimer) clearTimeout(flashTimer);
    if (walkupTimer) clearTimeout(walkupTimer);
    if (toastTimer) clearTimeout(toastTimer);
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
      onCardRead: (cardNumber, _hint, _classification) => {
        // The classifyCard resolver already refetched /readout +
        // /competitors; the projection is now authoritative for the
        // post-read side effects (walkup redirect, consent toast,
        // hyrbricka toast). The classification value is informational —
        // triggerCardReadSideEffects re-checks history[0].unmatched
        // (the existing C-M3 site) to decide the walkup branch.
        triggerCardReadSideEffects(cardNumber);
      },
      classifyCard: async (cardNumber) => {
        // Refetch BOTH endpoints so history[0].unmatched + competitor
        // consent_status reflect the post-read state. This is the
        // same Promise.all that the Phase 1 inline `onCardRead` ran.
        await Promise.all([refetchReadout(), refetchCompetitors()]);
        const top = history[0];
        const isUnmatched = top !== undefined && top.card_number === cardNumber && top.unmatched;
        const cardHolderHint = isUnmatched ? top?.card_holder_hint ?? null : null;
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

  async function refetchReadout(): Promise<void> {
    try {
      const res = (await getReadout(competitionId)) as ReadoutResponse;
      history = res.history;
      pendingUnknownCards = res.pending_unknown_cards;
    } catch {
      // Soft fail — WS will catch up.
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

  function triggerCardReadSideEffects(cardNumber: number): void {
    pinnedKey = null;
    const top = history[0];
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
    const isUnknown = top?.card_number === cardNumber && top.unmatched;
    if (isUnknown && walkupCard === null) {
      if (walkupTimer) clearTimeout(walkupTimer);
      walkupTimer = setTimeout(() => {
        void goto(`/competition/${competitionId}/readout?walkup=${cardNumber}`);
      }, 600);
    }

    // C-M4: first card_read for a competitor whose consent_status ===
    // 'pending_first_read' surfaces the one-time confirmation toast. The
    // toast is local UI sugar — the card_read is fully accepted server-
    // side regardless of consent state. We refetch competitors on every
    // card_read (card_bound + card_read both trigger refetch indirectly)
    // so the lookup reflects the current server-side state.
    if (top && top.competitor_id && !top.unmatched && pendingConsentToast === null) {
      const competitor = competitorsById.get(top.competitor_id);
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
        };
      }
    }

    // Phase 2.0 Plan 02-05: surface the Hyrbricka finish-readout toast on
    // every card_read whose history row has a non-null hired_card_open
    // payload AND the operator has not already returned/dismissed this
    // card_number in the session (RESEARCH §"Pattern 6"). The readout
    // refetch above guarantees `history[0].hired_card_open` is the
    // authoritative server view.
    if (
      top &&
      top.card_number === cardNumber &&
      top.hired_card_open !== null &&
      !returnedHiredCardNumbers.has(cardNumber) &&
      pendingHyrbrickaToast === null
    ) {
      const hco = top.hired_card_open;
      pendingHyrbrickaToast = {
        cardNumber,
        contactName: hco.contact_name,
        contactPhone: hco.contact_phone,
        contactEmail: hco.contact_email,
        note: hco.note,
      };
    }
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
    pinnedKey = row.key;
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
    try {
      await apiSetManualStatus(competitionId, competitorId, status, reason);
      await refetchReadout();
    } catch (err) {
      toast(`${t('err.network')} (${(err as Error).message})`);
    }
  }

  async function onClearManualStatusHandler(competitorId: string): Promise<void> {
    try {
      await apiClearManualStatus(competitionId, competitorId);
      await refetchReadout();
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

  function onPrintClick(): void {
    if (autoPrint) return;
    const competitorId = latestReadProp?.competitorId ?? null;
    if (competitorId === null) {
      // Nothing to print — unknown card / empty state. UI-SPEC says the
      // button is disabled in that case, but the keyboard 'P' shortcut
      // can still fire — surface a benign toast.
      toast(t('ro.printed'));
      return;
    }
    // Optimistic toast — plan 15 ESC/POS print is async via the bridge.
    toast(t('ro.printed'));
    void apiPrintReceipt(competitionId, competitorId, selectedTemplate).catch((err: Error) => {
      // UI-SPEC §"Error states" — 503/429 surface as
      // "Utskrift misslyckades — Kontrollera papper i Star TSP143."
      const msg = err.message ?? 'unknown';
      toast(`Utskrift misslyckades (${msg})`);
    });
  }

  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'P' || ev.key === 'p') {
      // Ignore when focus is in an input so typing P in the DNF reason
      // field doesn't trip the shortcut.
      const tag = (ev.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      ev.preventDefault();
      onPrintClick();
    } else if (ev.key === 'Escape' && walkupCard !== null) {
      void goto(`/competition/${competitionId}/readout`);
    }
  }

  function toast(msg: string): void {
    toastMessage = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastMessage = null;
    }, 3000);
  }
</script>

<div class="readout" data-density={tweaks.density} data-testid="readout-view">
  <div class="ro-main">
    <LatestReadCard
      read={latestReadProp}
      flashKey={flashKey}
      autoPrint={autoPrint}
      onSimulate={() => void onSimulate()}
      onPrint={onPrintClick}
      onWalkup={onWalkupCta}
      onManualDnf={(id, reason) => void onManualDnfHandler(id, reason)}
      onUnDnf={(id) => void onUnDnfHandler(id)}
      onManualStatus={(id, status, reason) => void onManualStatusHandler(id, status, reason)}
      onClearManualStatus={(id) => void onClearManualStatusHandler(id)}
      onEdit={(id) => { editingCompetitorId = id; }}
    >
      {#snippet controls()}
        {#if latestReadProp && !latestReadProp.unknown && receiptRead && receiptRead.punches.length > 0}
          <div class="controls-head">
            <h3>{t('ro.course')}</h3>
            <span class="muted mono">
              {receiptRead.punches.filter((p) => p.ok).length}/{receiptRead.punches.length}
            </span>
          </div>
          {#if tweaks.density === 'high'}
            <SplitsTable punches={receiptRead.punches} />
          {:else}
            <PunchGrid punches={receiptRead.punches} />
          {/if}
        {/if}
      {/snippet}
    </LatestReadCard>

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
      </label>
      <span class="faint">Star TSP143 · /dev/usb/lp0</span>
    </div>

    {#if receiptRead}
      <ReceiptMirror
        read={receiptRead}
        selected={selectedTemplate}
        autoPrint={autoPrint}
        onSelect={onTemplate}
      />
    {/if}
  </div>

  <aside class="ro-side">
    <HistoryList
      rows={historyRows}
      activeKey={currentRow ? historyKey(currentRow) : null}
      flashKey={flashKey}
      onSelect={onSelectHistory}
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
                <span class="cta">→ {t('ro.register')}</span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </aside>

  {#if toastMessage}
    <div class="toast" role="status" data-testid="toast">{toastMessage}</div>
  {/if}

  {#if walkupCard !== null}
    <WalkupModal
      cardNumber={Number(walkupCard)}
      {competitionId}
      {classes}
      cardHolderHint={walkupHint}
      {eventorHint}
    />
  {/if}

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
</div>

<style>
  .readout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 380px;
    gap: 18px;
    height: 100%;
    position: relative;
  }
  @media (max-width: 1280px) {
    .readout {
      grid-template-columns: minmax(0, 1fr) 340px;
    }
  }
  .ro-main {
    display: flex;
    flex-direction: column;
    gap: 18px;
    min-width: 0;
  }
  .ro-side {
    display: flex;
    flex-direction: column;
    gap: 18px;
    min-width: 0;
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
    font-size: 12px;
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
    cursor: pointer;
    user-select: none;
  }
  .auto-toggle .sw {
    position: relative;
    width: 36px;
    height: 20px;
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
    width: 16px;
    height: 16px;
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
    left: 17px;
    background: #fff;
  }
  .auto-toggle .lbl {
    font-size: 13px;
    font-weight: 500;
  }
  .faint {
    color: var(--fg-faint);
    font-size: 13px;
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
    color: var(--dnf);
  }
  .pending-card .badge {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 11px;
    background: var(--dnf-soft);
    color: var(--dnf);
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
    font-size: 12px;
    color: var(--accent);
    font-weight: 600;
  }
  .toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--fg);
    color: var(--bg-elev);
    padding: 10px 18px;
    border-radius: var(--radius);
    font-size: 13px;
    box-shadow: var(--shadow-lg);
    z-index: 100;
  }
</style>
