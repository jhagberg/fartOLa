# fartOLa

Ett tävlingssystem för orientering som körs i webbläsaren. En liten server
läser SI-brickorna, och sekretariatet arbetar på dator, platta eller
telefon. Varje stämpling sparas som en händelse, så resultaten kan räknas
om när som helst.

_An orienteering competition system. A small edge server reads SportIdent
cards; the secretariat works in the browser. Card reads and operator actions
are events, so results can always be recomputed._

**Status:** not yet used as the main system at a competition. Two real
competition days replay through fartOLa with the same results as the
official lists for all runners but one per day. See
[fartola.lindan.se](https://fartola.lindan.se) for what works, what is
missing, and the SOFT rule matrix.

## What is in the repo

| Path                    | What                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `apps/edge`             | The server: Fastify, SQLite (Drizzle), the event log and projection, SI reader, printing |
| `apps/web`              | The web app: SvelteKit, built as a static SPA served by the edge                         |
| `packages/sportident`   | SportIdent protocol and card decoding (MIT)                                              |
| `packages/shared-types` | The API contract shared by edge and web (MIT)                                            |
| `docs/decisions`        | Architecture decision records (ADRs)                                                     |
| `.planning`             | Roadmap, phase plans, todos and the SOFT rule matrix (`compliance/`)                     |
| `docs/index.html`       | The project site                                                                         |

## Get started

You need Node.js (version in `.nvmrc`) and pnpm.

```bash
pnpm install
pnpm dev          # edge + web in watch mode
```

No SI reader? Start the edge with `FARTOLA_DEV=1` (as `pnpm dev:tabs` and
`scripts/run-local.sh` do) and the readout screen can simulate cards. With
a BSM7/8-USB reader and a receipt printer, see
[apps/edge/README.md](apps/edge/README.md) for hardware setup and running
the built `fartola` binary.

## Checks

```bash
pnpm lint         # eslint, prettier, MIT attribution, SOFT rule matrix
pnpm typecheck
pnpm test
pnpm e2e          # Playwright
```

## Contributing

Read [AGENTS.md](AGENTS.md) first: it is the guide for people and AI
coding agents alike (commits, checks, what not to commit). Ideas and bug
reports are welcome as GitHub issues.

## License

The application is [AGPL-3.0-or-later](LICENSE). `packages/sportident`
and `packages/shared-types` are MIT. Third-party notices are in
[apps/edge/NOTICE.md](apps/edge/NOTICE.md).
