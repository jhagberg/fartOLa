#!/usr/bin/env node
// Authored for fartola. Not ported from upstream.
//
// Binary entrypoint — `fartola`. Parses argv, builds the Fastify server via
// buildServer(), and awaits app.listen({ host, port }). SIGINT closes the
// app cleanly and exits 0. Uncaught exceptions and unhandled promise
// rejections log to stderr and exit 1 (RESEARCH Pitfall 9).
//
// Plan 06 extension: the bin now owns the SI bridge lifecycle.
//   - On boot (unless --no-bridge), open the SerialTransport at --serial
//     (repeatable, path:position syntax per D-02) or --serial-path (legacy
//     alias, single reader, position=null). Constructs a BridgeLifecycle per
//     entry; events flow into the events table via insertEvent with an
//     optional reader_position field in the WS envelope.
//   - getActiveCompetitionId reads `app.activeCompetitionId` on every event
//     (no cached copy — operator toggles via /api/sessions/active-competition).
//   - On open failure / spontaneous close, retry on the 250ms/500ms/1s/2s/5s
//     backoff schedule (RESEARCH Pitfall 4 — serialport EBUSY). Never gives
//     up — operator can force an immediate retry via the "Återanslut" button
//     (POST /api/sessions/reconnect-bridge, now reconnects ALL lifecycles).
//   - The route exposing reconnect-bridge already returns 503 when
//     reconnectBridge is undefined — tests and --no-bridge boots stay clean.
//
// Plan 04 (D-02) extension: repeatable --serial flag.
//   - Multiple BridgeLifecycle instances run concurrently, one per --serial.
//   - card_read WS envelope gains reader_position field (null when omitted).
//   - GET /api/health returns per-reader status via app.bridgeLifecycles.
//   - Duplicate serial paths are rejected at startup with a fatal error.
//
// Pattern S-7: `parseArgs` + `main` are exported so unit tests can exercise
// them without booting the listener. The `isEntrypoint` guard at the bottom
// is the only place that calls main(); tests import parseArgs directly.
//
// Threat register T-WS-FAN-OUT: --bind-host defaults to 127.0.0.1. The argv
// parser refuses 0.0.0.0 unless --allow-lan is ALSO present.

import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { buildServer } from '../server.ts';
import { openDatabase } from '../db/index.ts';
import { ensureNodeId } from '../db/node-id.ts';
import type { DbHandle } from '../db/index.ts';
import { SerialTransport, SiMainStation } from '@fartola/sportident';
import { attachBridge } from '../si/bridge.ts';
import type { AttachedBridge } from '../si/bridge.ts';
import { config, competitions } from '../db/schema.ts';
import { eq } from 'drizzle-orm';
import type { PrinterSink } from '../print/sink.ts';
import { createStdoutPrinterSink } from '../print/stdout-sink.ts';
import { createNodeThermalPrinterSink, type PrinterTypeId } from '../print/escposDriver.ts';
import { createCupsPrinterSink } from '../print/cups-sink.ts';
import { scheduleDailyBackup } from '../backup/daily.ts';
import { scheduleDailyRetention } from '../privacy/retention.ts';
import { scheduleEventorBoot } from '../eventor/boot.ts';
import { resolveSecret } from '../config/secrets.ts';

/** A single serial reader entry as parsed from --serial or --serial-path. */
export interface SerialPathEntry {
  /** Absolute-resolved device path, e.g. '/dev/ttyUSB0'. */
  path: string;
  /** Operator-assigned position label ('left', 'right', or any string), or
   * null when --serial-path is used or no position suffix is provided. */
  position: string | null;
}

export interface CliOpts {
  port: number;
  bindHost: string;
  dbPath: string;
  allowLan: boolean;
  noBridge: boolean;
  /** Plan 04 (D-02) — one entry per --serial flag. Legacy --serial-path maps
   * to a single entry with position=null. Duplicate paths are rejected at
   * startup. */
  serialPaths: SerialPathEntry[];
  competitionId: string | null;
  /** Plan 17 — daily backup directory. Default './backups'. */
  backupDir: string;
  /** Plan 17 — retention scrub days (REQ-PRIV-002). Default 30. */
  retentionDays: number;
}

