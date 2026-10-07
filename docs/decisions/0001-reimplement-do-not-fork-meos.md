---
status: accepted
date: 2026-10-06
decision-makers: [Jonas Hagberg]
---

# Do not fork MeOS; port selected parts with attribution

## Update 2026-10-06: porting selected MeOS code is allowed

Not forking MeOS still stands (decided 2026-05-12). Copying its code is no
longer ruled out. The original reason, "MeOS is AGPL, and AGPL §13 is too
heavy", was wrong on both counts:

- **MeOS's license is mixed.** The repository's `LICENSE` file is the GNU
  AGPL v3, while the source files carry the GNU GPL v3-or-later header (for
  example `meosversion.cpp`). Either way, GPLv3 and AGPLv3 §13 allow the two
  to be combined.
- **fartOLa is already `AGPL-3.0-or-later`** (root `LICENSE`, `apps/edge`,
  `apps/web`), so it already carries the obligations the original text
  called "too heavy".

**The real reasons not to fork** are technical. MeOS is a C++/Win32
desktop application, while fartOLa is TypeScript on Node and the web
(ADR-0006). The data models do not fit: MeOS keeps mutable shared tables
owned by one master, while fartOLa is an event log on autonomous edge nodes
(ADR-0002, ADR-0003). And where SOFT's rulebook and MeOS differ, fartOLa
follows the rulebook (ADR-0011).

### Rules from now on

1. **Behaviour and names may be mimicked freely.** Rules, calculations and
   the names of concepts (draw methods, list names, statuses) that work like
   MeOS's make it easier for secretariats to switch. Cite the MeOS source by
   `file:line` in comments, plans and tests as today. MeOS's screens,
   dialogs and click flows are not copied; fartOLa designs its own UI
   (ADR-0016).
2. **Selected MeOS code may be ported** (translated to TypeScript) where it
   saves effort or gets a tricky algorithm right, for example the draw
   (lottning) or time handling. A ported file:
   - lives only in the AGPL parts (`apps/edge`, `apps/web`), **never** in
     the MIT packages `packages/sportident` (ADR-0005) or
     `packages/shared-types`;
   - starts with a header naming the source and keeping its notice:
     `Ported from MeOS code/<file> (melinsoftware/meos, GPL-3.0-or-later).
Copyright (C) Melin Software HB and contributors. Modified for fartOLa
<date>.`;
   - is listed in `apps/edge/NOTICE.md` under a MeOS section.
3. **Ported code still follows SOFT** where the rulebook differs (ADR-0011),
   and it gets fartOLa's own tests; MeOS's behaviour is not a test oracle on
   its own.
4. **New files written from scratch** keep the header "Authored for fartola.
   Not ported from upstream."

### Consequences

- Good, because proven algorithms can be reused instead of re-derived, and
  similar functions lower the threshold for MeOS users.
- Bad, because ported files carry Melin Software's copyright. fartOLa as a
  whole can then only be relicensed (for example dual-licensed) after those
  files are rewritten or with the copyright holders' permission.
- Neutral: the MIT packages are unaffected as long as rule 2 holds.

### Confirmation

When the first MeOS file is ported, extend `scripts/check-mit-attribution.sh`
(or add a sibling check in `pnpm lint`) so that a `Ported from MeOS` header
anywhere under `packages/sportident/` or `packages/shared-types/` fails the
lint, and so that every file with that header is listed in
`apps/edge/NOTICE.md`.

The original text below is kept as recorded.

## Context and Problem Statement

MeOS is the dominant orienteering competition management system in
Sweden, with a mature feature set and proven UX. Should this project
fork its codebase or reimplement from scratch?

## Considered Options

- Fork MeOS and modernize on top
- Clean-room reimplement, drawing inspiration but sharing no code

## Decision Outcome

Chosen option: **clean-room reimplement**, because MeOS is licensed
**AGPL-3.0** (not GPL-3.0). A derived network-accessible service
triggers source-publication obligations to remote users under AGPL
§13, which is heavier than this project is willing to carry. We
reimplement with inspiration but no shared code.

## More Information

- MeOS source: <https://github.com/melinsoftware/meos>
- Related: [ADR-0005](0005-sportident-code-isolated-mit.md) (SportIdent code
  isolated in MIT-licensed package),
  [ADR-0011](0011-follow-soft-rulebook-over-meos-with-gated-rule-matrix.md)
  (where fartOLa departs from MeOS behaviour).
- Repo text that still says "AGPL" about MeOS, to fix:
  `.planning/research/ecosystem.md:40,224` and
  `.planning/phases/00-hardware-proof/00-CONTEXT.md:174`. The last one is a
  historical phase note, so leaving it is fine.
