# Roadmap: fartola

## Overview

Phases mapped to REQ-IDs from `REQUIREMENTS.md`. Each phase has a single
user-visible deliverable and explicit success criteria. We do not move
to the next phase until the current phase has been used by a real
orienteer at a real event (training counts).

## Phases

- [x] **Phase 0: Hardware proof** — Node.js script reads SI cards via BSM7/BSM8 on Linux, logs structured JSON. (Completed 2026-05-13, tagged `v0.0.1-handshake`.)
- [x] **Phase 1: Single-laptop training MVP** — Run a real club training using only this software on one laptop. (Merged to main 2026-05-16 via PR #3.)
- [x] **Phase 1.5: Public demo + landing page** — GitHub Pages site with a clickable mock so anyone can test the UI and leave feedback. (Merged to main 2026-05-15.)
- [ ] **Phase 2.0: 4-klubbs MVP (parallel with MeOS)** — Run fartOLa as primary registration + readout at a 4-klubbs training on 2026-05-20, with MeOS as parallel safety backup via MIP+MOP sync.
- [ ] **Phase 2.1: Sanctioned-competition foundations** — Start list lottning, kvar-i-skogen, multi-serial readers, liveresultat push, Eventor results+startlist push, admin codes, MeOS classid fix, gap-analysis quick wins.
- [ ] **Phase 3: Children's finish, public engagement** — Kids' finish screen, parent notifications, embeddable live widget.
- [ ] **Phase 4: Multi-arena, radio controls** — Radio controls feeding live punches, multiple WiFi cells, peer-to-peer sync.
- [ ] **Phase 5: O-ringen scale** — Demonstrable capacity for a five-stage event with 25 000+ starters.

## Phase Details

### Phase 0: Hardware proof

**Goal**: A Node.js script that reads SI cards from BSM7/BSM8 on Linux and logs structured JSON to stdout.
**Depends on**: Nothing (first phase)
**Requirements**: REQ-HW-001, REQ-HW-002, REQ-HW-004
**Success Criteria** (what must be TRUE):
  1. BSM7/8 enumerates as `/dev/ttyUSB0` on Linux.
  2. Script opens port at 38 400 baud and completes handshake.
  3. CRC16-CCITT-0x8005 validation passes for incoming frames.
  4. Inserting a real SI8/9/10 logs `{cardNumber, punches: [...]}` to stdout.
  5. SI5 card test passes (legacy support).
  6. Tagged `v0.0.1-handshake`.
**Plans**: 6 plans
  - [x] 00-01-PLAN.md — Wave 0 scaffold: pnpm/tsup/lefthook/commitlint + packages/sportident/ skeleton + all Wave-0 test placeholders + CI workflow
  - [x] 00-02-PLAN.md — Port siProtocol (CRC16 + parse + parseAll + render) + constants + utils; 10 frozen CRC vectors green; synthetic frame fixtures
  - [x] 00-03-PLAN.md — Port storage primitives + BaseSiCard + ModernSiCard + SiCard5/9/10/SIAC; upstream-fixture-driven decoder tests
  - [x] 00-04-PLAN.md — SerialTransport (node serialport@13) + simplified SiTargetMultiplexer (Direct-only) + BaseSiStation/SiMainStation handshake; FakeSerialTransport-driven tests
  - [x] 00-05-PLAN.md — NDJSON output layer + bin/fartola-readout + index.ts public API + end-to-end fixture-replay integration test
  - [x] 00-06-PLAN.md — --record/--replay modes + hardware-smoke.sh + 4 bench fixtures (SI5/SI9/SI10/SIAC, captured 2026-05-13 in `packages/sportident/tests/fixtures/jonas/`) + v0.0.1-handshake tag

- Phase 0.1 (gap-closure 2026-05-13): closed 6 of 7 codex review findings — see .planning/phases/00-hardware-proof/00-1-SUMMARY.md

This is the hardest single technical milestone. Everything else is
"normal" web development once this works.

### Phase 1: Single-laptop training MVP

**Goal**: Run a real club training using only this software on one laptop. No internet required.
**Depends on**: Phase 0
**Requirements**: REQ-HW-001..004, REQ-EVT-001..004, REQ-EVT-CMP-001..008, REQ-UI-001..007, REQ-STD-001..003, REQ-OPS-001..003, REQ-PRIV-001, REQ-PRIV-002
**Success Criteria** (what must be TRUE):
  1. Import a Purple Pen `.xml` course file end-to-end.
  2. Web UI accessible at `localhost:5173` on Linux laptop.
  3. Read cards via Phase 0 bridge, match to course, show results live.
  4. Mark DNF / MP automatically.
  5. Print receipt to thermal printer OR show QR receipt.
  6. Export results as valid IOF XML 3.0 (XSD validation passes).
  7. StorTuna OK Tuesday training (20–40 starters) runs without falling over.
**Plans**: 18 plans
  - [x] 01-01-PLAN.md — Wave 0: monorepo scaffold (apps/edge + apps/web + packages/shared-types) + repo-root e2e config
  - [x] 01-02-PLAN.md — Wave 0 [BLOCKING]: Drizzle schema + embedded migrator + append-only triggers + node_id persistence
  - [x] 01-03-PLAN.md — Wave 0: WebSocket plugin + walking-skeleton e2e (simulate-read → DB → REST → WS → stdout print sink)
  - [x] 01-04-PLAN.md — Wave 1: Competition + class + course + competitor CRUD + clubs autocomplete + Zod schemas
  - [x] 01-05-PLAN.md — Wave 1: XML importer (Purple Pen + IOF 3.0 EntryList + CourseData), XSD validation, T-FILE-IMPORT mitigation
  - [x] 01-06-PLAN.md — Wave 2: SI bridge wiring (SiMainStation → events table + WS broadcast); bench-replay tests
  - [x] 01-07-PLAN.md — Wave 2: Pure reducer (CompetitionState) + DNF/MP detection + idempotency tests
  - [x] 01-08-PLAN.md — Wave 3: ProjectionStore + WS results: channel + GET /api/competitions/:id/results
  - [x] 01-09-PLAN.md — Wave 3: Card-to-competitor matching index + retroactive auto-bind + readout endpoint
  - [x] 01-10-PLAN.md — Wave 3: Manual-DNF / un-DNF REST + walk-up replace-card path
  - [x] 01-11-PLAN.md — Wave 4: SvelteKit app shell + design tokens (oklch) + i18n (sv/en port) + TweaksPanel + UI primitives
  - [x] 01-12-PLAN.md — Wave 4: HomeView + three-click wizard + DropZone + wizard e2e
  - [x] 01-13-PLAN.md — Wave 4: ReadoutView (live WS) + 6 receipt templates + Skogis procedural SVG + readout e2e
  - [x] 01-14-PLAN.md — Wave 4: Walk-up modal + live results view + fullscreen + walkup/results e2e
  - [x] 01-15-PLAN.md — Wave 4: ESC/POS thermal driver (node-thermal-printer) + 6 template renderers + auto-print wiring
  - [x] 01-16-PLAN.md — Wave 5: IOF XML 3.0 ResultList export + XSD validation + export page + export e2e
  - [x] 01-17-PLAN.md — Wave 5: Daily SQLite backup (cron-in-process) + 30-day REQ-PRIV-002 retention scrub + admin endpoints
  - [x] 01-18-PLAN.md — Wave 5: Single-binary packaging (npm install -g fartola) + systemd + udev + install-smoke + manual bench checkpoint

Phase 1 deferrals (explicit per CONTEXT.md):
- REQ-STD-003 (IOF XML 2.0.3 read) → Phase 2 — Purple Pen + IOF 3.0 EntryList cover Phase 1 needs
- REQ-UI-005 (QR-code receipt) → Phase 2 — thermal print is the Phase 1 surface (D-01)

### Phase 1.5: Public demo + landing page

**Goal**: Anyone with a browser can click through the fartOLa UI end-to-end and leave feedback before Phase 2 ships.
**Depends on**: Phase 1
**Requirements**: (no new REQ-IDs — derived from Phase 1's REQ-UI surface)

**Scope decision (2026-05-15)**: ship `.planning/phases/01-single-laptop-training-mvp/01-SKETCHES/claude-design-bundle/project/` as the demo. It's already a standalone React+Babel SPA with mock data, no backend required, and covers wizard / home / readout / results / walk-up / 6 receipt templates / tweaks panel. The sketches were the *design* the implementation was built from — minor drift between sketch and built app IS itself feedback. Avoid a separate "mock service mode" for the SvelteKit app unless v1 feedback shows the drift is too large.

**Success Criteria** (what must be TRUE):
  1. GitHub Pages site live at a stable URL (e.g. `https://jhagberg.github.io/fartOLa/`).
  2. Landing page (single static HTML) explains what fartOLa is, who it's for, and links to the demo + repo + feedback channel.
  3. The sketches bundle is reachable at `/demo/` on the same site — clicking through works in modern browsers (Chrome / Firefox / Safari current).
  4. Feedback path is clickable from the page (pre-filled GitHub issue template, or a Tally/Google Form embed) — feedback in <60 seconds.
  5. Deploy is automatic on push to `main` via GitHub Actions (`actions/upload-pages-artifact` + `actions/deploy-pages`).

**Plans** (provisional — flesh out via `/gsd-discuss-phase 1.5`):
  - Plan A: Landing page (static HTML, repo-root `docs/` or `site/`) with intro, screenshots, "Try the demo" CTA, repo link, feedback link. ~half a day.
  - Plan B: GitHub Pages deploy workflow + repo settings (artefact bundling, pages branch, custom 404). Workflow copies `docs/` + sketches `project/` into the deploy artefact. ~2 hours.
  - Plan C (optional): Feedback channel — pre-filled GitHub issue template (`.github/ISSUE_TEMPLATE/demo-feedback.yml`) and/or Tally embed. ~1 hour.

Phase 1.5 is explicitly non-blocking for Phase 2 — if the StorTuna club is ready to use Phase 1 in production before 1.5 lands, ship Phase 1 to them and run 1.5 in parallel.

**Future option (out of scope here)**: a Phase 1.6 / Phase 2 follow-up could ship a *real* SvelteKit-mock build to keep the demo pixel-aligned with shipped code. Decide after Phase 1.5 v1 collects feedback.

### Phase 2.0: 4-klubbs MVP (parallel with MeOS)

**Goal**: Run a real 4-klubbs training at Stora Tuna OK on Wednesday 2026-05-20 with fartOLa as the primary registration + readout system, MeOS running in parallel as a safety backup. Each registration in fartOLa pushes to MeOS via MIP so MeOS has the runner if it ever does its own card readback; fartOLa receives MeOS's MOP feed so we can recover from a fartOLa crash.
**Depends on**: Phase 1
**Requirements**: Phase 1 + REQ-STD-004 (partial — runner DB only, no entries pull/push), REQ-EXT-MEOS-001 (new — MIP/MOP coexistence; entry added to REQUIREMENTS.md by Plan 02-01)
**Success Criteria** (what must be TRUE):
  1. 4-klubbs 2026-05-20 runs end-to-end on fartOLa; MeOS is alive but never needed.
  2. Eventor löpardatabasen import works: typing or reading a known SI bricka auto-fills name + klubb in walk-up.
  3. Every walk-up registration in fartOLa shows up in MeOS within ~5 seconds via MIP `<entry>`.
  4. Hyrbricka flag survives the round-trip: fartOLa toast at finish-readout AND MeOS reminder both fire for hired cards.
  5. Course-only model (no Klasser) works for 4-klubbs's 5-course bundle (Vit / Grön / Gul / Orange / Violett).
  6. If fartOLa is killed mid-event, MeOS-side registrations done during the outage are picked up via MOP on fartOLa restart.
**Plans**: 10 plans (7 active for 4-klubbs; 2 deferred to Phase 2.1; 1 added 2026-05-17 as a 4-klubbs blocker fix)
  - [x] 02-01-PLAN.md — Wave 0 [BLOCKING]: Drizzle migration 0002 (6 new tables + competitors.source) + Eventor saxes streaming parser + ingest cache + scheduleEventorBoot + admin refresh route + ADR-0009 + REQ-EXT-MEOS-001 entry
  - [x] 02-02-PLAN.md — Wave 1: WalkupModal Bana label + Hyrbricka checkbox + Eventor autocomplete (si_card pre-fill + name prefix) + competitors transactional hired_cards write + TweaksPanel Eventor status + walkup-eventor e2e
  - [x] 02-02b-PLAN.md — Wave 2: Registration-desk screen (/competition/:id/registration) + cardQueue Svelte rune store (FIFO + dedupe) + cardSubscription shared WS service (refactors ReadoutView WS code) + WalkupModal onClose callback + auto-advance + dedupe toast + registration-queue e2e (added late 2026-05-16 — addresses ReadoutView.svelte:406-414 silent-drop site)
  - [x] 02-03-PLAN.md — Wave 1: MIP GET /mip Fastify route + shared.ts (MIP_NS / MOP_NS / normalizers) + mip.xsd v3.0 pinned + XSD round-trip tests + card-replace re-emit verification (D-MIP-1/2/3/4)
  - [x] 02-04-PLAN.md — Wave 2: MOP POST /mop Fastify route + mop.xsd v2.0 pinned + transactional shadow-table writes + D-MOP-3 auto-merge + meos_merge WS broadcast + ReadoutView toast
  - [x] 02-05-PLAN.md — Wave 2: hiredCards REST (GET list + PATCH return) + readout.ts hired_card_open extension + HyrbrickaToast + ReadoutView Set-based dismissal + ActiveHyrbrickorView admin page + hyrbricka e2e
  - [x] 02-06-PLAN.md — Wave 3: retention.ts hired_cards.contact_* scrub + docs/ops/parallel-meos-runbook.md + bench-smoke-phase2.sh + Wednesday-morning bench checkpoint
  - [x] 02-07-PLAN.md — Settings UI + integration-keys API for managing EVENTOR_API_KEY (and future Livelox / Liveresultat keys) from the operator UI instead of env files
  - [ ] 02-08-PLAN.md — Wave deferred → Phase 2.1: Event admin codes (`<word>-<NNN>`) for mobile sekretariat-helpers; LOCKED 35-word Swedish O-feature wordlist; rate-limited /access endpoint + signed cookie + redact extension; ADR-0010
  - [ ] 02-09-PLAN.md — Wave 3 [BLOCKING for walk-up autocomplete]: Drop UNIQUE on `eventor_competitors.si_card` (federation data has legitimate duplicates); tri-state `lookupBySiCard` with context-aware disambiguation (active-competition match → recency rule fallback); WalkupModal `+N andra` chip + override picker; added 2026-05-17 after real Eventor ingest crashed against a working API key
  - [ ] 02-10-PLAN.md — Wave deferred → Phase 2.1: Persistent Eventor event-ID linkage on `competitions` table; wizard step-1 Eventor-quickstart prefill; ImportRunnersView linked-card collapse with [Relink]; Tävling list Eventor chip

### Phase 2.1: Sanctioned-competition foundations

**Goal**: Close operational gaps from the 4-klubbs event and add features needed for a real sanctioned sprint competition (Gundes Sommarsprint, June 2026) with 100-200 starters and 2 workstations. MeOS remains a parallel safety backup.
**Depends on**: Phase 2.0
**Requirements**: REQ-UI-008, REQ-STD-004 (full pull + push), REQ-OPS-004
**Success Criteria** (what must be TRUE):
  1. Eventor entries pull (already built) and results push + startlist push work end-to-end.
  2. Two browser clients connected to one edge-bridge (multi-serial, admin codes for LAN access).
  3. Start list lottning (SOFT/Random/Simultaneous) produces drawn start times visible in all views.
  4. Kvar-i-skogen: operator reads check-unit backup, sees who is still in the forest.
  5. Liveresultat push sends MOP XML 2.0 to liveresultat.orientering.se without blocking local results.
  6. MeOS classid fix: MIP entries include classid from REST auto-discovery.
  7. Gundes Sommarsprint (June 2026) runs on this stack with MeOS as backup.
**Plans**: 13 plans

Plans:
  - [x] 02.1-01-PLAN.md — Wave 1: Schema migration 0007 (start_time_ms, max_time_sec, liveresultat cols, course_replacements table) + reducer extensions (MAX auto-compute, voided legs, replacement controls) + voided-leg routes
  - [x] 02.1-02-PLAN.md — Wave 2: Start list draw algorithms (SOFT club-blocking, Random, Simultaneous) + lottning route + re-lotta + per-runner edit
  - [x] 02.1-03-PLAN.md — Wave 2: IOF XML 3.0 StartList export (buildStartListXml) + StartList import + export/import routes + thermal print
  - [x] 02.1-04-PLAN.md — Wave 2: Multi-serial SI readers (repeatable --serial flag, BridgeLifecycle array, position-aware WS broadcast, per-reader health)
  - [x] 02.1-05-PLAN.md — Wave 3: LottningView UI + start-time column in RegistrationView/ReadoutView + subsecond timing display
  - [x] 02.1-06-PLAN.md — Wave 3: Kvar-i-skogen (readBackupMemory in sportident package, checkunit snapshot route, KvarISkovenView diff + safety-call summary)
  - [x] 02.1-07-PLAN.md — Wave 3: Liveresultat push (MOP XML 2.0 builder, pushToLiveresultat, async retry queue, trigger route)
  - [x] 02.1-08-PLAN.md — Wave 3: Eventor results + startlist push (pushToEventor with PKZIP-archived IOF XML 3.0 via yazl, push routes, EventorPublishView)
  - [x] 02.1-09-PLAN.md — Wave 2: MeOS classid fix (classCache from REST ?get=class, MIP entry builder classid emission)
  - [x] 02.1-10-PLAN.md — Wave 2: SI card dedup carry-over (migration 0008, tri-state lookupBySiCard, WalkupModal +N andra chip)
  - [ ] 02.1-11-PLAN.md — Wave 3: Eventor event linkage carry-over (migration 0009 index, event proxy route, wizard quickstart, ImportRunnersView collapse, CompetitionList chip)
  - [ ] 02.1-12-PLAN.md — Wave 4: Admin codes carry-over (migration 0010 event_codes table, wordlist, auth functions, /access route, preHandler gate, AccessView, ADR-0010)
  - [x] 02.1-13-PLAN.md — Wave 5: Quality fixes (DQ punch contamination, POST /status idempotency, auto-DNF distinction, StatusPill aria IDs) + MeOS SQL dump replay harness

Phase 2.1 rescope (2026-05-23): Yjs, spectator page, and peer-sync deferred to Phase 2.2+.
Phase 2.1 carry-overs from Phase 2.0: 02-08 (admin codes), 02-09 (SI card dedup), 02-10 (Eventor event linkage).

### Phase 3: Children's finish, public engagement

**Goal**: The visible UX leap. Kids' finish screen, parent notifications, embeddable live widget.
**Depends on**: Phase 2
**Requirements**: REQ-UI-009, REQ-UI-010, REQ-UI-011, REQ-UI-012
**Success Criteria** (what must be TRUE):
  1. Kids' finish HDMI screen runs at arena: animated, TTS, configurable.
  2. Parent SMS opt-in pipeline tested with 10+ real families.
  3. Speaker dashboard used live by a real arena announcer.
  4. Big-screen overlay customized per club logo/colors.
  5. At least one parent says "this is way better" unprompted.
**Plans**: TBD

### Phase 4: Multi-arena, radio controls

**Goal**: Competition with radio controls feeding live punches, multiple WiFi cells, full peer-to-peer sync.
**Depends on**: Phase 3
**Requirements**: REQ-HW-005..009, REQ-EVT-005..007, REQ-EVT-CMP-009..011, REQ-STD-005, REQ-STD-006, REQ-STD-007, REQ-OPS-005, REQ-OPS-006, REQ-PRIV-003, REQ-PRIV-004
**Success Criteria** (what must be TRUE):
  1. Receive punches from a ROC radio control in the wild.
  2. SIRAP gateway accepted by an existing MeOS install for testing.
  3. Two edge-bridges sync events under simulated partition; no data loss.
  4. Relay-day at a regional cup runs end-to-end on this stack.
  5. Score-event support proven at a rogaining.
**Plans**: TBD

### Phase 5: O-ringen scale

**Goal**: Demonstrable capacity for a five-stage event with 25 000+ starters.
**Depends on**: Phase 4
**Requirements**: REQ-STD-008, plus performance and operational hardening across all earlier REQs
**Success Criteria** (what must be TRUE):
  1. Partitioned Postgres per stage validated.
  2. CDN tier (Cloudflare or self-hosted) tested at 30 000 concurrent viewers.
  3. 4G/5G+Starlink bonded uplink playbook documented and run-once.
  4. Livelox API integration working under their approval.
  5. IOF result-feed compliance validated by federation.
  6. System pitched to O-ringen organizing committee without lying.
**Plans**: TBD

## Cross-cutting (all phases)

These must be respected throughout, not deferred to a phase:

- Tests run on real hardware before any release tag.
- ADRs (`.planning/adr/NNNN-title.md`, MADR 4.0.0 format) for non-obvious decisions.
- README, PROJECT.md, research notes stay current.
- Swedish-first UI strings. Plain language over jargon.
- Backwards compatibility with SI5 cards and IOF XML 2.0.3.
- AGPL-3.0 application, MIT for `packages/sportident`.

## Progress

**Execution Order:** Phases execute in numeric order: 0 → 1 → 1.5 → 2.0 → 2.1 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Hardware proof | 6/6 | Complete | 2026-05-13 |
| 1. Single-laptop training MVP | 18/18 | Complete | 2026-05-16 |
| 1.5. Public demo + landing page | 3/3 | Complete | 2026-05-15 |
| 2.0. 4-klubbs MVP (parallel with MeOS) | 0/7 | Planned | hard deadline 2026-05-20 |
| 2.1. Sanctioned-competition foundations | 11/13 | In Progress|  |
| 3. Children's finish, public engagement | 0/TBD | Not started | - |
| 4. Multi-arena, radio controls | 0/TBD | Not started | - |
| 5. O-ringen scale | 0/TBD | Not started | - |