export type PrinterConfig =
  | { kind: 'stdout' }
  | { kind: 'cups'; queueName: string }
  | { kind: 'direct'; printerType: PrinterTypeId };

const DEFAULT_CUPS_QUEUE = 'TSP143--STR_T-001-';

function resolvePrinterType(rawType: string | undefined): PrinterTypeId {
  return rawType === 'epson' || rawType === 'brother' ? rawType : 'star';
}

export function resolvePrinterConfig(
  env: Record<string, string | undefined> = process.env
): PrinterConfig {
  const mode = env['FARTOLA_PRINTER'];
  if (mode === 'stdout') return { kind: 'stdout' };
  if (mode === 'direct' || mode === 'escpos') {
    return { kind: 'direct', printerType: resolvePrinterType(env['FARTOLA_PRINTER_TYPE']) };
  }
  return {
    kind: 'cups',
    queueName: env['FARTOLA_CUPS_QUEUE']?.trim() || DEFAULT_CUPS_QUEUE,
  };
}

function createPrinterSink(config: PrinterConfig): PrinterSink {
  if (config.kind === 'stdout') return createStdoutPrinterSink();
  if (config.kind === 'direct') {
    return createNodeThermalPrinterSink({ printerType: config.printerType });
  }
  return createCupsPrinterSink({ queueName: config.queueName });
}

const HELP = `fartola: fartOLa edge bridge (Fastify HTTP/WS + SQLite event log + SI bridge).

Usage:
  fartola [options]

Options:
  --port <int>             HTTP port (default 3000)
  --bind-host <host>       Listen host (default 127.0.0.1). Use of 0.0.0.0
                           or any non-loopback address requires --allow-lan
                           as a guard against accidental LAN exposure.
  --db-path <path>         SQLite database path (default ./fartola.db).
  --serial <path>[:<pos>]  SI reader device path with optional position label
                           (e.g. --serial /dev/ttyUSB0:left). Repeatable for
                           multiple readers (D-02). Ignored when --no-bridge
                           is set. Duplicate device paths are rejected.
  --serial-path <path>     DEPRECATED: use --serial instead. Single reader,
                           no position label. Still works for backward compat.
                           Default /dev/ttyUSB0 when neither flag is given.
  --no-bridge              Skip SI bridge attach. Useful for offline tests,
                           UI dev, and CI where /dev/ttyUSB0 is unavailable.
  --competition-id <id>    Set the bridge's active competition at boot.
                           Equivalent to POST /api/sessions/active-competition
                           after listen. Overrides whatever the config table
                           had persisted from a prior run.
  --allow-lan              Permit non-loopback --bind-host values.
  --backup-dir <path>      Daily SQLite backup directory (default ./backups).
                           Snapshots written at local midnight via
                           db.backup(); last 7 retained, older pruned.
                           REQ-OPS-003.
  --retention-days <int>   PII retention window in days (default 30).
                           Competitor name + club anonymised when the
                           parent competition's date is older. REQ-PRIV-002.
  --help, -h               Show this help.
`;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', '0']);

function isLoopback(host: string): boolean {
  if (LOOPBACK_HOSTS.has(host)) return host !== '0';
  if (host.startsWith('127.')) return true;
  return false;
}

/** Parse a --serial value of the form `<path>[:<position>]`.
 * The colon is treated as a separator only when the path does not already
 * look like an absolute device path containing a second colon (Windows COM
 * ports aside, POSIX device paths never contain colons). */
function parseSerialEntry(raw: string): SerialPathEntry {
  const colonIdx = raw.lastIndexOf(':');
  if (colonIdx > 0) {
    const maybePos = raw.slice(colonIdx + 1);
    // Accept any non-empty string after the last colon as the position label.
    // The path segment before the colon must be non-empty.
    const maybePath = raw.slice(0, colonIdx);
    if (maybePath.length > 0 && maybePos.length > 0) {
      return { path: maybePath, position: maybePos };
    }
  }
  return { path: raw, position: null };
}

