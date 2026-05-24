// Authored for fartola. Not ported from upstream.
//
// Public API surface for @fartola/sportident, per
// .planning/phases/00-hardware-proof/00-RESEARCH.md §"Open Questions for
// Planner" #6 (recommended export list).
//
// Re-exports are named (no default exports). The four card-type modules are
// imported (side-effect) so their `BaseSiCard.registerSi5Range` /
// `registerSi8Range` calls fire at consumer import time — without this, the
// registry would stay empty and `detectFromMessage` would always return
// undefined.
//
// See packages/sportident/NOTICE.md for cumulative attribution.

// --- Transport ---------------------------------------------------------------
export { SerialTransport } from './transport/SerialTransport.ts';
export type { ISerialTransport } from './transport/ISerialTransport.ts';
export { DeviceClosedError, SendTimeoutError } from './transport/errors.ts';

// --- Station ----------------------------------------------------------------
export { SiMainStation } from './SiStation/SiMainStation.ts';
export type { ConnectionState, ISiMainStation } from './SiStation/ISiMainStation.ts';

// --- Protocol primitives ----------------------------------------------------
export {
  parseAll,
  parse,
  render,
  CRC16,
  arr2date,
  arr2cardNumber,
  cardNumber2arr,
  date2arr,
  prettyMessage,
  SI_TIME_CUTOFF,
} from './siProtocol.ts';
export type {
  SiMessage,
  SiMessageWithMode,
  SiMessageWithoutMode,
  FrameError,
  FrameErrorCode,
  ParseAllOptions,
  SiMessageParseResult,
  SiMessagesParseResult,
} from './siProtocol.ts';

// --- Constants --------------------------------------------------------------
export { proto } from './constants.ts';

// --- Card decoders (side-effect imports populate the registries) ------------
export { BaseSiCard } from './SiCard/BaseSiCard.ts';
export { SiCard5 } from './SiCard/types/SiCard5.ts';
export { SiCard9 } from './SiCard/types/SiCard9.ts';
export { SiCard10 } from './SiCard/types/SiCard10.ts';
export { SIAC } from './SiCard/types/SIAC.ts';
export { ModernSiCard } from './SiCard/types/ModernSiCard.ts';
export type { IRaceResultData, IPunch } from './SiCard/IRaceResultData.ts';

// --- NDJSON output ----------------------------------------------------------
export { NdjsonEmitter, toHalfDayClock } from './output/ndjson.ts';
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
  NdjsonEmitterOpts,
} from './output/ndjson.ts';
export { emitDiagnostic } from './output/diagnostics.ts';
export { inferCardType } from './SiCard/cardTypeFromNumber.ts';

// --- Backup readout (Phase 2.1 Plan 06 — kvar-i-skogen) --------------------
export {
  readBackupMemory,
  parseBackupBlock,
  parseMemPointer,
  parseOverflowFlag,
  BLOCK_SIZE,
  MAX_ITERATIONS,
} from './SiStation/readBackup.ts';
export type { BackupRecord } from './SiStation/readBackup.ts';
