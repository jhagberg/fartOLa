---
status: accepted
date: 2026-10-05
decision-makers: [Jonas Hagberg]
consulted: [Codex (independent verification of every UPPFYLLD row)]
informed: []
---

# Follow SOFT's rulebook over MeOS defaults, tracked in a rule matrix that is a lint gate

Decided 2026-10-04/05, recorded 2026-10-05.

## Update 2026-10-07: the SOFT draw is fartOLa's own, measured against MeOS

Porting MeOS's draw was allowed (ADR-0001, 2026-10-06) but not done:
measured, both MeOS methods do worse than fartOLa's own SOFT draw on the
rules. `apps/edge/scripts/draw-benchmark.ts` runs fartOLa's draw and
reference ports of MeOS `drawSOFTMethod` and `drawMeOSMethod`
(`apps/edge/scripts/meosDrawReference.ts`) on the same seeded classes.
Seed 2026: of 4000 random classes, MeOS `drawSOFTMethod` left avoidable
same-club neighbours (TR 7.5.1) in 1124, `drawMeOSMethod` and fartOLa in 0.
Over 5000 redraws of A×4/B×4/C×2 (138 valid club patterns), fartOLa drew all
138 with the most common at 1.1 %; `drawSOFTMethod` drew 6 (17.7 %) and
`drawMeOSMethod` 16 (30.7 %), i.e. "snarlika utfall" (TR 7.5.2). The
benchmark is a test (`draw-benchmark.test.ts`), so a regression fails CI.

## Context and Problem Statement

