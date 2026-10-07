---
status: accepted
date: 2026-10-06
decision-makers: [Jonas Hagberg]
---

# Own simple UI, not MeOS's: you always see what will happen and what did

## Context and Problem Statement

fartOLa will reuse MeOS's domain logic, and may port parts of it
(ADR-0001). MeOS's user interface is a different matter. Secretariats know
it, but it needs many clicks between dialogs and tabs, and it is often
unclear whether a change is saved, applied or lost when you switch view.
The users are mostly 40–70, technically able but not developers, working
under time pressure at a readout table (PROJECT.md). Should fartOLa copy
MeOS's screens so it feels familiar, or design its own?

## Decision Drivers

- A secretary must never wonder whether something happened.
- Mistakes under pressure must be cheap to undo.
- People switching from MeOS should still recognise the concepts.
- The event log (ADR-0003) already makes most actions reversible.

## Considered Options

1. Copy MeOS's screens and flows for familiarity.
2. Own UI, keeping MeOS's and SOFT's names for concepts.
3. No stated principles; decide screen by screen.

## Decision Outcome

Chosen option: **2**, because familiarity comes from the words people use
(lottning, vakanser, Ej start, startstämpling), not from the dialogs. MeOS's
logic may be ported (ADR-0001); its screens, dialogs and click flows are
not. Every screen follows these rules:

1. **Show before, confirm after.** An action that changes results, start
   times or statuses shows what it will do first ("12 löpare i H21 får ny
   starttid") and says what it did afterwards.
2. **Undo rather than "are you sure?".** Actions within fartOLa can be
   undone, because they are events. Confirmation dialogs are kept for
   actions that leave the system and cannot be taken back: pushing to
   Eventor or liveresultat, deleting a competition. Undo is not only a
   message that fades after a few seconds: recent changes stay in a list
   they can be undone from.
3. **Switching view never loses or half-applies anything.** No hidden edit
   mode and no "Verkställ" that only some fields need. A change is saved
   when the screen says so, and an unsaved edit is never dropped silently.
   The address shows where you are, so back and reload return to the same
   place with the same filter.
4. **One task, one screen.** The common tasks (readout, walk-up entry,
   missing start, results) take few clicks and need no visit to settings.
   Each screen has one main button. Defaults suit a club training.
5. **State is always visible.** Whether the reader is connected, whether
   pushes to Eventor/MeOS/liveresultat are working, and how many reads are
   unsent are shown where the work happens.
6. **Plain Swedish.** SOFT's terms for statuses and rules (ADR-0011), MeOS's
   names where they are the common word, no developer words in the UI. An
   error says what went wrong and what to do next.
7. **Readable for everyone, also in sunlight.** Text contrast at least
   4.5:1 (aim for 7:1 at readout), body text at least 16 px, touch targets
   at least 44 px. A status is never shown by colour alone: OK and
   Felst. also differ in text or symbol. The bright-sun mode (REQ-UI-007)
   stays.

### Consequences

- Good, because a new secretary can run readout without training, and an
  experienced one can work fast without fear of breaking something.
- Good, because undo and previews use the event log that already exists.
- Bad, because MeOS users must find features in new places. Mitigation:
  the same names for the same things, and a short "Från MeOS" guide.
- Bad, because each screen needs its own design work instead of copying a
  known layout.

### Confirmation

- Code review of every new screen against rules 1–7.
- An automated accessibility check (axe) in the e2e suite: contrast,
  labels, keyboard focus.
- An e2e test per editing screen: change a field, switch view, come back,
  and the change is either saved or still shown as unsaved, never lost or
  half-applied.
- A walkthrough with a secretary who uses MeOS, at least once per phase
  that adds screens.

## More Information

- Users: [PROJECT.md](../../.planning/PROJECT.md).
- Earlier UI contract: the three-click wizard in
  [01-UI-SPEC.md](../../.planning/phases/01-single-laptop-training-mvp/01-UI-SPEC.md).
- Related: [ADR-0001](0001-reimplement-do-not-fork-meos.md) (what may be
  ported from MeOS), [ADR-0003](0003-event-sourcing-as-core-data-model.md)
  (events make undo possible),
  [ADR-0011](0011-follow-soft-rulebook-over-meos-with-gated-rule-matrix.md)
  (SOFT's terms).