export function parseArgs(argv: string[]): CliOpts {
  /** Accumulate --serial entries; we'll apply the default after the loop. */
  const rawSerialPaths: SerialPathEntry[] = [];
  /** Track whether the legacy --serial-path flag was used. */
  let legacySerialPath: string | null = null;

  const opts: CliOpts = {
    port: 3000,
    bindHost: '127.0.0.1',
    dbPath: './fartola.db',
    allowLan: false,
    noBridge: false,
    serialPaths: [], // filled after loop
    competitionId: null,
    backupDir: './backups',
    retentionDays: 30,
  };

  const valueFor = (
    flag: string,
    raw: string,
    index: number
  ): { value: string; consumed: number } => {
    if (raw.startsWith(`${flag}=`)) {
      const value = raw.slice(flag.length + 1);
      if (value.length === 0) throw new Error(`${flag} requires a value`);
      return { value, consumed: 0 };
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('-')) throw new Error(`${flag} requires a value`);
    return { value: next, consumed: 1 };
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    // POSIX `--` end-of-options separator. pnpm 9+ forwards a bare `--` from
    // `pnpm run dev -- --port=3001` into the script's argv on some platforms
    // (caught in CI 2026-05-19); we treat it as a no-op so the CLI stays
    // portable across pnpm versions.
    if (a === '--') {
      continue;
    }
    if (a === '--port' || a.startsWith('--port=')) {
      const { value, consumed } = valueFor('--port', a, i);
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
        throw new Error(`--port must be an integer in 1..65535 (got: ${value})`);
      }
      opts.port = parsed;
      i += consumed;
    } else if (a === '--bind-host' || a.startsWith('--bind-host=')) {
      const { value, consumed } = valueFor('--bind-host', a, i);
      opts.bindHost = value;
      i += consumed;
    } else if (a === '--db-path' || a.startsWith('--db-path=')) {
      const { value, consumed } = valueFor('--db-path', a, i);
      opts.dbPath = value;
      i += consumed;
    } else if (a === '--serial' || a.startsWith('--serial=')) {
      const { value, consumed } = valueFor('--serial', a, i);
      rawSerialPaths.push(parseSerialEntry(value));
      i += consumed;
    } else if (a === '--serial-path' || a.startsWith('--serial-path=')) {
      const { value, consumed } = valueFor('--serial-path', a, i);
      legacySerialPath = value;
      i += consumed;
    } else if (a === '--no-bridge') {
      opts.noBridge = true;
    } else if (a === '--competition-id' || a.startsWith('--competition-id=')) {
      const { value, consumed } = valueFor('--competition-id', a, i);
      opts.competitionId = value;
      i += consumed;
    } else if (a === '--backup-dir' || a.startsWith('--backup-dir=')) {
      const { value, consumed } = valueFor('--backup-dir', a, i);
      opts.backupDir = value;
      i += consumed;
    } else if (a === '--retention-days' || a.startsWith('--retention-days=')) {
      const { value, consumed } = valueFor('--retention-days', a, i);
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`--retention-days must be a positive integer (got: ${value})`);
      }
      opts.retentionDays = parsed;
      i += consumed;
    } else if (a === '--allow-lan') {
      opts.allowLan = true;
    } else if (a === '--help' || a === '-h') {
      process.stdout.write(HELP);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }

  if (!isLoopback(opts.bindHost) && !opts.allowLan) {
    throw new Error(
      `--bind-host '${opts.bindHost}' would expose the bridge to the LAN. ` +
        `Re-run with --allow-lan if that is intentional.`
    );
  }

  // Build serialPaths from --serial entries + legacy --serial-path.
  // Both flags may coexist (e.g. a script that adds --serial alongside an
  // existing --serial-path invocation); duplicates across both are caught.
  if (legacySerialPath !== null) {
    rawSerialPaths.push({ path: legacySerialPath, position: null });
  }

  if (rawSerialPaths.length === 0) {
    // No serial flag given — use the historical default device.
    opts.serialPaths = [{ path: '/dev/ttyUSB0', position: null }];
  } else {
    // Resolve to absolute paths for duplicate detection (e.g. ./ttyUSB0 vs
    // /dev/ttyUSB0 are different strings but the same inode on most systems;
    // we don't stat here — we only catch identical string paths after resolution).
    const seen = new Map<string, SerialPathEntry>();
    for (const entry of rawSerialPaths) {
      const absPath = resolvePath(entry.path);
      if (seen.has(absPath)) {
        const msg = `--serial: duplicate serial path '${entry.path}' — each device may only appear once`;
        process.stderr.write(`fatal: ${msg}\n`);
        process.exit(1);
      }
      seen.set(absPath, entry);
    }
    opts.serialPaths = Array.from(seen.values());
  }

  return opts;
}

