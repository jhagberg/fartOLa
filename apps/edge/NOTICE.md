# fartOLa — Cumulative third-party attribution

The `fartola` binary distributed by this package bundles several open-source
projects. The package as a whole is **AGPL-3.0-or-later** licensed
(see `LICENSE` at the repo root); the bundled components retain their
original licenses below.

## Workspace siblings bundled into this binary

Plan 18 of Phase 1 packages the fartOLa edge bridge as a single tarball
by bundling the workspace siblings (`@fartola/sportident` +
`@fartola/shared-types`) via tsup's `noExternal` so users don't need a
separate publish step. Their licenses still apply to the bundled code:

### @fartola/sportident — MIT

- **Repository:** <https://github.com/jhagberg/fartOLa> (this monorepo,
  `packages/sportident/`)
- **License:** MIT (see `packages/sportident/LICENSE`)
- **Provenance:** Ported from `allestuetsmerweh/sportident.js` (MIT). Per-file
  attribution headers in `packages/sportident/src/` carry line-level credit;
  `packages/sportident/NOTICE.md` is the package-level summary that also
  lists `per-magnusson/sportident-python` (GPL — reference only, no code
  copied) and `sdenier/GecoSI` (GPL — reference only).

### @fartola/shared-types — MIT

- **Repository:** <https://github.com/jhagberg/fartOLa> (this monorepo,
  `packages/shared-types/`)
- **License:** MIT (see `packages/shared-types/LICENSE`). Authored for
  fartOLa; it contains no code ported from MeOS or other copyleft sources
  (ADR-0001: ported MeOS code stays in the AGPL apps).

## MeOS — ported code (GPL-3.0-or-later)

Selected algorithms are translated from MeOS to TypeScript (ADR-0001,
2026-10-06). Each such file starts with a `Ported from MeOS code/<file>`
header and is listed here; `scripts/check-meos-attribution.sh` (in
`pnpm lint`) fails when one is missing or when ported code appears in
`packages/sportident` or `packages/shared-types`.

- **Repository:** <https://github.com/melinsoftware/meos>
- **Copyright:** (C) 2009-2026 Melin Software HB and contributors.
- **License:** GPL-3.0-or-later (the MeOS source headers; the repository's
  `LICENSE` file is AGPL-3.0). Combined with this AGPL-3.0-or-later program
  under GPLv3 §13 / AGPLv3 §13.

Ported files:

- None yet.

## IOF Data Standard v3.0 — XSD bundled in `dist/xml/IOF.xsd`

- **Publisher:** International Orienteering Federation (IOF)
- **Source:** <https://github.com/international-orienteering-federation/datastandard-v3>
  pinned at commit `24eb108e4c6b5e2904e5f8f0e49142e45e2c5230` (master HEAD on
  2020-04-22). See `apps/edge/src/xml/NOTICE-iof-xsd.md` for the full
  provenance + bundling rationale.
- **License:** Published by the IOF without an explicit OSI license header;
  the standard is openly published for interoperability of orienteering
  software (per ADR-0007 standards-first interop).

## Production dependencies (resolved by `npm install -g` from the tarball)

The published `dependencies` block in `package.json` lists these; npm
resolves them when the operator installs the tarball. License notes:

- **fastify** (MIT) — HTTP server framework.
- **@fastify/static, @fastify/cors, @fastify/sensible, @fastify/websocket,
  @fastify/multipart, fastify-plugin** (MIT) — Fastify ecosystem plugins.
- **better-sqlite3** (MIT) — synchronous SQLite driver. Ships prebuilt
  native binaries via the WiseLibs/better-sqlite3 release pipeline so
  `npm install -g` resolves without a C++ toolchain.
- **drizzle-orm** (Apache-2.0) — type-safe SQL builder. (`drizzle-kit` is
  in devDependencies — not shipped to runtime.)
- **zod** (MIT) — schema validation.
- **fast-xml-parser** (MIT) — XML parse + emit for IOF XML import / export.
- **xmllint-wasm** (MIT) — WASM-compiled libxml2 XSD validator (RESEARCH
  §"State of the Art" — chosen over libxmljs2-xsd to avoid native build).
- **node-thermal-printer** (MIT) — ESC/POS templating for the direct USB
  thermal-print path.
- **sharp** (Apache-2.0) — image preprocessing for the Kids receipt
  template's Skogis bitmap conversion.
- **serialport** (MIT, via `@fartola/sportident`) — SerialPort native binding
  for the BSM7/8-USB reader.

## Web (`apps/web/build/`) bundled into `dist/web/`

The SvelteKit SPA is built once during `scripts/build-tarball.sh` and
shipped as static files in `dist/web/`. The SvelteKit runtime + Svelte 5
authored client code is AGPL-3.0-or-later as part of this application.
Web-side third parties (i18next MIT, Svelte MIT, Vite MIT) ship as
minified bundles inside `dist/web/_app/`.

## Fonts

Phase 1 ships system fonts only; no font files are bundled. Phase 2 may
embed Atkinson Hyperlegible / Geist / IBM Plex via the children's finish
screen (all SIL OFL); attribution will be added when those land.

## License compliance summary

The fartOLa binary is **AGPL-3.0-or-later** as a whole. The bundled MIT
components retain MIT compatibility (AGPL accepts MIT-derived code).
Operators distributing modified versions of this binary must release the
source under AGPL-3.0-or-later and offer network-service recipients access
to the corresponding source per AGPL §13. Re-distribution of unmodified
tarballs requires preserving this NOTICE.md alongside the LICENSE.
