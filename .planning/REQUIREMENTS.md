# REQUIREMENTS

Scoped requirements with REQ-IDs. Each requirement maps to one or more
phases in `ROADMAP.md`. Scoping uses three buckets:

- **v1** — MVP scope; must work for Phase 1–2 (club training + small competition)
- **v2** — extended scope; must work for Phase 3–5 (kids' finish + radio controls + O-ringen)
- **out** — explicitly not in scope for this project

REQ-IDs are stable and never renumbered. If a requirement is dropped,
it is marked `[dropped]` but the ID stays.

---

## Hardware integration

**REQ-HW-001 (v1)** — Read SI8, SI9, SI10, SI11 cards via BSM7/BSM8-USB
on Linux, macOS, and Windows. Parse all punches into structured form.
✅ **Linux read-chain completed in Plan 00-03 + Plan 00-04** — SI9/SI10/
SIAC decoders + BSM7/8 handshake + SI8_DET dispatch + GET_SI8 page-4
read; verified at the station level against upstream fixtures. SI11 and
macOS/Windows deferred to Phase 1.

**REQ-HW-002 (v1)** — Read SI5 cards. Legacy support is non-negotiable;
clubs still own SI5s.
✅ **Completed in Plan 00-03 + Plan 00-04** — SiCard5 decoder + GET_SI5
single-frame read path verified end-to-end through SiMainStation against
upstream fixture (16-punch + full 36-punch).

**REQ-HW-003 (v1)** — Read SIAC cards (Air+). Treat beacon punches as
regular punches when received via SRR dongle or station readout.

**REQ-HW-004 (v1)** — CRC16-CCITT-0x8005 validation on every incoming
frame. Reject malformed frames with logged diagnostic.
✅ **Completed in Plan 00-02** — siProtocol.ts CRC16 + parse + parseAll
with typed FrameError callback; 10 frozen vectors locked.

**REQ-HW-005 (v2)** — Receive autosend (`0xD3`) punches from BSF8/9
control stations configured in punch mode.

**REQ-HW-006 (v2)** — SRR USB dongle support for live SIAC beacon punches.

**REQ-HW-007 (v2)** — SI-Master / TimeMaster clock sync across stations.

**REQ-HW-008 (v2)** — BS11-BS/BL/LA contactless beacon station support.

**REQ-HW-009 (v2)** — SI-GSM / LTE-Modem support for cellular punch upload.

---

## Event log and synchronization

**REQ-EVT-001 (v1)** — Every punch becomes an immutable event
`(node_id, local_seq, event_type, event_time_ms, recorded_at_ms, payload)`.

**REQ-EVT-002 (v1)** — Edge node persists events to local SQLite in
append-only fashion. No UPDATEs or DELETEs on the `events` table.

**REQ-EVT-003 (v1)** — All derived state (results, splits, placements,
DNF status, class standings) is computed by stateless reducers over
the event log. No mutable result tables.

**REQ-EVT-004 (v1)** — Reducers must be deterministic and idempotent;
re-running them over the same log produces identical projections.

**REQ-EVT-005 (v2)** — Edge nodes synchronize their event logs with
peers over LAN/WAN using a custom push protocol. Dedupe by primary key
`(node_id, local_seq)`. No central coordinator required.

**REQ-EVT-006 (v2)** — Edge node tolerates network partition: continues
to write events locally, syncs when connectivity returns. No data loss
under any partition scenario.

**REQ-EVT-007 (v2)** — Central tier (optional) aggregates events from
all edge nodes into Postgres. Drives ElectricSQL read-sync to public
viewers.

---

## Competition workflow

**REQ-EVT-CMP-001 (v1)** — Create a new competition: name, date,
classes, courses. Persistable to local SQLite.

**REQ-EVT-CMP-002 (v1)** — Import a Purple Pen XML course file.
Auto-create classes if not already present.

**REQ-EVT-CMP-003 (v1)** — Import IOF XML 3.0 EntryList for start
list registration. Match competitors to classes.

**REQ-EVT-CMP-004 (v1)** — Manual entry: register a competitor at
readout time who was not pre-entered (walk-up registration).

**REQ-EVT-CMP-005 (v1)** — Auto-assign a punched card to its
matching course when the start list has the SI number; fall back to
operator confirmation otherwise.

**REQ-EVT-CMP-006 (v1)** — Mark DNF / MP based on missing or
out-of-order punches against the expected course.

**REQ-EVT-CMP-007 (v1)** — Display live results page (HTML) on
localhost during the event.

**REQ-EVT-CMP-008 (v1)** — Export final results as IOF XML 3.0
ResultList. Validate against XSD before saving.

**REQ-EVT-CMP-009 (v2)** — Relay support (2-leg, 3-leg, Tiomila,
Jukola, 1-man relay). Per-leg start, mass start, restart.

**REQ-EVT-CMP-010 (v2)** — Score event (rogaining): variable points
per control, time penalty for overstaying.

**REQ-EVT-CMP-011 (v2)** — Patrol / pair / group registration where
multiple competitors share a card or run together.

**REQ-EVT-CMP-012 (v1)** — Keep the start and finish records the card
still holds (main and reserve), as read, in the card-read event: each
with its own time, fraction, station code and origin, and "unknown" or
"not read" where that is the case. Never keep the card holder data,
neither as bytes nor as decoded text. (ADR-0019)

**REQ-EVT-CMP-013 (v1)** — The time that counts: the first valid finish
punch, unless a time at the line or a recorded decision goes first. The
start follows the class's start choice (ADR-0018): `start_time` the
stored time; `start_punch` and `free_start` the first valid start punch,
else the stored time; `auto` the stored time, else the first valid
punch. Validity (race, day across midnight, clear, check, start window)
is evidence for review, not a hard rule. (ADR-0019, TR 4.18.9, TR 4.20.6)

**REQ-EVT-CMP-014 (v1)** — Show every available candidate, the one used
and why, compared before rounding and by code and origin. A missing or
unread reserve record shows as "first punch unknown". Conflicts are
marked for review.

**REQ-EVT-CMP-015 (v1)** — The secretariat can pick another candidate
or enter a time, with a reason, stored as a new event that names the
read and the record chosen, and undoable; originals are never changed.
A finish judge's order (TR 4.20.8, dead heats included) is a separate
decision and never made by altering times.

**REQ-EVT-CMP-016 (v1)** — Results, lists and exports use the decided
time and finish order. A new read-out, an undo, a rebuild or a race
reset never removes earlier data or a manual decision; a change of start
time or start choice after a read gives one consistent result
everywhere.

---

## User interface

**REQ-UI-001 (v1)** — Web UI (PWA) accessible on Chrome desktop and
Chrome Android. Must work on tablet form factor.

**REQ-UI-002 (v1)** — Three-click new-competition flow matching the
MeOS UX bar: create event → attach SI reader → ready to read out.

**REQ-UI-003 (v1)** — Readout view shows live feed of cards read,
matched to course, results visible immediately. No page reload needed.

**REQ-UI-004 (v1)** — Print thermal paper receipt with splits via
ESC/POS. Star TSP143, Epson TM-T20, Brother PJ-7 supported via
`escpos-printer-db`.

**REQ-UI-005 (v1)** — QR-code receipt: show QR on readout screen,
competitor scans, sees their splits and provisional ranking on phone.

**REQ-UI-006 (v1)** — Swedish UI strings as primary. English as
secondary. Translation infrastructure (i18next) from day one.

**REQ-UI-007 (v1)** — Accessibility: usable in bright sunlight on
13" laptop. No 12 px gray-on-white. Large hit targets for stressed
operators.

**REQ-UI-008 (v1)** — Multi-operator simultaneous editing of start
list, classes, and registrations. Yjs CRDT for shared form fields.
Live cursor presence.

**REQ-UI-009 (v2)** — Speaker dashboard: upcoming finishers, dramatic
moments, name pronunciation guides.

**REQ-UI-010 (v2)** — Big-screen overlay configurable per club:
logo, colors, fonts. HDMI from Pi or Android TV. OBS / vMix feed
support (NDI, XML/JSON).

**REQ-UI-011 (v2)** — Kids' finish screen: animated, per-name TTS,
configurable per class (e.g. only for U10/U12). HDMI output, optional
Spotify song trigger per finish.

**REQ-UI-012 (v2)** — SMS / email notification opt-in for parents
on child's finish or radio-control checkpoint. Twilio / 46elks /
SendGrid.

---

## Standards and interop

**REQ-STD-001 (v1)** — IOF XML 3.0 import for EntryList, ClassList,
CourseData.

**REQ-STD-002 (v1)** — IOF XML 3.0 export for StartList, ResultList,
ClassResultsList.

**REQ-STD-003 (v1)** — IOF XML 2.0.3 import for legacy course tools.
Read-only.

**REQ-STD-004 (v1)** — Eventor REST API integration: pull entries,
push results, fetch event metadata. Handle Cloudflare-bot rate limits.

**REQ-STD-005 (v2)** — ROC protocol receiver: accept punches from
existing Pi+4G radio controls in the wild.

**REQ-STD-006 (v2)** — SIRAP TCP server: accept punches from MeOS-
compatible radio control gateways.

**REQ-STD-007 (v2)** — MeOS TCP input protocol _output_: feed our
punches into a parallel MeOS installation as a side-car during
migration.

**REQ-STD-008 (v2)** — Livelox export per their gated public API.
Requires application for API key.

---

## External integration

**REQ-EXT-MEOS-001 (v1)** — MeOS coexistence: serve MIP `<entry>`
polls so a parallel MeOS install receives fartOLa walk-up
registrations; accept MOP `<MOPComplete>` / `<MOPDiff>` POSTs so
MeOS-side state can be reconciled into fartOLa on bridge restart.
Closed LAN; no auth (revisit for sanctioned events in Phase 2.1).
See `.planning/research/meos-protocols.md` for wire formats and
`.planning/phases/02-4-klubbs-mvp/02-CONTEXT.md` for the 14 round-2
implementation decisions (D-MIP-1..4, D-MOP-1..4, D-LIM-1).

---

## Operations and reliability

**REQ-OPS-001 (v1)** — Single-binary install: `npm install -g fartola`
runs the edge bridge. No system dependencies beyond Node 22 LTS.

**REQ-OPS-002 (v1)** — Bridge process survives restart with zero
data loss. Crashed mid-readout? Restart, resume from last event in log.

**REQ-OPS-003 (v1)** — Daily SQLite backup to disk during event.
No human action required.

**REQ-OPS-004 (v1)** — Live edge-node health dashboard: SI reader
status, last punch received, peer connectivity, disk space.

**REQ-OPS-005 (v2)** — Rebuild projections from log on demand
("recompute results"). UI button in admin panel.

**REQ-OPS-006 (v2)** — Operations runbook for arena teams:
hardware checklists, network diagrams, fallback procedures.

---

## Privacy and legal

**REQ-PRIV-001 (v1)** — Personal data (name, club, SI card, email,
phone) requires explicit consent at registration. Consent timestamp
recorded.

**REQ-PRIV-002 (v1)** — Data retention: 30 days post-event for
contact information; competition results retained per federation
rules.

**REQ-PRIV-003 (v2)** — One-click data export per data subject
(GDPR Article 20).

**REQ-PRIV-004 (v2)** — One-click data deletion per data subject
(GDPR Article 17).

---

## Out of scope

**REQ-OUT-001 (out)** — Map drawing tools.

**REQ-OUT-002 (out)** — Course planning UI (Purple Pen / Condes
already excellent).

**REQ-OUT-003 (out)** — GPS replay analysis (Livelox / 2DRerun).

**REQ-OUT-004 (out)** — Custom timing hardware. We integrate with
SportIdent and ROC.

**REQ-OUT-005 (out)** — Payment processing internally. Integrate
with Swish Handel and Stripe; don't store card data.