/** Reconnect backoff schedule (RESEARCH Pitfall 4 — serialport EBUSY). */
const BACKOFF_MS = [250, 500, 1000, 2000, 5000] as const;

/** Per-reader status snapshot returned by BridgeLifecycle.status(). */
export interface BridgeReaderStatus {
  path: string;
  position: string | null;
  connected: boolean;
  lastPunchAt: number | null;
}

/** Lifecycle manager for the SI bridge. Owns the current SerialTransport +
 * SiMainStation + AttachedBridge. Reconnect runs the backoff chain; enters
 * steady-state at 5 s intervals (never gives up — operator can force an
 * immediate retry via POST /api/sessions/reconnect-bridge). */
class BridgeLifecycle {
  private transport: SerialTransport | null = null;
  private station: SiMainStation | null = null;
  private attached: AttachedBridge | null = null;
  private shutdownRequested = false;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private openInFlight = false;
  private isConnected = false;
  private lastPunchAt: number | null = null;
  private readonly app: FastifyInstance;
  private readonly handle: DbHandle;
  private readonly nodeId: string;
  private readonly serialPath: string;
  readonly position: string | null;

  constructor(
    app: FastifyInstance,
    handle: DbHandle,
    nodeId: string,
    serialPath: string,
    position: string | null = null
  ) {
    this.app = app;
    this.handle = handle;
    this.nodeId = nodeId;
    this.serialPath = serialPath;
    this.position = position;
  }

  /** Returns a snapshot of the reader's current state for /api/health. */
  status(): BridgeReaderStatus {
    return {
      path: this.serialPath,
      position: this.position,
      connected: this.isConnected,
      lastPunchAt: this.lastPunchAt,
    };
  }

  async start(): Promise<void> {
    this.shutdownRequested = false;
    await this.openAttempt();
  }

