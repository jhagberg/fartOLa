---
status: accepted
date: 2026-10-05
decision-makers: [Jonas Hagberg]
---

# Use Markdown Architectural Decision Records

Decided 2026-05-13 (planning bundle, commit `e68dfd6`), recorded 2026-10-05.

## Context and Problem Statement

We record architectural decisions so that later readers, including future
contributors and reviewers, can see why the code has its current shape. Which
format and location should these records use?

## Considered Options

- [MADR](https://adr.github.io/madr/) 4.0.0, the Markdown Architectural
  Decision Records format
- Michael Nygard's original ADR template
- Decisions kept only in GSD phase notes (`CONTEXT.md` D-NN entries)
- No convention

## Decision Outcome

Chosen option: **MADR 4.0.0 in `docs/decisions/`**, because it is plain
Markdown, it has YAML frontmatter that can be grepped for status, and
`docs/decisions/` is MADR's canonical location, visible next to the code.
Phase notes keep phase-local decisions (D-NN). A decision that outlives its
phase, or that revises a recorded one, becomes an ADR.

Conventions:

- `NNNN-kebab-case-title.md`, numbered in sequence. IDs are never reused.
  (0008 and 0009 were deleted on 2026-05-14 and reused two days later. The rule
  holds from now on.)
- New ADRs start from [adr-template.md](adr-template.md).
- An ADR whose decision still holds but whose facts have changed is amended in
  place. Add an `## Update YYYY-MM-DD` section directly under the title, bump the
  frontmatter `date`, and state the original decision date in the note. Do not
  rewrite the original text.
- An ADR whose decision changes is superseded by a new ADR. The old ADR's status
  becomes `superseded by ADR-NNNN`, and the two link to each other.
- An ADR backfilled after the fact states both the decision date and the
  recording date.
- Do not pin library versions in ADRs. Point to `package.json` and `.nvmrc`.

### Consequences

- Good, because decisions sit next to the code and show up in PR diffs.
- Bad, because `docs/` is the GitHub Pages root. ADRs are served raw at the
  site, and every ADR edit triggers a Pages deploy.

## More Information

- Index: [README.md](README.md).
- The ADRs moved from `.planning/adr/` to `docs/decisions/` on 2026-10-07.
