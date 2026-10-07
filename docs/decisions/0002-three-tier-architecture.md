---
status: accepted
date: 2026-05-12
decision-makers: [Jonas Hagberg]
---

# Three-tier architecture: edge-bridge + browser + optional central

## Context and Problem Statement

The system must talk to SportIdent hardware, run on diverse client
platforms (Linux/macOS/Windows/Android, no iOS-as-operator), and
tolerate forest-grade network partitions. What deployment topology
supports this?

## Considered Options

- Two-tier: browser talks directly to SI hardware via WebSerial
- Three-tier: Node.js edge-bridge owns hardware; browser is pure UI;
  central server is optional internet-only aggregator
- Single-tier: native desktop app (Electron / Tauri) bundles everything

## Decision Outcome

Chosen option: **three-tier**, because WebSerial is not supported on
iOS Safari or Firefox and has no roadmap there; Chrome Android support
is limited; a closed browser tab must not lose punches. A separate
edge process owns the hardware connection and the local event log;
browsers connect over HTTP/WebSocket — a model every platform supports
identically. The central tier is **optional** — a club training event
runs on a single edge-bridge with no internet.

## More Information

- Full topology in `.planning/research/architecture.md` §"Three tiers".
- Related: ADR-0004 (ElectricSQL read-sync), ADR-0006 (tech stack).