  private async openAttempt(): Promise<void> {
    if (this.shutdownRequested) return;
    if (this.openInFlight) return;
    this.openInFlight = true;
    this.app.bridgeState = 'opening';
    this.app.log.info({ path: this.serialPath }, 'SI bridge open attempt');
    try {
      // Always tear down any prior transport/station before opening a new
      // one — otherwise the previous SerialPort fd stays open and EAGAIN
      // ("Cannot lock port") fires on the next open.
      await this.teardownCurrent();
      const transport = new SerialTransport({ path: this.serialPath, baudRate: 38400 });
      const station = new SiMainStation(transport);
      const readActiveCompetitionId = (): string | null => {
        // Cross-plugin scope: `app.activeCompetitionId` mutated by the
        // sessions plugin doesn't propagate to this outer-scope reader
        // (Fastify avvio encapsulation). Read the canonical value from
        // the config table instead — same fix used by the readout route
        // in plan 01-09. Falls back to app.activeCompetitionId for tests
        // that decorate it directly without persisting.
        const row = this.handle.db
          .select({ value: config.value })
          .from(config)
          .where(eq(config.key, 'active_competition_id'))
          .get();
        return row?.value ?? this.app.activeCompetitionId ?? null;
      };
      const attached = attachBridge(station, {
        handle: this.handle,
        nodeId: this.nodeId,
        getActiveCompetitionId: readActiveCompetitionId,
        // Plan 04 (D-02): wrap the broadcast so card_read envelopes include
        // reader_position in the payload. Also tracks lastPunchAt for the
        // health endpoint. Other event types pass through unchanged.
        broadcast: (channel, envelope) => {
          if (envelope.type === 'card_read') {
            this.lastPunchAt = Date.now();
            if (this.position !== null) {
              const augmented = {
                ...envelope,
                payload: {
                  ...(envelope.payload as Record<string, unknown>),
                  reader_position: this.position,
                },
              };
              this.app.wsBroadcast(channel, augmented);
              return;
            }
          }
          this.app.wsBroadcast(channel, envelope);
        },
        // Plan 08: bridge marks the projection dirty after relevant events so
        // the WS results channel + REST GET /api/competitions/:id/results
        // re-derive within the debounce window. Skipped when no active
        // competition is set (B-2 contract).
        projectionStore: this.app.projectionStore,
        // Plan 15: auto-print path. Gated by activeCompetitionId !== null
        // AND competition.auto_print === true. The bridge calls
        // printerSink.print ~400ms after the card_read insert (the
        // recomputeNow C-M2 contract lives inside the bridge's
        // enqueueAutoPrint).
        printerSink: this.app.printerSink,
        getCompetition: (competitionId) => {
          const row = this.handle.db
            .select()
            .from(competitions)
            .where(eq(competitions.id, competitionId))
            .get();
          if (!row) return null;
          return {
            id: row.id,
            name: row.name,
            date: row.date,
            receipt_template: row.receiptTemplate as
              | 'classic'
              | 'standing'
              | 'detailed'
              | 'top4'
              | 'minimal'
              | 'kids',
            auto_print: row.autoPrint,
          };
        },
      });
      // Codex CR-001: SiMainStation and SerialTransport both extend
      // EventEmitter and emit 'error' on the wire-level surface. Node
      // throws (and crashes the edge process) if an EventEmitter emits
      // 'error' with no listener attached. Wire the listeners BEFORE
      // transport.open() so a synchronous open-time error is caught
      // here, not by the unhandledException path. Both listeners route
      // through scheduleReconnect — the existing backoff chain handles
      // the next attempt; we only log here.
      transport.on('error', (err) => {
        this.app.log.warn({ err: errMsg(err) }, 'SI transport error');
        this.app.bridgeState = 'error';
        if (!this.shutdownRequested && this.transport === transport) {
          this.scheduleReconnect();
        }
      });
      station.on('error', (err: unknown) => {
        this.app.log.warn({ err: errMsg(err) }, 'SI station error');
        this.app.bridgeState = 'error';
        if (!this.shutdownRequested && this.station === station) {
          this.scheduleReconnect();
        }
      });
      // Wire reconnect on spontaneous close — but only AFTER successful open,
      // so the teardown that runs at the start of the next openAttempt
      // doesn't re-trigger scheduleReconnect via this listener.
      await transport.open();
      this.app.log.info({ path: this.serialPath }, 'SI bridge transport opened');
      this.transport = transport;
      this.station = station;
      this.attached = attached;
      this.app.bridgeState = 'open';
      this.isConnected = true;
      station.on('connectionChanged', (state) => {
        this.app.bridgeState = state;
        this.isConnected = state === 'open';
        if (state === 'closed' || state === 'error') {
          if (!this.shutdownRequested && this.station === station) {
            this.scheduleReconnect();
          }
        }
      });
      this.attempt = 0;
      // Drive the handshake — this also emits connectionChanged:open via the
      // station's readCards() path.
      await station.readCards();
    } catch (err) {
      this.app.log.warn({ err: errMsg(err) }, 'SI bridge open failed');
      this.app.bridgeState = 'error';
      this.scheduleReconnect();
    } finally {
      this.openInFlight = false;
    }
  }

