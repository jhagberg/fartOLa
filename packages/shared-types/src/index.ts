// Authored for fartola. Not ported from upstream.
//
// Public API surface for @fartola/shared-types — the shared TS contract
// between apps/edge/ (Fastify bridge) and apps/web/ (SvelteKit PWA).
// Pure-TS package, no build step; consumers rely on root tsconfig's
// `allowImportingTsExtensions` (CONTEXT D-08).
//
// Named exports only, no default — matches packages/sportident/src/index.ts.
// Sectioned barrels make grep-by-section easy in downstream PRs.
//
// Plan 04 lifts dtos.ts to real Zod schemas; the inferred TS types share the
// schema name (TS supports a value + a type with the same identifier when
// declared via `z.infer<typeof X>` aliased back to the same const name). The
// barrel re-exports both the schema (value) and the type. Consumers that
// need only types can use `import type { ... }`; consumers that need the
// schema for `.safeParse` use `import { ... }`.

// --- NDJSON events ---------------------------------------------------------
export type {
  NdjsonEvent,
  NdjsonBase,
  CardType,
  HalfDayClock,
  NdjsonPunch,
  ConnectionChangedEvent,
  CardInsertedEvent,
  CardReadEvent,
  CardRemovedEvent,
  FrameErrorEvent,
} from './events.ts';
export { EVENT_SCHEMA_VERSION } from './events.ts';

// --- REST DTOs — Zod schemas + inferred types ------------------------------
// Schemas (values) and inferred types share the same identifier name. Plan
// 04 wires SvelteKit forms + Fastify route handlers against these.
export {
  CompetitionDTO,
  CompetitionCreateInput,
  CompetitionPatchInput,
  ClassDTO,
  ClassCreateInput,
  CourseDTO,
  CourseCreateInput,
  CourseControlDTO,
  CompetitorDTO,
  CompetitorCreateInput,
  ManualDnfInput,
  UnDnfInput,
  ManualStatusInput,
  ClearManualStatusInput,
  VoidLegInput,
  UnvoidLegInput,
  ClubDTO,
  EventorLookupCandidate,
  EventorLookupHit,
  EventorLookupMany,
  EventorLookupMiss,
  EventorNameSuggestion,
  EventorClubSuggestion,
  EventorStatusDTO,
  HiredCardRow,
  HiredCardsListResponse,
  HiredCardReturnResponse,
  HiredCardOpen,
  HealthDTO,
} from './dtos.ts';
export type { EventorLookupResult } from './dtos.ts';

// --- DB DTO interfaces (subset without a Zod schema) -----------------------
// EventDTO + ControlDTO stay as plain interfaces; the events projection
// (plan 08) + control management (post-Phase-1) will lift them when they
// need server-side validation.
export type { EventDTO, ControlDTO } from './db.ts';

// --- WebSocket envelopes ---------------------------------------------------
export type { ChannelName, WsEnvelope, WsHelloMessage, WsSubscribeMessage } from './ws.ts';
export { readoutChannel, resultsChannel } from './ws.ts';

// --- Skogis (kids template generator) --------------------------------------
// Moved from apps/web/src/lib/skogis/skogis.ts in plan 15 Task 2a so the
// apps/edge ESC/POS kids template (kids-svg-to-bitmap.ts) can consume the
// same deterministic generator the UI mirror uses. The apps/web path now
// re-exports from here.
export {
  skogisFromInput,
  skogisGeometry,
  skogisDisplayName,
  skogisHash,
  skogisRng,
  SKOGIS_INK,
  SKOGIS_PAPER,
  SKOGIS_PALETTES,
  SKOGIS_SPECIES,
} from './skogis.ts';
export type {
  SkogisInput,
  SkogisDescriptor,
  SkogisPalette,
  SkogisGeometry,
  SkogisStats,
} from './skogis.ts';
