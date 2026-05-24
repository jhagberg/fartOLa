// Authored for fartola. Not ported from upstream.
//
// Fastify bootstrap for the fartOLa edge bridge. Registers @fastify/cors,
// @fastify/sensible, the WS plugin (when a dbHandle is provided), the
// health route, and the dev routes (when both a dbHandle AND FARTOLA_DEV=1
// are set — registration itself is a no-op in production builds).
// Installs a setNotFoundHandler that returns { error: 'Not found' } for
// API/WS paths and falls through to 200.html for any other path so the
// SvelteKit SPA router can take over (plan 18 — RESEARCH Pattern 3).
//
// Plan 18 — production static-serve wiring: when `opts.staticRoot` resolves
// to an existing directory (the packaged tarball populates
// dist/web/ via scripts/build-tarball.sh; in dev the SvelteKit dev server
// at :5173 serves the SPA so this directory doesn't exist and the static
// block is skipped), @fastify/static is registered and the not-found
// handler sends `200.html`. The API/WS prefix check keeps JSON 404s
// returning for /api/* and /ws.
//
// Plan 03 extension: accepts opts.dbHandle + opts.nodeId so the factory
// can decorate the FastifyInstance for the WS plugin + dev routes.
// opts.printerSink defaults to createStdoutPrinterSink() when omitted
// (the walking-skeleton "thermal" path that writes JSON lines to stdout).
//
// Binds 127.0.0.1 only by default — the bin's argv parser owns the
// LAN-exposure gate (T-WS-FAN-OUT mitigation in the threat register).
// CORS allow-list mirrors the bind host: localhost loopback only in plan
// 01 (T-CORS mitigation); plan 03 keeps the same allow-list because the
// SvelteKit dev server runs on the same loopback origin (port 5173).
//
// Pattern S-7: this module exports `buildServer()` as a pure factory — it
// does NOT call .listen(). The bin (src/bin/fartola.ts) is the only place
// that opens a listening socket, which lets unit tests inject fastify via
// app.inject() without consuming a port.

import fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { registerHealthRoute } from './routes/health.ts';
import registerDevRoutes from './routes/dev.ts';
import registerCompetitions from './routes/competitions.ts';
import registerClasses from './routes/classes.ts';
import registerCourses from './routes/courses.ts';
import registerCompetitors from './routes/competitors.ts';
import registerClubs from './routes/clubs.ts';
import registerImportRoutes from './routes/import.ts';
import registerCompetitionsFromWizard from './routes/competitionsFromWizard.ts';
import registerSessionsRoutes from './routes/sessions.ts';
import registerResultsRoute from './routes/results.ts';
import registerReadoutRoute from './routes/readout.ts';
import registerManualRoutes from './routes/manual.ts';
import registerPrintRoute from './routes/print.ts';
import registerExportRoutes from './routes/export.ts';
import registerAdminRoutes from './routes/admin.ts';
import registerEventorRoutes from './routes/eventor.ts';
import registerEventorImportRoutes from './routes/eventorImport.ts';
import registerHiredCardsRoutes from './routes/hiredCards.ts';
import registerSettingsRoutes from './routes/settings.ts';
import registerMipRoute from './integrations/meos/mip.ts';
import registerMopRoute from './integrations/meos/mop.ts';
import registerLottningRoutes from './routes/lottning.ts';
import registerLiveresultatRoutes from './routes/liveresultat.ts';
import registerEventorPushRoutes from './routes/eventorPush.ts';
import registerCheckunitRoutes from './routes/checkunit.ts';
import registerEventCodesRoutes from './routes/event-codes.ts';
import registerAccessRoute from './routes/access.ts';
import { LOGGER_REDACT_OPTIONS } from './log/redact.ts';
import { verifyCookie } from './auth/event-code.ts';
import { getOrCreateSigningSecret } from './routes/event-codes.ts';
import wsPlugin from './ws/index.ts';
import type { DbHandle } from './db/index.ts';
import type { PrinterSink } from './print/sink.ts';
import { createStdoutPrinterSink } from './print/stdout-sink.ts';
import type { ChannelName } from '@fartola/shared-types';
import { nextLocalSeq as defaultNextLocalSeq } from './db/seq.ts';
import { createProjectionStore, type ProjectionStore } from './projection/store.ts';

