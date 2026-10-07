// Authored for fartola. Not ported from upstream.
//
// Shared WS card-event subscription. Locked by 02-02b-PLAN.md task 2.
// Replaces inline WS code in ReadoutView (Phase 1) so /registration
// (Plan 2b) and /readout consume the same plumbing.
//
// Why a service instead of two parallel inline implementations: the
// connect/preSubscribe/replay-unwrap dance is identical for both
// screens; only the dispatch policy differs. /readout wants
// classification-aware card_reads (only top.unmatched cards trigger
// walkup); /registration wants every card_read to enqueue
// (classification='unclassified'). The CardSubscriptionOpts hook shape
// captures both modes without duplicating the WS wiring.
//
// Interface refinement (per task 0):
//   - onCardRead(cardNumber, hint, classification): unified callback;
//     /readout supplies classifyCard so classification resolves to
//     'unknown'|'known'; /registration omits classifyCard so it
//     always receives 'unclassified' and enqueues unconditionally.
//   - onConnectionChange: forwarded for bridgeStatus.set on /readout
//     (optional on /registration).
//   - onOtherEnvelope: passthrough for envelope types not handled by
//     the service (manual_dnf, card_bound, results_update, meos_merge,
//     hired_card_returned). /readout uses this to keep its refetch
//     dispatch logic in-screen; /registration usually ignores.
//
// Locked by:
// - .planning/phases/02-4-klubbs-mvp/02-02b-PLAN.md task 2

import { WsClient } from '#lib/ws/client.ts';
import { readoutChannel, type WsEnvelope, type ChannelName } from '@fartola/shared-types';

export type CardClassification = 'known' | 'unknown' | 'unclassified';

export type ConnectionState = 'closed' | 'opening' | 'open' | 'error';

export interface CardSubscriptionOpts {
  competitionId: string;
  /** Fires on every card_read envelope (live + replay-unwrapped).
   * classification is resolved by `classifyCard` when supplied; falls
   * back to 'unclassified' when omitted. /registration desk omits it
   * (every read enqueues); /readout supplies it (only 'unknown' cards
   * trigger walkup-redirect). */
  onCardRead: (
    cardNumber: number,
    cardHolderHint: string | null,
    classification: CardClassification
  ) => void;
  /** Optional async resolver — given a cardNumber, returns whether
   * this card is unmatched in the current projection plus the hint to
   * pass to onCardRead. /readout supplies this so the existing
   * silent-drop-when-modal-open semantics keep working. If omitted,
   * classification is always 'unclassified'. */
  classifyCard?: (
    cardNumber: number
  ) => Promise<{ isUnmatched: boolean; cardHolderHint: string | null }>;
  /** Connection-state callback. /readout wires to bridgeStatus.set;
   * /registration may use it for a small status pill or ignore. */
  onConnectionChange?: (state: ConnectionState) => void;
  /** Optional: extra envelope handler for non-card_read,
   * non-connection_changed types (manual_dnf, card_bound,
   * results_update, meos_merge, hired_card_returned, ...). /readout
   * supplies one that refetches its REST projections; /registration
   * usually ignores. The handler receives the FLAT inner envelope —
   * replay wrappers are already unwrapped. */
  onOtherEnvelope?: (eventType: string, payload: unknown) => void;
  /** Optional extra channels to pre-subscribe beyond readoutChannel.
   * /readout subscribes to resultsChannel as well. */
  extraChannels?: ChannelName[];
  /** When true, replay-wrapped `card_read` envelopes (the server's hello
   * response with the last N historical card_reads) are IGNORED. Live
   * card_reads still fire onCardRead normally. Use this on the
   * registration-desk screen to prevent old card_reads (from before the
   * desk page mounted — e.g. the operator briefly opened /readout
   * earlier) from being enqueued as fresh registration candidates.
   * /readout sets this false (default) so its recent-reads history can
   * back-fill from server-side replay. Code-review F-002 (codex) BLOCKER
   * fix. */
  ignoreReplayCardReads?: boolean;
}

export interface CardSubscriptionHandle {
  connect(): void;
  disconnect(): void;
}

export function createCardSubscription(opts: CardSubscriptionOpts): CardSubscriptionHandle {
  let wsClient: WsClient | null = null;
  let closed = false;

  function handleWs(env: WsEnvelope): void {
    // Replay envelopes wrap the live event payload one layer deeper:
    // { type: 'replay', payload: { event_type, ...fields } }. Live
    // broadcasts have type === event_type. Unwrap and re-dispatch so
    // both paths share the same downstream logic.
    if (env.type === 'replay') {
      const inner = env.payload as { event_type?: string } | null;
      if (!inner || typeof inner.event_type !== 'string') return;
      // F-002 (codex) BLOCKER guard: callers that don't want historical
      // card_reads (registration-desk) opt out via ignoreReplayCardReads.
      // Other replayed envelope types (results_update, card_bound, etc.)
      // still pass through so /readout can rehydrate its projection.
      if (opts.ignoreReplayCardReads === true && inner.event_type === 'card_read') return;
      dispatch(inner.event_type, inner);
      return;
    }
    dispatch(env.type, env.payload);
  }

  function dispatch(eventType: string, payload: unknown): void {
    if (eventType === 'card_read') {
      const card = payload as { card_number?: unknown; card_holder?: unknown } | null;
      const cardNumber = typeof card?.card_number === 'number' ? card.card_number : null;
      if (cardNumber === null || !Number.isInteger(cardNumber) || cardNumber <= 0) return;
      const inlineHint =
        typeof card?.card_holder === 'string' && card.card_holder.length > 0
          ? (card.card_holder as string)
          : null;
      if (opts.classifyCard) {
        void opts
          .classifyCard(cardNumber)
          .then(({ isUnmatched, cardHolderHint }) => {
            opts.onCardRead(
              cardNumber,
              cardHolderHint ?? inlineHint,
              isUnmatched ? 'unknown' : 'known'
            );
          })
          .catch(() => {
            // Resolver failed — best-effort treat as unclassified so
            // the caller still sees the read and can decide.
            opts.onCardRead(cardNumber, inlineHint, 'unclassified');
          });
      } else {
        opts.onCardRead(cardNumber, inlineHint, 'unclassified');
      }
      return;
    }
    if (eventType === 'connection_changed') {
      const state = (payload as { state?: string } | null)?.state;
      if (state === 'open' || state === 'opening' || state === 'closed' || state === 'error') {
        opts.onConnectionChange?.(state);
      }
      return;
    }
    opts.onOtherEnvelope?.(eventType, payload);
  }

  return {
    connect(): void {
      if (closed) return;
      if (typeof window === 'undefined') return;
      const wsUrl =
        window.location.protocol === 'https:'
          ? `wss://${window.location.host}/ws`
          : `ws://${window.location.host}/ws`;
      wsClient = new WsClient(wsUrl, handleWs);
      wsClient.preSubscribe(readoutChannel(opts.competitionId));
      if (opts.extraChannels) {
        for (const ch of opts.extraChannels) wsClient.preSubscribe(ch);
      }
      wsClient.connect();
    },
    disconnect(): void {
      closed = true;
      if (wsClient) {
        wsClient.close();
        wsClient = null;
      }
    },
  };
}
