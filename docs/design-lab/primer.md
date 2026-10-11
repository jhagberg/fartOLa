# Design lab: start here

Primer for a fresh Claude session. Read this, then `AGENTS.md` and
`docs/decisions/0016-simple-clear-ui-not-meos-parity.md`, before proposing
anything. Kept as the starting brief of the lab; plans 1 and 2, the spec
and the audit sit next to it.

## Goal

Explore whether fartOLa's look can get calmer and clearer, and come back with
a small, concrete proposal: token changes plus before/after screenshots of a
few key screens. Lab first, product later: nothing here merges until Jonas
has looked at it.

## Where

- Worktree: `~/src/fartOLa-workdirs/design-lab`, branch `design/lab` (from
  main `a58351d`, M1 draw UI included). Experiment freely here.
- Design tokens: `apps/web/src/lib/tokens.css` (spacing, typography, the
  60/30/10 colours, 4 status colours, density modifiers, a high-contrast
  bright-sun mode). Components style themselves in scoped `<style>` blocks:
  `apps/web/src/lib/ui/` (Button, Card, Modal, StatusPill, ...),
  `apps/web/src/lib/layout/`, screens in `apps/web/src/lib/screens/`.
- Texts: `apps/web/src/lib/i18n/sv.json`.
- Static demo (mirrors the app with mock data): `docs/demo/`.

## Who it is for (this decides every trade-off)

Club volunteers aged 40-70 at the readout table or secretariat, under time
pressure, on a laptop or tablet, sometimes outdoors in bright light or in a
dim tent. They glance, they don't study. ADR-0016 wins every conflict with
any style guide: show before acting, undo instead of "are you sure",
plain Swedish, visible state, and rule 7: text contrast at least 4.5:1 (aim for
7:1 at readout), body text at least 16 px, touch targets at least 44 px,
status never by colour alone, and the bright-sun mode stays.

## Inputs

- UI audit against ADR-0016 (2026-10-09, ~22 high / 45 medium / 15 low
  findings, quick wins and larger changes listed at the end):
  `~/src/fartOLa-workdirs/fartOLa-docs/ui-audit-2026-10-09/REPORT.md`, 83
  screenshots in `screenshots/` next to it. Start with the cross-cutting
  findings X1-X11 (sidebar clipped at 1366x768, tablet layout, raw status
  codes, contrast, focus, touch targets): several are token/layout work.
  Note: on a local run, live updates need the port in the WebSocket origin
  allow-list (`apps/edge/src/ws/index.ts:79-98`, has :3000/:5173/:4173/:5174).
- Taste skill to look at:
  https://raw.githubusercontent.com/Leonxlnx/taste-skill/refs/heads/main/skills/minimalist-skill/SKILL.md
  Useful: flat 1px borders, scarce colour, no emoji, tabular figures.
  Conflicts with ADR-0016 / our users: grey secondary text `#787774` with no
  contrast rule, airy spacing (`py-24`) and scroll-in animations (the readout
  table needs density and instant state), and it bans Lucide, which a todo
  picked for our SVG icons (`.planning/todos/pending/`, search "Lucide").
- `ui-ux-pro-max` skill (installed) for checklists and palettes.

## Run it

```bash
export PATH=$HOME/.nvm/versions/node/v26.10.0/bin:$PATH
pnpm install --frozen-lockfile
pnpm --filter @fartola/sportident exec tsup      # fresh worktree needs this
FARTOLA_PRINTER=stdout PORT=3000 BIND_HOST=127.0.0.1 \
  DATA_DIR=/tmp/fartola-design-lab bash scripts/run-local.sh --no-bridge
# app on http://127.0.0.1:3000 (an allowed WebSocket origin); "Simulera" on the readout screen fakes cards
python3 -m http.server --directory docs 8780 --bind 127.0.0.1   # demo
```

Ports 3100 and 8765 are in use by the other session; 3000 is free. For quick layout work,
`pnpm --filter @fartola/web dev` (Vite) also works against a running edge.
Screenshots: the repo's Playwright (`npx playwright ...`) at 1366x768 and
820x1180.

## Deliverable

1. A short note (in this file or `docs/design-lab.md`): what changes and why,
   each tied to the user above or an ADR-0016 rule.
2. Token changes in `tokens.css` (and any component tweaks), small and
   reversible.
3. Before/after screenshots of: Avläsning (readout), Direktanmälan modal,
   Lottning, Tävlingsinfo, Resultat.
4. Contrast numbers for every text/background pair you change.

## House rules

- Conventional Commits, lowercase subject, no `Claude-Session:` line, stage
  only the files of that change, hooks on. Don't push; Jonas decides.
- Gate: `pnpm lint && pnpm typecheck && pnpm test`; `pnpm e2e` before
  proposing (visual changes can break selectors).
- Don't touch `packages/sportident` or SPORTident/OLA material.