/** Broadcast sink — PATTERNS S-2. Plan 04 wires this as an OPTIONAL spy that
 * lets tests record wsBroadcast invocations without standing up a real WS
 * client. When omitted (production / walking-skeleton), wsBroadcast falls
 * through to the @fastify/websocket plugin's fan-out registered by wsPlugin. */
export interface BroadcastSink {
  record: (
    channel: ChannelName,
    envelope: { type: string; payload: unknown; seq?: number }
  ) => void;
}

/** local_seq generator injection — PATTERNS S-2. Defaults to the real
 * nextLocalSeq trailing-edge SELECT. Plan 04 test 9 (transaction atomicity)
 * injects a throwing fn to verify the competitor + events insert rollback
 * is a single atomic unit. */
export type NextLocalSeqFn = (handle: DbHandle, nodeId: string) => number;

export interface BuildServerOpts {
  /** Pass `false` to silence the Fastify pino logger (tests). Defaults to true.
   * Pass an object (pino options shape) to inject a custom stream / level —
   * settings.test.ts uses this to capture pino chunks for the redaction
   * assertion. The redact path list is merged in automatically. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logger?: boolean | Record<string, any>;
  /** Opened SQLite handle (plan 02 openDatabase). When omitted, only the
   * legacy plan-01 routes are wired; the WS plugin + dev routes are
   * skipped. Tests that exercise WS / dev MUST pass a handle. */
  dbHandle?: DbHandle;
  /** Stable per-install node id (plan 02 ensureNodeId). Required when
   * dbHandle is set. */
  nodeId?: string;
  /** Printer sink injection (PATTERNS S-2). Defaults to the stdout sink
   * for walking-skeleton + tests; production swaps in the ESC/POS driver
   * (plan 15). */
  printerSink?: PrinterSink;
  /** Broadcast sink (PATTERNS S-2). When set, wsBroadcast ALSO calls
   * `record(channel, envelope)` after the real fan-out — tests use this to
   * assert which envelopes were emitted without standing up a WS client. */
  broadcastSink?: BroadcastSink;
  /** local_seq generator injection (PATTERNS S-2). Defaults to the real
   * trailing-edge SELECT (db/seq.ts). Plan 04 test 9 swaps in a throwing
   * fn to verify transactional atomicity. */
  nextLocalSeqFn?: NextLocalSeqFn;
  /** Plan 08 — projection-store debounce window. Tests inject 0 for
   * synchronous markDirty → recompute → broadcast assertions. */
  projectionDebounceMs?: number;
  /** Plan 18 — production static-serve root. When set and the directory
   * exists, @fastify/static serves files from this directory and the
   * setNotFoundHandler falls back to `200.html` for non-API/non-WS paths
   * (RESEARCH Pattern 3). In dev the SvelteKit dev server owns the SPA;
   * this option is undefined so the static block is skipped. The packaged
   * tarball populates dist/web/ via scripts/build-tarball.sh so the
   * installed binary auto-detects and serves the SPA. */
  staticRoot?: string;
  /** Phase 2.0 — when true, the CORS allow-list AND the WebSocket origin
   * allow-list both accept non-loopback Origin headers so the MeOS
   * parallel-run laptop on the same LAN can open the fartOLa UI at
   * `http://<fartola-lan-ip>:3000/...` (D-WS-LAN). Wired from
   * bin/fartola.ts when `--allow-lan` is set. Default false (loopback only,
   * Phase 1 posture). Code-review F-001 (codex) BLOCKER fix. */
  allowLan?: boolean;
}

/** Default static root resolution for the packaged binary. Mirrors the
 * dist/ layout produced by scripts/build-tarball.sh — but probes both
 * `<here>/web` AND `<here>/../web` so the SPA resolves whether server.ts
 * is bundled into `dist/server.{cjs,mjs}` (sibling `dist/web/`) or
 * bundled into `dist/bin/fartola.cjs` (parent `dist/web/`). Plan 18 ships
 * the bin path as the operator entry point; the standalone server entry
 * is kept for Phase 2 programmatic embedding. Returns undefined in dev
 * (the source-tree `apps/edge/src/web/` doesn't exist) so SvelteKit's
 * Vite dev server on :5173 owns the SPA. */
