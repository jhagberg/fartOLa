# PROJECT — fartola (working name)

## Vision

A modern, cross-platform, offline-first orienteering competition
management system. Replaces or augments MeOS / OLA / SportSoftware in
Swedish orienteering. Built for events from club training (20 starters)
to O-ringen scale (25 000+ starters).

Where MeOS treats a competition as a single shared database that one
"master" machine owns, this system treats every SportIdent punch as an
**immutable event** in a per-node append-only log. Results are computed
projections over the log, never stored mutable state. This makes
offline-first, multi-secretary collaboration, and horizontal scaling
the system's natural behavior rather than features bolted on.

## The user

Primary: volunteer event organizers at Swedish orienteering clubs.
Most are 40–70 years old, technically literate but not developers.
They have run events on MeOS for 10+ years and know its rough edges.

Secondary: competitors and spectators consuming live results.

Tertiary: federations (SOFT, IOF) consuming standard data exports.

## Core differentiators vs MeOS

1. **Platform-agnostic.** Runs in Chrome/Edge on Linux/Mac/Windows/Android.
   No Windows-only drivers, no laptop fleet to maintain.
2. **No single master node.** Every edge node is autonomous; the network
   partition that kills a MeOS event is a non-event here.
3. **Real-time collaboration.** Multiple secretaries edit the same
   competition simultaneously, Figma-style.
4. **Event-sourced.** Bugs can be fixed and projections recomputed.
   No corrupt state to repair under tournament pressure.
5. **Children's finish experience.** Animated finish screen, sounds,
   per-name TTS — a recruitment tool, not an afterthought.
6. **Standards-first.** IOF XML 3.0, Eventor sync, ROC protocol, SIRAP,
   MeOS TCP input — interop is the foundation, not a plugin.

## Constraints

- **AGPL-3.0** for application, **MIT** for the `sportident` library.
- Must speak SportIdent protocol (BSM7/8, BSF8/9, SI-Master, SRR, SIAC).
- Must support legacy SI5 cards — clubs still own them.
- Must export valid IOF XML 3.0 (the federation requires it).
- Must work in the forest with intermittent or no internet.
- No iOS-as-operator requirement (WebSerial not supported); iOS is
  read-only viewer.

## Out of scope

- Map drawing (use OCAD / Purple Pen / OOMapper)
- Course planning (use Purple Pen / Condes)
- GPS replay (use Livelox)
- Custom hardware (we integrate with SportIdent and ROC)

## Success criteria for v1

- StorTuna OK runs a real Tuesday-evening club training using only
  this software, end to end, on one Linux laptop.
- IOF XML 3.0 export validates against the official schema.
- A competitor can scan a QR code at readout and see their splits
  on their phone within 5 seconds of finishing.

## Pointers

- Full ecosystem and protocol research: `.planning/research/ecosystem.md`
- Architecture (target state): `.planning/research/architecture.md`
- Now, next and later: `.planning/ROADMAP.md`
- Scoped requirements with IDs: `.planning/REQUIREMENTS.md`
