---
status: accepted
date: 2026-10-07
decision-makers: [Jonas Hagberg]
---

# Tech stack: Node.js + Fastify + SQLite + SvelteKit

## Update 2026-10-07: re-evaluated; a version policy instead of versions

The core choice of 2026-05-12 stands: Node.js + Fastify on the edge, SQLite,
and SvelteKit in the browser. It was re-checked against Bun, Deno and
Node's built-in SQLite on 2026-10-07 (matrix below). This ADR now names
technologies and a version policy, never version numbers. Versions live in
`package.json` (`engines`), `.nvmrc` and `pnpm-lock.yaml`.

### Version policy

- **Run the newest Node.js LTS line.** Move to a new line once it has
  entered LTS and the gate, e2e and the real-competition replays
  (ADR-0014) pass on it. From Node 27, Node ships one major a year and
  every major becomes LTS in October, so this is a yearly step each
  autumn. Node 26 enters LTS on 2026-10-28, so that is the next move.
- **`engines` and `.nvmrc` are the enforcement.** CI runs on the `.nvmrc`
  version. Dependencies are updated by Renovate and a periodic upgrade PR.

### Stack as built

| Layer         | As built                                                                                                                                  | Change from 2026-05-12      |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Runtime       | Node.js, newest LTS line (policy above), pnpm workspace                                                                                   | Policy instead of "Node 22" |
| Edge backend  | Fastify, zod at the boundaries                                                                                                            | —                           |
| Edge DB       | SQLite via `better-sqlite3` with **Drizzle ORM** (schema as TS, drizzle-kit migrations; append-only triggers in a hand-written migration) | Drizzle added               |
| Frontend      | SvelteKit built as a static SPA and **served by the edge**. Has a web manifest but no service worker, so it is not an offline PWA         | Not a PWA yet               |
| Printing      | `node-thermal-printer` behind our own `escposDriver`, a CUPS sink, `sharp` for receipt bitmaps                                            | Was `node-escpos`           |
| Distribution  | `tsup` bundles the edge and workspace packages into one `fartola` package, with systemd and udev units                                    | New                         |
| Tests         | `node:test` (edge, packages), Vitest (web), Playwright (e2e)                                                                              | New                         |
| Edge hardware | Today the operator's Linux laptop. Target: a Raspberry Pi 5 kit a club buys once; not yet tried on a Pi                                   | Pi still the target         |
| Central tier  | **Not built**: Postgres and ElectricSQL (Phase 5, ADR-0004); Yjs and Capacitor deferred                                                   | Were listed as chosen       |

### Options re-checked 2026-10-07

Scores 1 (poor) to 5 (good). Weights reflect an offline server that must
run a whole competition day with a USB SI reader and a receipt printer.

| Criterion (weight)                               | Node 24 → 26 (LTS)                                                 | Bun 1.4                                                                          | Deno 2.9                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Hardware modules: serialport, sharp, SQLite (×3) | 5 — what the modules are built and tested against; arm64 prebuilds | 2 — serialport on Bun unconfirmed; would move to `bun:sqlite`                    | 2 — Node-API works; serialport only anecdotal                |
| Long-term support (×3)                           | 5 — 30-month LTS; 26 supported to 2029-04                          | 2 — no LTS policy; 1.4 is the first release after the Zig→Rust rewrite (2026-08) | 3 — LTS exists but shorter                                   |
| Club install: one file to copy (×2)              | 2 — SEA still experimental; addons must be unpacked at start       | 5 — `bun build --compile` embeds `.node` files, linux-arm64 supported            | 4 — `deno compile`, needs FFI permission and an install step |
| Maturity and risk (×2)                           | 5                                                                  | 2 — runtime layer rewritten seven weeks ago                                      | 3                                                            |
| Speed (×1)                                       | 4                                                                  | 5                                                                                | 4                                                            |
| Tooling: TS, tests, bundling (×1)                | 4 — runs TS directly; node:test, tsup                              | 5 — all built in                                                                 | 4                                                            |
| **Weighted total (max 60)**                      | **52**                                                             | **36**                                                                           | **37**                                                       |

Chosen: **stay on Node.js**. Bun's single binary is the one real gain, and
it matters for the club kit; it is outweighed by unverified serial and
SQLite support, no LTS, and a fresh rewrite. Re-check Bun when it states a
support policy and serialport is proven on it, ideally with a spike on a
Pi 5.

SQLite driver, re-checked the same day: **keep `better-sqlite3`**. It is
now a Node-API addon with prebuilt binaries (including linux-arm64), so
the native-addon cost is small. Node's built-in `node:sqlite` is a release
candidate (no flag), and Drizzle supports it only in its 1.0 pre-releases.
Move when both are stable, which removes one native addon.

Club install: ship an installer or package (a `.deb` for the Pi, later
others) rather than a single executable, until Node's SEA is stable.

Sources (fetched 2026-10-07): nodejs.org "Evolving the Node.js Release
Schedule" (2026-03-10); github.com/nodejs/Release schedule; nodejs.org/api
`sqlite` and `single-executable-applications`; bun.com/blog/bun-in-rust
(2026-07-08) and bun-v1.4; WiseLibs/better-sqlite3 v13.0.0 release notes.

The original text below is kept as recorded.

## Context and Problem Statement

The three-tier architecture (ADR-0002) needs concrete technology
choices for edge, central, frontend, and ancillary concerns. What is
the stack?

## Decision Outcome

| Layer                      | Choice                              | Reason                                              |
| -------------------------- | ----------------------------------- | --------------------------------------------------- |
| Edge backend               | Node.js 22 LTS + Fastify            | Shared TS types with frontend; mature `@serialport` |
| Edge DB                    | SQLite via `better-sqlite3`         | Synchronous, ~10k writes/sec on Pi 5                |
| Central backend            | Node.js 22 LTS + Fastify            | Symmetric with edge; no language switch             |
| Central DB                 | Postgres 16                         | Partitionable, Electric-compatible                  |
| Read sync (central→client) | ElectricSQL Shapes                  | GA Mar 2025; Durable Streams Dec 2025               |
| Collab edits (forms only)  | Yjs                                 | Only for shared forms, not punches                  |
| Frontend                   | SvelteKit (PWA)                     | Smaller bundles than React; matters on forest 4G    |
| Mobile (optional)          | Capacitor wrapper of PWA            | Only if iOS-as-operator becomes critical            |
| Printing                   | `node-escpos` + `escpos-printer-db` | Open ESC/POS, avoids 72mm format hell               |
| Edge hardware (dedicated)  | Raspberry Pi 5 (4 GB) + PiJuice UPS | ~1 200 SEK, Linux, USB hub for SI                   |

## Rejected (with reason)

- **Electron** — too heavy; Tauri / Capacitor if a desktop wrapper is
  needed.
- **React** — fine, but Svelte's bundles are smaller; bundle size
  matters in the forest.
- **GraphQL** — overengineering at this scale; REST + WebSocket
  suffices.
- **Microservices** — overengineering; two well-structured monoliths
  is the right number.
- **Kafka / NATS** — possibly Phase 5 for public fan-out; Electric
  covers Phase 1–4.
- **CRDTs for punches** — unnecessary; event log is conflict-free by
  construction.

## More Information

- [architecture.md](../../.planning/research/architecture.md) §"Tech stack".
- Manifests: [package.json](../../package.json),
  [apps/edge/package.json](../../apps/edge/package.json),
  [apps/web/package.json](../../apps/web/package.json).