function defaultStaticRoot(): string | undefined {
  try {
    // import.meta.url is the source-file URL under tsx and the bundled
    // CJS/ESM file URL in production. The CJS bundle path is determined
    // by tsup's shims:true which polyfills `import.meta.url` via
    // `__filename`.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(here, 'web'), // dist/server.cjs sibling
      path.resolve(here, '..', 'web'), // dist/bin/fartola.cjs parent
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function buildServer(opts: BuildServerOpts = {}): Promise<FastifyInstance> {
  // Wire pino's redact paths into the logger options so PUT
  // /api/settings/integrations request bodies never leak the `value`
  // field to stdout. Path list lives in apps/edge/src/log/redact.ts
  // (Plan 02-07 task 1). When the caller passes `logger: false`
  // (tests) we keep the silent path. When they pass an object (the
  // streaming test that captures pino chunks for assertion), we merge
  // redact on top of their config so the caller's stream still wins.
  let loggerOpt: BuildServerOpts['logger'] | Record<string, unknown>;
  if (opts.logger === false) {
    loggerOpt = false;
  } else if (typeof opts.logger === 'object' && opts.logger !== null) {
    loggerOpt = {
      ...(opts.logger as Record<string, unknown>),
      redact: LOGGER_REDACT_OPTIONS,
    };
  } else {
    loggerOpt = { redact: LOGGER_REDACT_OPTIONS };
  }
  const app = fastify({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logger: loggerOpt as any,
  });

  await app.register(sensible);

  // Localhost-loopback-only CORS — Phase 1 plan 01 has no LAN clients.
  // Plan 03 keeps the same allow-list because the SvelteKit dev server
  // runs on the same loopback origin (port 5173). Phase 2.0 widens it
  // when `opts.allowLan === true` (operator passed `--allow-lan` at the
  // CLI) so the MeOS parallel-run laptop can open the SPA over LAN.
  // Same-origin Host header is the implicit trust anchor — Fastify only
  // serves bound interfaces, so an attacker on the LAN must already be
  // on the LAN, which is the explicit Phase 2.0 trust model (D-MIP-1 /
  // D-MOP-4 no-auth closed-LAN posture).
  const corsOrigin: Array<RegExp> = [
    /^http:\/\/127\.0\.0\.1(:\d+)?$/,
    /^http:\/\/localhost(:\d+)?$/,
  ];
  if (opts.allowLan === true) {
    // RFC1918 private LAN ranges (192.168/16, 10/8, 172.16/12) + IPv6
    // link-local + .local mDNS hostnames. Use a precise IPv4 octet
    // pattern (0–255) rather than `\d{1,3}` (which matches 0–999 and
    // would let through malformed Host headers).
    const oct = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
    corsOrigin.push(new RegExp(`^http://192\\.168\\.${oct}\\.${oct}(:\\d+)?$`));
    corsOrigin.push(new RegExp(`^http://10\\.${oct}\\.${oct}\\.${oct}(:\\d+)?$`));
    corsOrigin.push(new RegExp(`^http://172\\.(1[6-9]|2\\d|3[01])\\.${oct}\\.${oct}(:\\d+)?$`));
    corsOrigin.push(/^http:\/\/\[fe80::[^\]]+\](:\d+)?$/);
    corsOrigin.push(/^http:\/\/[a-z0-9-]+\.local(:\d+)?$/);
  }
  await app.register(cors, { origin: corsOrigin });

  // Decorate the FastifyInstance BEFORE wsPlugin / dev routes register.
  // Both rely on app.fartolaDb / app.fartolaNodeId being present and the
  // dev routes additionally rely on app.printerSink + app.wsBroadcast.
  if (opts.dbHandle) {
    if (!opts.nodeId) {
      throw new Error('buildServer: nodeId is required when dbHandle is provided');
    }
    app.decorate('fartolaDb', opts.dbHandle);
    app.decorate('fartolaNodeId', opts.nodeId);
    app.decorate('printerSink', opts.printerSink ?? createStdoutPrinterSink());
    app.decorate('fartolaNextLocalSeq', opts.nextLocalSeqFn ?? defaultNextLocalSeq);
    // Surface the SI bridge connection state to routes (GET /api/bridge/status).
    // The bin's BridgeLifecycle mutates this; --no-bridge boots stay 'closed'.
    app.decorate('bridgeState', 'closed');
    // Phase 2.0 — surface --allow-lan to the WS plugin so its Origin
    // allow-list can permit LAN origins when the operator explicitly
    // opted in. Default false (loopback only). Code-review F-001 fix.
    app.decorate('fartolaAllowLan', opts.allowLan === true);

    await app.register(wsPlugin);

    // PATTERNS S-2 broadcast sink: wrap the decorated wsBroadcast so the
    // recording sink (when set) fires alongside the real fan-out. Tests
    // assert on the sink; production never sees the wrapper because
    // broadcastSink is undefined by default.
    if (opts.broadcastSink) {
      const realBroadcast = app.wsBroadcast.bind(app);
      const sink = opts.broadcastSink;
      const wrapped: typeof app.wsBroadcast = (channel, envelope) => {
        realBroadcast(channel, envelope);
        sink.record(channel, envelope);
      };
      // Re-decorate: Fastify forbids overwriting a decorator, so we mutate
      // the existing slot directly. `as unknown as ...` to satisfy TS.
      (app as unknown as { wsBroadcast: typeof wrapped }).wsBroadcast = wrapped;
    }

    // Plan 08: construct the projection store AFTER wsPlugin so the store
    // can route broadcasts through the (possibly sink-wrapped) wsBroadcast.
    // The store is the IO layer wrapping plan 07's pure reducer; it owns
    // the cache + debounced recompute and only re-reads SQLite on
    // markDirty. Dispose via Fastify's onClose so pending timers are
    // cleared when the app shuts down.
    const projectionStore = createProjectionStore({
      handle: opts.dbHandle,
      broadcast: (channel, envelope) => app.wsBroadcast(channel, envelope),
      ...(opts.projectionDebounceMs !== undefined ? { debounceMs: opts.projectionDebounceMs } : {}),
    });
    app.decorate('projectionStore', projectionStore);
    app.addHook('onClose', async () => {
      projectionStore.dispose();
    });

    await app.register(registerCompetitions);
    await app.register(registerClasses);
    await app.register(registerCourses);
    await app.register(registerCompetitors);
    await app.register(registerClubs);
    // Phase 2.0 Plan 02-02 — Eventor lookup + status (walk-up autocomplete).
    // Mounted after registerClubs since the lookup parallels clubs autocomplete.
    await app.register(registerEventorRoutes);
    await app.register(registerEventorImportRoutes);
    await app.register(registerImportRoutes);
    await app.register(registerCompetitionsFromWizard);
    // Sessions registers BEFORE dev routes so dev.ts can read
    // app.activeCompetitionId on first request (the route module itself
    // restores from the config table during register).
    await app.register(registerSessionsRoutes);
    await app.register(registerResultsRoute);
    await app.register(registerReadoutRoute);
    await app.register(registerManualRoutes);
    await app.register(registerPrintRoute);
    await app.register(registerExportRoutes);
    await app.register(registerAdminRoutes);
    // Phase 2.0 Plan 02-05 — Hyrbricka REST surface (GET list + PATCH
    // return). Mounted under /api/competitions/:id/hired-cards/* — same
    // namespace as the rest of the competition-scoped routes.
    await app.register(registerHiredCardsRoutes);
    // Phase 2.0 Plan 02-07 — Settings REST surface (GET + PUT
    // /api/settings/integrations). Operator-facing API-key management
    // so Windows operators can paste keys via UI without touching
    // ~/.env.fartola. Boot precedence (env > config > absent) is
    // enforced by apps/edge/src/config/secrets.ts (Plan 02-07 task 2).
    await app.register(registerSettingsRoutes);
    // Phase 2.0 Plan 02-03 — MIP server (GET /mip). Mounted at the ROOT,
    // not /api/*, because MeOS hard-codes its poll URL and won't add a
    // prefix. D-MIP-1: no auth (closed club LAN).
    await app.register(registerMipRoute);
    // Phase 2.0 Plan 02-04 — MOP receiver (POST /mop). Same root-mount
    // posture as MIP — MeOS hard-codes its push URL. D-MOP-4: no auth,
    // always-on; D-MOP-1..3 govern the shadow-table writes and auto-merge.
    await app.register(registerMopRoute);
    await app.register(registerLottningRoutes);
    await app.register(registerLiveresultatRoutes);
    // Phase 2.1 Plan 02.1-08 — Eventor results + startlist push.
    // POST /api/competitions/:id/eventor/push-results|push-startlist.
    await app.register(registerEventorPushRoutes);
    // Phase 2.1 Plan 02.1-06 — Kvar-i-skogen check-unit backup readout.
    // POST /api/competitions/:id/checkunit/snapshot.
    await app.register(registerCheckunitRoutes);
    // Phase 2.1 Plan 02.1-12 — Admin event-code routes (localhost-only).
    // POST/GET /api/competitions/:id/event-codes, POST revoke.
    await app.register(registerEventCodesRoutes);
    // Phase 2.1 Plan 02.1-12 — POST /access (open to LAN — auth endpoint).
    // Rate-limited; sets signed HttpOnly cookie scoped to competitionId.
    await app.register(registerAccessRoute);

    // Phase 2.1 Plan 02.1-12 — Blanket preHandler gate on all write routes
    // under /api/competitions/:id/**  (POST/PATCH/DELETE) for non-localhost
    // requests without a valid signed cookie (T-02.1-27 / T-02.1-27b).
    //
    // Localhost bypass: uses socket.remoteAddress ONLY. X-Forwarded-For is
    // EXPLICITLY IGNORED to prevent header spoofing (T-02.1-27 mitigation).
    //
    // Cookie competitionId scope: the cookie payload's cid field must match
    // the route's :id param. Mismatch → 403 cookie_competition_mismatch
    // (T-02.1-25b mitigation — helper authenticated for comp A cannot write
    // to comp B).
    //
    // Blanket approach: gates all POST/PATCH/DELETE under /api/competitions/:id/**
    // automatically — new write routes added in future plans are protected
    // without an explicit inventory update.
    app.addHook('onRequest', async (request, reply) => {
      const method = request.method.toUpperCase();
      const url = request.url;

      // Only gate write methods under /api/competitions/:id/...
      if (!['POST', 'PATCH', 'DELETE'].includes(method)) return;
      if (!url.startsWith('/api/competitions/')) return;

      // Extract the :id segment from the URL path.
      // Pattern: /api/competitions/<id>/...  (must have a suffix after the id)
      const urlParts = url.split('/');
      // urlParts: ['', 'api', 'competitions', '<id>', ...rest]
      if (urlParts.length < 5) return; // no suffix — let the route handle 404
      const routeCompetitionId = urlParts[3];

      // Exclude /api/competitions/:id/event-codes routes — they are admin-only
      // (localhost-gated) routes with their own localhost check. The blanket
      // gate is for helper-facing write routes, not operator-only admin surfaces.
      // Exclude both the generate (POST /event-codes) and revoke
      // (POST /event-codes/:codeId/revoke) paths.
      if (url.includes('/event-codes')) return;

      // Localhost bypass — check socket.remoteAddress ONLY (never XFF).
      const remoteAddr = request.socket.remoteAddress;
      const isLocalhost =
        remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';
      if (isLocalhost) return;

      // Non-localhost: require a valid signed cookie.
      const rawCookie = request.headers.cookie;
      const cookieValue = rawCookie
        ? rawCookie
            .split(';')
            .map((s) => s.trim())
            .find((s) => s.startsWith('fartola_event_code='))
            ?.slice('fartola_event_code='.length)
        : undefined;

      if (!cookieValue) {
        return reply.code(403).send({ error: 'event_code_required' });
      }

      const secret = getOrCreateSigningSecret(app);
      const payload = verifyCookie(cookieValue, routeCompetitionId ?? '', secret);

      if (!payload) {
        // Either signature invalid, expired, or competitionId mismatch.
        // Check if signature is valid for SOME competition to distinguish
        // mismatch from tampered/missing.
        // For simplicity: if cookie parses but cid doesn't match, return mismatch.
        // Otherwise, return event_code_required (don't leak why verification failed).
        //
        // To distinguish: try verifying without the cid check — not exposed by
        // verifyCookie API. Instead, check if cookie looks structurally valid
        // (two dot-separated base64url parts) and report mismatch, otherwise
        // report missing.
        const parts = cookieValue.split('.');
        if (parts.length === 2 && parts[0] && parts[1]) {
          // Structurally valid cookie but failed verification — likely cid mismatch
          // or signature tampered. Report competition_mismatch for UX clarity on
          // the most common case (helper navigating between competitions).
          return reply.code(403).send({ error: 'cookie_competition_mismatch' });
        }
        return reply.code(403).send({ error: 'event_code_required' });
      }

      // Verified. payload.competitionId already matches routeCompetitionId
      // (verifyCookie enforces this). No additional check needed.
    });

    await app.register(registerDevRoutes);
  }

  // Plan 04 (D-02 / REQ-OPS-004) — per-reader lifecycle array. Decorated
  // unconditionally (even when no dbHandle is provided) so /api/health always
  // returns a valid readers array. The bin overwrites this after listen() with
  // real lifecycles; tests and --no-bridge boots stay at empty array.
  if (!app.hasDecorator('bridgeLifecycles')) {
    app.decorate('bridgeLifecycles', []);
  }

  await registerHealthRoute(app);

  // Plan 18 — production static-serve. The factory accepts an explicit
  // staticRoot; otherwise defaultStaticRoot() probes `__dirname/web`
  // (`dist/web/` after the tarball build). When the directory exists the
  // SPA is served and 404s for non-API/non-WS paths fall back to 200.html
  // so SvelteKit's client-side router takes over (RESEARCH Pattern 3).
  // When it doesn't exist (dev, unit tests), we keep the original JSON-404
  // behaviour so dev tools see a clean 404 instead of an HTML wall.
  const staticRoot = opts.staticRoot ?? defaultStaticRoot();
  if (staticRoot !== undefined && existsSync(staticRoot)) {
    await app.register(fastifyStatic, {
      root: staticRoot,
      wildcard: false,
    });
    app.setNotFoundHandler((request, reply) => {
      const url = request.url;
      if (url.startsWith('/api/') || url === '/ws' || url.startsWith('/ws?')) {
        void reply.code(404).send({ error: 'Not found' });
        return;
      }
      // Drop the querystring before sendFile; @fastify/static treats the
      // filename as a path-relative request.
      void reply.sendFile('200.html');
    });
  } else {
    app.setNotFoundHandler((_request, reply) => {
      void reply.code(404).send({ error: 'Not found' });
    });
  }

  return app;
}

// Module augmentation for printerSink + fartolaNextLocalSeq. wsPlugin already
// augments fartolaDb / fartolaNodeId / wsBroadcast.
declare module 'fastify' {
  interface FastifyInstance {
    printerSink: PrinterSink;
    /** PATTERNS S-2 — local_seq generator injection point. Routes that
     * insert into events read this instead of importing nextLocalSeq
     * directly so tests can swap in a throwing fn for atomicity coverage. */
    fartolaNextLocalSeq: NextLocalSeqFn;
    /** Plan 08 — projection cache + debounced recompute + broadcast.
     * Bridge + dev simulate-read + walk-up POST all call markDirty after
     * mutations; hello handler reads `get/recomputeNow` for results_full. */
    projectionStore: ProjectionStore;
    /** Current SI bridge transport state. Mutated by the bin's
     * BridgeLifecycle as the SerialTransport opens/closes/errors. Read by
     * GET /api/bridge/status so a fresh page-load can prime its
     * StationCard before any connection_changed envelope arrives. */
    bridgeState: 'opening' | 'open' | 'closed' | 'error';
  }
}

// sessions.ts owns the declarations for activeCompetitionId, reconnectBridge,
// and bridgeLifecycles. No re-declaration here to avoid duplicate augmentation.
