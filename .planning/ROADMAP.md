# Roadmap: fartOLa

One page: what is done, what we work on now, what comes next. Updated
when an item moves, in the same PR. The backlog is
`.planning/todos/pending/`; this page only picks from it. The phase
roadmap used until 2026-10-14 is in
`phases/ROADMAP-until-2026-10-14.md`.

## How we work

- **Every item has a goal and a "done when".** If you cannot say what
  must be true when it is finished, it is not ready to start.
- **Small PRs.** One task, one commit; review before merge (Codex
  adversarial review for anything with logic); `main` stays green.
- **Rules decide, not programs.** SOFT's rulebook over MeOS or OLA
  (ADR-0011); the rule matrix in `.planning/compliance/` is a lint gate.
- **Results and times are proven by replay** of two real competition
  days (ADR-0014) before a change that moves them is merged.
- **Decisions others build on get an ADR** (`docs/decisions/`). Big
  pieces (a new screen, a new device) get a short plan in their todo
  first; everything else goes straight from todo to PR.
- **Ideas and findings become a todo file at once**, never only a note
  in a conversation.

## Done

| Phase | What it gave | Done |
| --- | --- | --- |
| 0 Hardware proof | Reads SI cards on Linux (BSM7/BSM8) | 2026-05-13 |
| 1 Training MVP | A club training run on one laptop | 2026-05-16 |
| 1.5 Public demo | Project site with a clickable prototype | 2026-05-15 |
| 2.0 4-klubbs MVP | Code complete; the training ran on MeOS | 2026-05-22 |
| 2.1 Sanctioned-competition foundations | Lottning, kvar i skogen, several readers, liveresultat, Eventor, admin codes, replay, rule gate, competition clock, ROC radio and watchdog | 2026-10-07 |
| 2.2 Draw and class model, M1-M2 | Class kind and level, start times as events, SOFT draw, late entrants, seeding, pursuit, fees, bibs, pre-race check, closing time | 2026-10-11 |
| Design-lab plans 1-3 | The screens redone after the UI audit (ADR-0016) | 2026-10-12 |
| Start choice per class | One start answer per class (ADR-0018) | 2026-10-14 |
| Also | Speaker screen, kvar i skogen from radio, jSh/serial radio input, SIAC block 1 and reserve records, card change keeps the result, operator-mistake walker | 2026-10 |

Phase plans and their history stay in `.planning/phases/`; no new ones
are added.

## Now

| Item | Done when | Todos |
| --- | --- | --- |
| CI that does not flake | each of the three tests passes 20 runs in a row | `2026-10-14-flaky-e2e-tests` |
| Small screen bugs | search list stays closed; class switch in Lottning shows its own choice; Tävlingsinfo has one writer, one max-time format, the lock from the server, notes kept | `runner-search-dropdown-reopens`, `lottning-class-switch-shows-other-classs-choice`, the four Tävlingsinfo todos of 2026-10-11 |
| Read-out refetch | a fast pair of reads, an unknown card and an open Ändra all survive a refetch | `readout-first-load-refetch-per-card-read`, `readout-unknown-card-in-merged-refetch`, `corrections-panel-resets-inputs` |
| OLA lab: how OLA reads and decides | report with navigation, comparison table and frame log | lab session (private); feeds ADR-0019 and the red exit |

## Next

| Item | Done when | Todos |
| --- | --- | --- |
| Which start and finish time counts | ADR-0019 accepted (SOFT's answer, replay), then steps 2-4 built | `2026-10-13-sportident-answers-follow-up` item 1 |
| Times that can be wrong | late start ignores pre-race scans; splits over 12:00 and midnight are positive; DQ before read keeps punches; each with a replay | `late-start-from-pre-race-scan`, `splits-across-half-day`, `dq-before-read-keeps-punches` |
| Rule and wording fixes | no false-start button where the start punch counts; one word for a manual punch | `hide-false-start-button-for-punch-classes`, `manual-punch-one-word` |
| Medium screens | hire-card contact editable and checked; no raw server text in errors; sidebar grouped | `hire-card-contact-edit-and-validation`, `raw-server-text-in-error-messages`, `sidebar-menu-grouping` |
| Speaker demo feedback | the speaker can send feedback from the demo | link to a form in the demo (after PR 131) |
| Demo from the real app | the project site shows the app's own screens on recorded data | `2026-10-14-demo-from-the-real-app` |

## Later (each needs a short plan first)

- **Secretariat at the exit:** red exit, a missing punch from a
  station's backup, the full card memory view
  (`2026-10-14-readout-red-exit-and-card-memory-view`).
- **Stations:** a reader paired with a printer, one screen each
  (`readout-stations-reader-printer`).
- **Results like liveresultat** (`results-screen-like-liveresultat-beta`).
- **Race day (old phase 2.3):** rental-card inventory, unknown card to
  entered runner, competition leader decisions, checklist, backup during
  the race.
- **Radio:** jSh bench test (waits for a borrowed gateway), contact or
  AIR+ mode byte (waits for SPORTident), watchdog per unit, punch log.
- **Draw, rest of 2.2:** start distribution optimiser (M3a), loop and
  butterfly courses (M3b), rogaining (M4), start choice leftovers.
- **Eventor and money:** invoicing from assigned fees, dedupe of
  cardless runners, rule profiles per federation.
- **Further out:** children's finish and parent notices (old phase 3),
  several arenas and sync (old phase 4), O-ringen scale (old phase 5).

## Waiting on others

- SPORTident (Thomas): mode byte, 0xEE as code 238, reserve record
  format (Mail 8).
- SOFT: first or last finish punch, late start punch (question drafted).
- jSh (Simon): the gateway's status protocol; a gateway to borrow.
- The maintainer: real competition levels in the replay manifests.
