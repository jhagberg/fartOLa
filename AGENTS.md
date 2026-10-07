# Working on fartOLa

Instructions for anyone changing this repo: people and AI coding agents
(Claude Code reads `CLAUDE.md`, which points here). Keep it short to
follow.

## How we work

- **Minimum code that solves the stated problem.** If 200 lines could be
  50, rewrite. Ask: would a senior engineer call this overcomplicated?
- **Stay in scope.** Every changed line should trace to the task. Bugs or
  dead code spotted in passing: mention them, don't fix them in the same
  change.
- **Surgical edits.** Match the style of the surrounding code, even if
  you would write it differently. Clean up what your change orphaned;
  leave older dead code alone unless asked.
- **State assumptions, then proceed.** Ask first only when a wrong guess
  is costly to undo (data loss, results changing, hours of rework).
- **Verifiable goals.** "Fix bug X" means a test that reproduces it, then
  the fix. "Refactor Y" means tests green before and after.

## Checks before you commit

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm e2e        # when you touch the web app or routes
```

- `pnpm lint` also runs the MIT attribution check and the SOFT rule
  matrix check (`scripts/check-compliance.mjs`).
- Web tests can time out when every package runs in parallel on a busy
  machine; rerun `pnpm --filter @fartola/web test` alone before
  concluding a test is broken.
- Changes to timing, statuses or results: the maintainer also replays two
  real competition days (ADR-0014). Their data is private; say in your PR
  that a replay is needed.

## Commits and pull requests

- **Conventional Commits**, checked by commitlint on every commit:
  `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `perf:`,
  `build:`, `ci:`, `style:`. A scope is welcome: `feat(roc):`,
  `fix(readout):`.
- **Subject:** imperative, lowercase after the colon, about 70
  characters, no full stop. commitlint rejects a sentence-case subject
  (`fix: Add …`).
- **Body only when the why isn't obvious** from the diff; explain why,
  not what, wrapped at about 72 characters.
- **One task, one commit.** Stage only that task's files
  (`git add <files>`, not `git add .`).
- Work on a branch and open a PR to `main`. `main` requires linear
  history and green CI (ci, Playwright, Trivy).

## Rules that are easy to break

- **No personal data in git.** Real competition data (MeOS databases,
  captures, Eventor entry or result files, card numbers with names) stays
  out of the repo, also as test fixtures. Tests use synthetic data.
- **Never commit secrets.** API keys go in environment variables or the
  settings screen.
- **Read the decision before you touch the area.** The ADRs in
  `docs/decisions/` are the rules; the ones that catch people most often:

| Before you touch …                                | Read                                                                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| results, statuses, draw, anything a rule decides  | [ADR-0011](docs/decisions/0011-follow-soft-rulebook-over-meos-with-gated-rule-matrix.md) SOFT over MeOS, rule matrix             |
| start times, card clocks, time zones              | [ADR-0012](docs/decisions/0012-competition-time-on-local-wall-clock.md)                                                          |
| code taken from MeOS or `sportident.js`, licences | [ADR-0001](docs/decisions/0001-reimplement-do-not-fork-meos.md), [ADR-0005](docs/decisions/0005-sportident-code-isolated-mit.md) |
| any screen                                        | [ADR-0016](docs/decisions/0016-simple-clear-ui-not-meos-parity.md)                                                               |
| the event log, projection, database               | [ADR-0003](docs/decisions/0003-event-sourcing-as-core-data-model.md)                                                             |
| writes, access, event codes                       | [ADR-0010](docs/decisions/0010-event-admin-codes-trust-model.md)                                                                 |

- **Two checks the ADRs rely on:** new files start with
  `// Authored for fartola. Not ported from upstream.` (or the header of
  the code they were ported from), and Drizzle migrations are hand-written
  with strictly increasing `when` in `apps/edge/drizzle/meta/_journal.json`.

## Where things are decided

- Architecture decisions: `docs/decisions/` (MADR). A new decision that
  others will build on gets an ADR.
- Roadmap and plans: `.planning/ROADMAP.md`, `.planning/phases/`.
- Open work: `.planning/todos/pending/`.
