// Authored for fartola. Not ported from upstream.
//
// Wires Phase 0's SiMainStation events into the Phase 1 SQLite event log + WS
// broadcast. The bridge is a thin event-driven adapter: each station event
// passes through `insertEvent` (the single insertion path) and, when an
// active competition is set, fans out via `wsBroadcast` on the
// `readout:<competitionId>` channel.
//
// Codex review C-H2 (HIGH): card_read payload mirrors Phase 0's CardReadEvent
// shape exactly — top-level start/finish/check/clear HalfDayClock fields +
// card_holder + punch_count + punches[]. The helper
// `apps/edge/src/si/cardReadPayload.ts` builds the exact NdjsonEmitter shape;
// the EventPayload `card_read` arm imports CardReadEvent's component types
// (HalfDayClock + NdjsonPunch) from @fartola/sportident so any drift surfaces
// at TS-compile time (T-PAYLOAD-DRIFT mitigation).
//
// No-active-competition contract (T-IDLE-CHANNEL-LEAK mitigation): when
// `getActiveCompetitionId()` returns null, the event still persists with
// `competition_id=null` (forensic value preserved) BUT `wsBroadcast` is NOT
// called. No phantom 'readout:__idle__' channel is fabricated.
//
// Analog: `packages/sportident/src/bin/fartola-readout.ts` lines 187-254 — the
// same 5-event surface (cardInserted, cardRead, cardRemoved, frameError,
// connectionChanged) with NDJSON output swapped for SQLite + WS.
//
// Locked by:
// - .planning/phases/01-single-laptop-training-mvp/01-06-PLAN.md task 1
// - .planning/phases/01-single-laptop-training-mvp/01-RESEARCH.md §"Code
//   Examples — Wire SI events into the SQLite event log"
// - .planning/phases/01-single-laptop-training-mvp/01-PATTERNS.md
//   §"apps/edge/src/si/bridge.ts" + §S-2 sink injection + §S-3 lazy native
// - .planning/phases/01-single-laptop-training-mvp/01-REVIEWS.md §C-H2

import type { SiMainStation, BaseSiCard, FrameError, ConnectionState } from '@fartola/sportident';
import { readoutChannel } from '@fartola/shared-types';
import type { ChannelName } from '@fartola/shared-types';

import { and, asc, eq } from 'drizzle-orm';

import { cardTypeFromNumber } from './cardType.ts';
import { buildCardReadPayload } from './cardReadPayload.ts';
import { insertEvent } from './eventInserter.ts';
import type { DbHandle } from '../db/index.ts';
import type { ProjectionStore } from '../projection/store.ts';
import type { PrinterSink, PrintEnvelope, ReceiptData, ReceiptTemplate } from '../print/sink.ts';
import {
  competitors,
  classes as classesTable,
  courses,
  courseControls,
  controls as controlsTable,
} from '../db/schema.ts';
import { skogisFromInput } from '@fartola/shared-types';

/** Hex-encode a byte buffer for `frame_error.raw`. Mirrors the convention
 * used by NdjsonEmitter (uppercase hex pairs joined by spaces). */