Until October, fartOLa used MeOS's observable behaviour as its specification
(ADR-0009 "MeOS as superset"; the replay plan's goal was to "compute the same
status and running time as MeOS/Eventor"). Replaying DM 2026 day 1 and auditing
against SOFT's _Regelverk för orientering_ 20260701_2 showed that MeOS's
defaults contradict the rulebook in places: for example, the start punch moves
a drawn start time. Sanctioned competitions are judged by the rulebook, not by
MeOS. Our own compliance claims were unchecked prose: an independent check found
only 7 of 27 "fulfilled" rows actually proven. Which reference wins, and how do
we keep compliance claims true as the code changes?

## Decision Drivers

- Sanctioned (level 1–3) competitions must follow the SOFT rulebook in force.
- Organisers know MeOS. Every difference must be deliberate and explainable.
- A compliance claim must break the build when the behaviour behind it breaks.
- Use the existing `pnpm lint` → CI path. No new tooling.

## Considered Options

1. **MeOS as the spec everywhere.** Rejected: it builds in MeOS's rule
   violations, such as the start punch winning over the start time.
2. **SOFT first, then MeOS, then our own choice, with compliance tracked in a
   gated rule matrix.** Chosen.
3. **SOFT first, with compliance tracked in prose or issues.** Rejected: the
   October audit showed that unchecked claims go stale (20 of 27 rows were weak
   or wrong).
4. **A global "MeOS mode" / "SOFT mode" switch.** Rejected: it doubles the test
   matrix. Only the start rule needs a choice, so the choice is per class.

## Decision Outcome

Chosen option: **2**. The order of precedence is: (1) the SOFT rulebook in
force, (2) MeOS's observable behaviour, (3) our own choice. Code, tests and
commits cite rules as "SOFT TR x.y.z (2026-07-01)".

Concrete differences decided on 2026-10-04/05:

| Topic          | SOFT                                                                                                                                   | MeOS (5.0 U3)                                                        | fartOLa                                                                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start          | TR 4.18.9: a runner who is late through their own fault keeps the original start time. TR 4.18.16: start punching is an allowed method | The punch replaces the start time unless the class has `IgnoreStart` | `classes.start_method` = `auto` / `start_time` / `start_punch`. `auto` uses the start time if the runner has one, otherwise the punch. A late or early punch only raises a warning |
| Running time   | TR 4.20.10: time for the whole course, never built from split times                                                                    | Optional: can drop a leg's time ("Utan tidtagning")                  | A voided leg only waives that control. Time = finish − start                                                                                                                       |
| Rounding       | TR 4.20.7: whole seconds                                                                                                               | Tenths off by default                                                | Rounded once, half up, where the time is computed. Display, places, IOF and MOP all read that value (previously fartOLa compared raw ms and sent tenths)                           |
| Status names   | TA till TR 7.8.2: Ej godkänd, Diskad, Ej start, Deltagit                                                                               | MeOS's own labels                                                    | Published surfaces use SOFT's names. Secretariat views keep the operational labels                                                                                                 |
| Max time       | TR 4.21.1: one max time for all classes. TR 4.21.2: may not change after the first start                                               | 0 (unset) for the competition and for each class                     | `competitions.max_time_sec`. A class value remains as an override for non-sanctioned use. Locked (409) once `race_started` is in the log or the earliest drawn start has passed    |
| Unread runners | TA till TR 7.8.2: "Ej start" only for runners who did not start                                                                        | Operator action "Sätt ej utlästa till Ej start"                      | **Aligned with MeOS**: fixes fartOLa's earlier automatic DNS. An unread runner is "Ej utläst" and is left out of the ResultList until the operator acts                            |

How compliance is tracked:

- `.planning/compliance/soft-regelverk-2026.md` has one row per rule that the
  software must support. Each row has exactly one status: `UPPFYLLD`,
  `DELVIS`, `SAKNAS`, `PLANERAD (…)` or `EJ TILLÄMPLIG`. The tokens stay in
  Swedish because the gate reads them.
- An `UPPFYLLD` row must name at least one test as
  `` `file.test.ts` › `test name` ``. That test must fail if the behaviour
  breaks: it checks the whole population and asserts the obligation itself.
- `.planning/compliance/meos-jamforelse.md` compares MeOS 5.0 U3 row by row
  (MeOS source read for behaviour, not copied, per ADR-0001). It is not gated.
- A new rulebook edition is diffed against the current one, and the matrix is
  updated rule by rule with the new numbering.

### Consequences

- Good, because differences from MeOS are deliberate and documented. The
  replay lists them under "Skillnad mot MeOS" instead of counting them as
  mismatches.
- Good, because a deleted or renamed test, or a status count that drifts,
  fails `pnpm lint` and therefore CI.
- Bad, because the gate checks only that the named test string exists. Whether
  the test really asserts the rule depends on review.
- Bad, because results can differ from a MeOS run in parallel (late starters in
  start-time classes), and operators must understand `start_method`.
- Bad, because the matrix must be maintained for each rulebook edition.

### Confirmation

- `scripts/check-compliance.mjs` runs in `pnpm lint` (CI: `ci.yml`). It checks
  `.planning/compliance/*regelverk*.md` only. It rejects an unknown or missing
  status, an `UPPFYLLD` row without a test reference, a test file or test name
  that does not exist (paths are relative to `apps/edge/src/` unless they start
  with `apps/` or `packages/`), and summary counts that do not match the rows.
- Every `UPPFYLLD` row is verified independently (Codex) before a matrix version
  is published. On 2026-10-04, 7 of 27 rows were proven, 12 were weak and 8 were
  wrong. All 20 were fixed with new tests, corrected code or a new status.
- `replay.ts --meos-start` (start punch in every class) must reproduce the
  official MeOS-based result. This shows that the start difference is
  intentional, not a bug (ADR-0014).

## More Information

- Matrix: [soft-regelverk-2026.md](../../.planning/compliance/soft-regelverk-2026.md).
  MeOS comparison: [meos-jamforelse.md](../../.planning/compliance/meos-jamforelse.md).
  Gate: [check-compliance.mjs](../../scripts/check-compliance.mjs).
- Start decision: [02.1-14-REPLAY-READINESS-PLAN.md](../../.planning/phases/02.1-sanctioned-competition-foundations/02.1-14-REPLAY-READINESS-PLAN.md),
  "Decision 2026-10-05: follow SOFT, not MeOS, for the start" and Tasks 14–15.
- Commits. PR #51 (`feat/phase-2.1`): `6714b42` matrix as a lint gate,
  `6b037e5` MeOS comparison, `7aa98a5` start method per class, `c29a679` no
  leg-time subtraction. PR #53 (`feat/soft-small-gaps`): `aae671e` rounding,
  `bcba9d3` SOFT status names, `60bbf0e`/`d27baab` one max time locked after
  the first start, `bc708e2` unread ≠ Ej start, `9aa3690` matrix corrected
  after the Codex verification.
- Rulebook: SOFT _Regelverk för orientering_ 20260701_2. The text is kept
  outside git in `fartOLa-docs/soft-regelverk/`.
- Related: [ADR-0001](0001-reimplement-do-not-fork-meos.md),
  [ADR-0014](0014-replay-real-competitions-as-acceptance-test.md).
