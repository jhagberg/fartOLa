---
status: accepted
date: 2026-10-05
decision-makers: [Jonas Hagberg]
---

# SportIdent protocol code isolated in MIT-licensed package

## Update 2026-10-05

The decision of 2026-05-12 stands. Facts as built:

- **Provenance:** `packages/sportident/` (`@fartola/sportident`, MIT) is
  mostly a port of `allestuetsmerweh/sportident.js` (MIT), with per-file
  attribution headers. The GPL implementations `sportident-python` and `GecoSI`
  are read for reference only (`packages/sportident/NOTICE.md`). The legal
  exposure is therefore mainly inherited MIT code, not new reverse engineering.
- **Gate:** `scripts/check-mit-attribution.sh` runs in `pnpm lint` (and so in
  CI). It fails when a ported file lacks the MIT header.
- **Interface:** there is no `SiReader` abstraction. Consumers use
  `SerialTransport` + `SiMainStation` and the NDJSON types (`NdjsonPunch`,
  `HalfDayClock`, `CardReadEvent`).
- **Consumers:** besides `apps/edge` and `packages/shared-types`, the private
  tools repo uses the package through a linked checkout (ADR-0015). It is not
  published to npm.

The original text below is kept as recorded.

## Context and Problem Statement

The SportIdent serial protocol has no official open license;
implementations rely on reverse engineering for interoperability. What
is the right legal and architectural containment for this code?

## Considered Options

- Embed SI protocol code throughout the codebase under the main
  AGPL-3.0 license
- Isolate SI code in a dedicated package under a permissive license
  (MIT)
- Use only the official SPORTident SDK (request-only, restrictive
  terms)

## Decision Outcome

Chosen option: **isolate in `packages/sportident/` under MIT**, because
(1) reverse engineering for interoperability is permitted under EU
InfoSoc Directive Art. 6, (2) SPORTident has tolerated third-party
implementations (MeOS, SI-Droid, OE12, QuickEvent) for 20+ years, and
(3) scoping the legally sensitive code to one MIT-licensed package
limits worst-case exposure while letting the rest of the project use
AGPL-3.0. Other packages consume a clean async `SiReader` interface.

## More Information

- Interface sketch in
  [architecture.md](../../.planning/research/architecture.md)
  §"SportIdent isolation" (the sketch was not built as written; see the update).
- [NOTICE.md](../../packages/sportident/NOTICE.md),
  [check-mit-attribution.sh](../../scripts/check-mit-attribution.sh).
- Related: [ADR-0001](0001-reimplement-do-not-fork-meos.md),
  [ADR-0015](0015-helper-tools-in-private-repo.md).