function toHexBytes(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

export interface BridgeOpts {
  /** Open SQLite handle from plan 02 (`openDatabase`). */
  handle: DbHandle;
  /** Stable per-install node id (plan 02 `ensureNodeId`). */
  nodeId: string;
  /** Returns the operator-selected active competition id, or null when no
   * competition is active (idle bridge). Read on every event — the bridge
   * holds no cached value of its own. */
  getActiveCompetitionId: () => string | null;
  /** WS fan-out hook. The bridge calls this only when
   * getActiveCompetitionId() !== null (T-IDLE-CHANNEL-LEAK mitigation). */
  broadcast: (
    channel: ChannelName,
    envelope: { type: string; payload: unknown; seq?: number }
  ) => void;
  /** Plan 08 — projection-store hook. The bridge calls
   * `projectionStore.markDirty(id)` after every event that COULD change
   * the projection (card_inserted, card_read) — but ONLY when
   * getActiveCompetitionId() !== null. card_removed / frame_error /
   * connection_changed never mark dirty (they don't influence the
   * projection). B-2 contract: with no active competition, neither
   * broadcast nor markDirty fire. */
  projectionStore: ProjectionStore;
  /** Plan 15 — auto-print path. Wired in the bin (apps/edge/src/bin/
   * fartola.ts) from app.printerSink. Optional so plan-06 / plan-08
   * tests that don't exercise auto-print can keep their existing
   * fixtures untouched (those tests gate the auto-print enqueue path
   * behind getCompetition returning a row with auto_print=true; without
   * the printerSink injected, auto-print stays silent). */
  printerSink?: PrinterSink;
  /** Plan 15 — competition row lookup for the auto-print gate. Returns
   * null when the competition doesn't exist (race with delete) or when
   * the bin chose not to wire the auto-print path. */
  getCompetition?: (competitionId: string) => {
    id: string;
    name: string;
    date: string;
    receipt_template: ReceiptTemplate;
    auto_print: boolean;
  } | null;
  /** Plan 15 — override of the auto-print delay (default 400ms; UI-SPEC
   * §"Readout view live behavior"). Tests pass 0 alongside fake timers
   * for deterministic 400ms assertions. */
  autoPrintDelayMs?: number;
}

export interface AttachedBridge {
  /** Unsubscribe all 5 station listeners. Idempotent. */
  detach: () => void;
}

/**
 * Attach the 5-event station listener set to an opened SiMainStation. Returns
 * a handle whose `detach()` removes every listener so the caller can swap in
 * a fresh station after a reconnect.
 *
 * The implementation is intentionally side-effect free at module scope —
 * importing this file does NOT subscribe; attach must be called explicitly.
 */
export function attachBridge(station: SiMainStation, opts: BridgeOpts): AttachedBridge {
  /** Plan 15 — track pending setTimeout ids for the auto-print delay so
   * detach() can clear them (otherwise a fake-timer test's pending
   * timeout leaks across teardown). */
  const pendingAutoPrints = new Set<ReturnType<typeof setTimeout>>();
  const autoPrintDelayMs = opts.autoPrintDelayMs ?? 400;

  /** Plan 06 + plan 08 LOCKED conditional. The B-2 contract: when no active
   * competition is set, neither broadcast nor markDirty fire. card_inserted +
   * card_read mark the projection dirty so the WS results channel re-pushes
   * within the debounce window; the other three events don't influence the
   * projection. */
  function maybeBroadcastAndMarkDirty(
    type: string,
    payload: unknown,
    seq: number,
    markDirty: boolean
  ): void {
    const activeId = opts.getActiveCompetitionId();
    if (activeId === null) return; // T-IDLE-CHANNEL-LEAK + B-2 + plan-08 markDirty skip
    opts.broadcast(readoutChannel(activeId), { type, payload, seq });
    if (markDirty) opts.projectionStore.markDirty(activeId);
  }

  /** Plan 15 LOCKED — auto-print enqueue path. C-M2 contract: this
   * function calls projectionStore.recomputeNow synchronously inside the
   * 400ms setTimeout callback BEFORE reading projection state. The
   * 50ms-debounced markDirty path (plan 08) may not have completed by
   * 400ms on CPU-bound recomputes, so the explicit recompute here
   * guarantees the just-read card is reflected in the print envelope.
   * Unknown-card race (walk-up not yet completed): we skip the print
   * with a stderr warning rather than fabricating an empty envelope. */
  function enqueueAutoPrint(activeId: string, cardNumber: number): void {
    if (opts.printerSink === undefined) return;
    // Force-fresh projection (C-M2). recomputeNow is synchronous.
    const projection = opts.projectionStore.recomputeNow(activeId);
    if (projection === null) {
      process.stderr.write(`auto-print skipped: projection unavailable for ${activeId}\n`);
      return;
    }
    // Resolve competitor by card_number.
    const competitorRow = opts.handle.db
      .select()
      .from(competitors)
      .where(and(eq(competitors.competitionId, activeId), eq(competitors.cardNumber, cardNumber)))
      .get();
    if (!competitorRow) {
      process.stderr.write(
        `auto-print skipped: unknown card ${cardNumber} in competition ${activeId}\n`
      );
      return;
    }
    const view = projection.competitors.get(competitorRow.id);
    if (!view) {
      process.stderr.write(
        `auto-print skipped: competitor ${competitorRow.id} absent from recomputed projection\n`
      );
      return;
    }
    const comp = opts.getCompetition?.(activeId);
    if (!comp) return;
    const classRow = opts.handle.db
      .select()
      .from(classesTable)
      .where(eq(classesTable.id, competitorRow.classId))
      .get();
    if (!classRow) return;
    // 02.1-14 Task 4: class.course_id first, legacy courses.class_id fallback.
    const courseRow = opts.handle.db
      .select()
      .from(courses)
      .where(
        classRow.courseId !== null
          ? eq(courses.id, classRow.courseId)
          : and(eq(courses.competitionId, activeId), eq(courses.classId, classRow.id))
      )
      .get();
    const controlCodes: number[] = [];
    if (courseRow) {
      const rows = opts.handle.db
        .select({ code: controlsTable.code, idx: courseControls.orderIdx })
        .from(courseControls)
        .innerJoin(controlsTable, eq(controlsTable.id, courseControls.controlId))
        .where(eq(courseControls.courseId, courseRow.id))
        .orderBy(asc(courseControls.orderIdx))
        .all();
      for (const r of rows) controlCodes.push(r.code);
    }
    const classRows = projection.results_by_class.get(classRow.id) ?? [];
    const selfRow = classRows.find((r) => r.competitor_id === competitorRow.id);
    const leaderRow = classRows.find((r) => r.place === 1);
    const template: ReceiptTemplate = comp.receipt_template;

    let skogisStats: ReceiptData['skogisStats'] | undefined;
    if (template === 'kids') {
      const sk = skogisFromInput({
        cardNumber: view.card_number ?? 0,
        name: view.name,
        club: view.club,
        classId: view.class_id,
        status: view.status,
        place: selfRow?.place ?? null,
        controlCount: view.latest_punches.length,
        bestLegs: 0,
        totalLegs: Math.max(1, view.latest_punches.length),
        startersInClass: Math.max(1, classRows.length),
      });
      skogisStats = sk.stats;
    }

    const data: ReceiptData = {
      competitor: view,
      competition: {
        id: comp.id,
        name: comp.name,
        date: comp.date,
        receipt_template: comp.receipt_template,
        auto_print: comp.auto_print,
      },
      classObj: { id: classRow.id, name: classRow.name },
      course: courseRow
        ? {
            id: courseRow.id,
            name: courseRow.name,
            length_m: courseRow.lengthM,
            climb_m: courseRow.climbM,
            control_codes: controlCodes,
          }
        : { id: '', name: '', length_m: null, climb_m: null, control_codes: [] },
      placeContext: {
        place: selfRow?.place ?? null,
        behind_leader_ms: selfRow?.behind_leader_ms ?? null,
        leader_name: leaderRow?.name ?? null,
        class_rows: classRows,
      },
      ...(skogisStats !== undefined ? { skogisStats } : {}),
    };
    const envelope: PrintEnvelope = {
      template,
      competition_id: activeId,
      card_number: view.card_number ?? 0,
      data,
    };
    opts.printerSink.print(envelope).catch((err: Error) => {
      process.stderr.write(`auto-print failed: ${err.message}\n`);
    });
  }

  const onCardInserted = (card: BaseSiCard): void => {
    const activeId = opts.getActiveCompetitionId();
    const payload = {
      event_type: 'card_inserted' as const,
      card_number: card.cardNumber,
      card_type: cardTypeFromNumber(card.cardNumber),
    };
    const r = insertEvent(opts.handle, opts.nodeId, 'card_inserted', Date.now(), payload, activeId);
    maybeBroadcastAndMarkDirty('card_inserted', payload, r.local_seq, true);
  };

  const onCardRead = (card: BaseSiCard): void => {
    // C-H2 LOCKED: full CardReadEvent shape via buildCardReadPayload — mirrors
    // NdjsonEmitter.card_read byte-for-byte. payload.start / .finish / .check /
    // .clear are top-level HalfDayClock fields; punches[] is sourced from
    // card.raceResult.punches (NdjsonEmitter line 253); card_holder is
    // competitor metadata (NOT punches).
    const payload = buildCardReadPayload(card);
    const activeId = opts.getActiveCompetitionId();
    const r = insertEvent(opts.handle, opts.nodeId, 'card_read', Date.now(), payload, activeId);
    maybeBroadcastAndMarkDirty('card_read', payload, r.local_seq, true);

    // Plan 15 — auto-print gate. Fires the print ~400ms after the
    // card_read row is committed (matches UI-SPEC §"Readout view live
    // behavior" timing). Gated by activeCompetitionId !== null AND
    // competition.auto_print === true. The C-M2 contract lives in
    // enqueueAutoPrint, which awaits recomputeNow inline before reading
    // projection state.
    if (activeId !== null && opts.printerSink !== undefined && opts.getCompetition !== undefined) {
      const comp = opts.getCompetition(activeId);
      if (comp?.auto_print === true) {
        const cardNumber = card.cardNumber;
        const timeoutId = setTimeout(() => {
          pendingAutoPrints.delete(timeoutId);
          enqueueAutoPrint(activeId, cardNumber);
        }, autoPrintDelayMs);
        pendingAutoPrints.add(timeoutId);
      }
    }
  };

  const onCardRemoved = (cardNumber: number): void => {
    const activeId = opts.getActiveCompetitionId();
    const payload = {
      event_type: 'card_removed' as const,
      card_number: cardNumber,
    };
    const r = insertEvent(opts.handle, opts.nodeId, 'card_removed', Date.now(), payload, activeId);
    maybeBroadcastAndMarkDirty('card_removed', payload, r.local_seq, false);
  };

  const onFrameError = (err: FrameError): void => {
    const activeId = opts.getActiveCompetitionId();
    const payload = {
      event_type: 'frame_error' as const,
      // schema's frame_error arm is { reason, raw }. Phase 0's FrameError
      // carries error_code (the typed cause) + raw_bytes (the consumed
      // bytes); map to the schema's shape so the payload stays JSON-stable.
      reason: err.error_code,
      raw: toHexBytes(err.raw_bytes),
    };
    const r = insertEvent(opts.handle, opts.nodeId, 'frame_error', Date.now(), payload, activeId);
    maybeBroadcastAndMarkDirty('frame_error', payload, r.local_seq, false);
  };

  const onConnectionChanged = (state: ConnectionState): void => {
    // Phase 0's SiMainStation always emits `connectionChanged` with a single
    // `state` arg (see packages/sportident/src/SiStation/SiMainStation.ts
    // `_emitState`). The schema arm allows an optional `error` field for
    // Phase 1 surface evolution — for now the bridge never populates it.
    const activeId = opts.getActiveCompetitionId();
    const payload = {
      event_type: 'connection_changed' as const,
      state,
    };
    const r = insertEvent(
      opts.handle,
      opts.nodeId,
      'connection_changed',
      Date.now(),
      payload,
      activeId
    );
    maybeBroadcastAndMarkDirty('connection_changed', payload, r.local_seq, false);
  };

  station.on('cardInserted', onCardInserted);
  station.on('cardRead', onCardRead);
  station.on('cardRemoved', onCardRemoved);
  station.on('frameError', onFrameError);
  station.on('connectionChanged', onConnectionChanged);

  let detached = false;
  return {
    detach(): void {
      if (detached) return;
      detached = true;
      // Plan 15 — clear any pending auto-print timeouts so they don't
      // fire after teardown (matters for fake-timer tests + Fastify
      // onClose cleanup; otherwise a tick after detach() emits an
      // unexpected print or hits a closed db handle).
      for (const t of pendingAutoPrints) clearTimeout(t);
      pendingAutoPrints.clear();
      station.off('cardInserted', onCardInserted);
      station.off('cardRead', onCardRead);
      station.off('cardRemoved', onCardRemoved);
      station.off('frameError', onFrameError);
      station.off('connectionChanged', onConnectionChanged);
    },
  };
}
