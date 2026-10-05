---
created: 2026-10-05T12:00:00+02:00
title: Reader client in the browser — read SI cards in any Chrome and send them to the server
area: readout
files:
  - packages/sportident/src/transport/SerialTransport.ts
  - apps/edge/src/si/bridge.ts
  - .planning/adr/0002-three-tier-architecture.md
---

## Problem

Today the SI reader must be plugged into the machine that runs the edge
server. A second readout station means a second machine set up by hand,
and the server box has to sit where the readout is. ADR-0002 rejected
"browser talks to SI hardware" in 2026-05 because iOS Safari and Firefox
have no Web Serial, Chrome on Android was limited, and a closed tab must
not lose punches.

Still true: no Web Serial on iOS or Firefox. Changed or never the point:
Web Serial works in Chrome/Edge on Windows, Mac, Linux and ChromeOS; on
Android, WebUSB can drive the CP210x (upstream `sportident.js`, which our
package is ported from, had a WebUSB transport). The protocol code in
`@fartola/sportident` is plain TypeScript.

## What

Keep the server (event log, scoring, print, Eventor/MeOS/liveresultat).
Add a reader client: a page in the web app that opens the SI reader with
Web Serial (WebUSB on Android) and posts each card read to the server
like the edge's own bridge does.

- `WebSerialTransport` next to `SerialTransport`, same interface; reuse
  `SiMainStation` and the NDJSON card format unchanged.
- Card reads get a client-generated id; the server deduplicates on it, so
  a resend is harmless.
- Reads are queued in IndexedDB until the server acknowledges them; the
  page shows unsent reads and resends on reconnect.
- The server shows each reader client as a station with last-heard time;
  a closed tab or sleeping laptop shows up as silent (same idea as the
  radio watchdog).
- Operator-only like other writes (event code / operator session).
- New ADR that amends ADR-0002: the edge still owns the event log; a
  reader may sit in a browser client.

## Tests

- Fake Web Serial port → `SiMainStation` → one card read posted.
- Server down: reads queue, then all arrive once, no duplicates.
- Same read posted twice → one `card_read` event.
- Bench: BSM8-USB on Chrome (Linux, Windows, Mac) and Android via WebUSB.