  private scheduleReconnect(): void {
    if (this.shutdownRequested) return;
    // Coalesce: only one timer in flight at a time. station.close() racing
    // a catch-block scheduleReconnect must not produce parallel chains.
    if (this.reconnectTimer !== null) return;
    // Hardware-just-works: never give up. Ramp up through the backoff
    // schedule, then steady-state at the last step (5 s) forever. Operator
    // can still force an immediate retry via the "Återanslut" sidebar
    // button (POST /api/sessions/reconnect-bridge). Without this clamp the
    // operator had to restart the stack every time they unplugged the
    // USB for more than ~9 s.
    const cappedAttempt = Math.min(this.attempt, BACKOFF_MS.length - 1);
    const delay = BACKOFF_MS[cappedAttempt]!;
    this.attempt++;
    // Log dampening: chatter during the ramp (attempts 1..5), then one
    // line at the moment we cross into steady-state, then one every minute
    // (12 × 5 s) so journalctl stays readable on a long unplugged stretch.
    const verbose =
      this.attempt <= BACKOFF_MS.length ||
      this.attempt === BACKOFF_MS.length + 1 ||
      this.attempt % 12 === 0;
    if (verbose) {
      this.app.log.info({ delay, attempt: this.attempt }, 'scheduling SI bridge reconnect');
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.openAttempt();
    }, delay);
  }

  async reconnectNow(): Promise<void> {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.attempt = 0;
    await this.openAttempt();
  }

  async stop(): Promise<void> {
    this.shutdownRequested = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.teardownCurrent();
  }

  private async teardownCurrent(): Promise<void> {
    if (this.attached) {
      try {
        this.attached.detach();
      } catch {
        /* best-effort */
      }
      this.attached = null;
    }
    if (this.station) {
      try {
        await this.station.close();
      } catch {
        /* best-effort */
      }
      this.station = null;
    }
    if (this.transport) {
      try {
        await this.transport.close();
      } catch {
        /* best-effort — releases the SerialPort fd so the next open()
         * doesn't hit EAGAIN "Cannot lock port" on the same path. */
      }
      this.transport = null;
    }
    this.isConnected = false;
    // Reflect teardown if we're not mid-reconnect (scheduleReconnect leaves
    // 'opening' set for the next attempt).
    if (this.app.bridgeState !== 'opening') {
      this.app.bridgeState = 'closed';
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const opts = parseArgs(argv);

  const dbPath = process.env['FARTOLA_DB_PATH'] ?? opts.dbPath;
  const handle: DbHandle = openDatabase(dbPath);
  const nodeId = process.env['FARTOLA_NODE_ID'] ?? ensureNodeId(handle);

  // Printer sink selection: default to the CUPS queue because the Phase 1
  // Star TSP143IIIU prints reliably through Star's rastertostar CUPS
  // driver. FARTOLA_PRINTER=direct keeps the node-thermal-printer
  // /dev/usb/lp* path available for compatible ESC/POS devices, and
  // FARTOLA_PRINTER=stdout keeps the JSON-line sink for dev / CI.
  const printerSink = createPrinterSink(resolvePrinterConfig(process.env));

  const app: FastifyInstance = await buildServer({
    logger: true,
    dbHandle: handle,
    nodeId,
    printerSink,
    allowLan: opts.allowLan,
  });

  // Optional CLI override for the active competition. Routes/sessions.ts
  // already restored from the config table during register, so we only
  // overwrite if the operator passed --competition-id.
  if (opts.competitionId !== null) {
    // Verify the comp exists before persisting — mirrors the REST
    // POST /api/sessions/active-competition validator. A typo in the CLI
    // flag would otherwise persist a non-existent id and cause downstream
    // events to violate the competition_id FK constraint mid-stream.
    const exists = handle.db
      .select({ id: competitions.id })
      .from(competitions)
      .where(eq(competitions.id, opts.competitionId))
      .get();
    if (!exists) {
      process.stderr.write(
        `fatal: --competition-id '${opts.competitionId}' not found in database\n`
      );
      process.exit(1);
    }
    app.activeCompetitionId = opts.competitionId;
    // Persist so the next restart honours the override.
    handle.db
      .insert(config)
      .values({ key: 'active_competition_id', value: opts.competitionId })
      .onConflictDoUpdate({
        target: config.key,
        set: { value: opts.competitionId },
      })
      .run();
  }

  // Plan 04 (D-02) — one BridgeLifecycle per --serial entry.
  const lifecycles: BridgeLifecycle[] = [];
  if (!opts.noBridge) {
    for (const entry of opts.serialPaths) {
      lifecycles.push(new BridgeLifecycle(app, handle, nodeId, entry.path, entry.position));
    }
    app.reconnectBridge = async () => {
      await Promise.all(lifecycles.map((lc) => lc.reconnectNow()));
    };
    // Expose the lifecycle array so the health route can query per-reader status.
    app.bridgeLifecycles = lifecycles;
    // Kick off the first open in the background — listen returns first so
    // /api/health responds even if /dev/ttyUSB0 takes time to enumerate.
    for (const lc of lifecycles) {
      void lc.start();
    }
  } else {
    app.bridgeLifecycles = [];
  }

  // Plan 17 — start the daily backup + retention schedulers. Both are cron-
  // in-process setTimeout chains anchored on next local midnight; they
  // run independently of the bridge lifecycle. Decorate the app so the
  // /api/__admin/run-backup-now + /run-retention-now endpoints (FARTOLA_DEV
  // gated) can trigger one-off runs for operators.
  const backup = scheduleDailyBackup(handle, { backupDir: opts.backupDir });
  const retention = scheduleDailyRetention(handle, { retentionDays: opts.retentionDays });
  app.fartolaBackup = backup;
  app.fartolaRetention = retention;

  // Phase 2.0 plan 02-01 task 4 — Eventor cache refresher (D-EV-1 /
  // D-EV-2 / D-EV-3). The handle exposes runNow + stop; we kick off the
  // first runNow() as fire-and-forget AFTER app.listen below so a missing
  // EVENTOR_API_KEY or a network failure NEVER blocks bridge startup
  // (Pitfall 5 mitigation).
  //
  // Plan 02-07 task 2 — env→config→absent precedence. The UI write
  // path (PUT /api/settings/integrations) lands the key in the config
  // table; resolveSecret is called fresh on every runNow() (code-review
  // F-001) so saving a key in the settings UI then clicking "Uppdatera
  // Eventor" works WITHOUT a bridge restart. process.env still wins so
  // headless / CI installs keep working unchanged.
  const eventor = scheduleEventorBoot(handle, {
    apiKey: () => resolveSecret(handle, 'EVENTOR_API_KEY'),
    logger: app.log,
  });
  app.fartolaEventor = eventor;

  const shutdown = async (code: number): Promise<void> => {
    for (const lc of lifecycles) {
      try {
        await lc.stop();
      } catch {
        /* best-effort */
      }
    }
    try {
      backup.stop();
    } catch {
      /* best-effort */
    }
    try {
      retention.stop();
    } catch {
      /* best-effort */
    }
    try {
      eventor.stop();
    } catch {
      /* best-effort */
    }
    try {
      await app.close();
    } catch {
      /* best-effort */
    }
    try {
      handle.close();
    } catch {
      /* best-effort — db may already be closed */
    }
    process.exit(code);
  };

  process.on('SIGINT', () => {
    void shutdown(0);
  });

  process.on('uncaughtException', (err: Error) => {
    process.stderr.write(`uncaughtException: ${errMsg(err)}\n`);
    void shutdown(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    process.stderr.write(`unhandledRejection: ${errMsg(reason)}\n`);
    void shutdown(1);
  });

  await app.listen({ port: opts.port, host: opts.bindHost });

  // Phase 2.0 plan 02-01 task 4 — fire-and-forget Eventor refresh AFTER
  // app.listen so a slow/missing network never blocks /api/health from
  // responding. boot.ts.runNow already converts network failures into
  // logged warnings (D-EV-3); the void+catch here is belt-and-suspenders
  // for any unexpected throw.
  void eventor.runNow().catch((err: unknown) => {
    app.log.warn({ err }, 'eventor boot failed');
  });
}

const isEntrypoint = ((): boolean => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isEntrypoint)
  main().catch((err: unknown) => {
    process.stderr.write(`fatal: ${errMsg(err)}\n`);
    process.exit(1);
  });
