---
status: accepted
date: 2026-10-05
decision-makers: [Jonas Hagberg]
---

# Standards-first interop: IOF XML, Eventor, MeOS MIP/MOP, liveresultat

## Update 2026-10-05

The standards-first decision of 2026-05-12 stands. The commitments below have
moved, as built:

| Commitment (2026-05-12)               | Status 2026-10-05                                                                                                                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| IOF XML 3.0 import + export (Phase 1) | **Built.** Import of CourseData, EntryList and StartList, validated against the bundled XSD. Export of StartList and ResultList                                                                                                                                                                        |
| IOF XML 2.0.3 read (Phase 1)          | **Not built** (REQ-STD-003 open)                                                                                                                                                                                                                                                                       |
| Eventor REST (Phase 2)                | **Built in Phase 2.0/2.1.** Runner database cache (ADR-0009), entry import, and start list and result list push (provisional while runners are out)                                                                                                                                                    |
| MeOS "TCP" side-car (Phase 4)         | **Built in Phase 2.0, over HTTP**: MIP (`GET /mip`, MeOS polls fartOLa's entries) and MOP (`POST /mop`, MeOS pushes its results). The roles are reversed from the side-car story: fartOLa is primary for registration and read-out, and MeOS runs in parallel as backup. Password-protected (ADR-0013) |
| liveresultat.se push                  | **Added in Phase 2.1** (MOP format, MeOS status codes)                                                                                                                                                                                                                                                 |
| ROC, SIRAP, Livelox (Phase 4)         | **Not built.** Livelox exists only as an API-key slot in settings                                                                                                                                                                                                                                      |

Where a standard and the SOFT rulebook interact (status names, whole-second
times in ResultList and MOP), the rulebook wins (ADR-0011).

The original text below is kept as recorded.

## Context and Problem Statement

Clubs don't switch competition software all at once — they migrate one
event at a time. A system that cannot exchange data with existing
tools (Eventor, MeOS, ROC, Livelox) is dead on arrival regardless of
internal quality. How do we ensure interop is structural, not an
afterthought?

## Considered Options

- Build the core first; add export/import formats later as plugins
- Make every IOF/federation standard a v1 requirement, designing data
  models around them
- Pick one or two formats and let others be community contributions

## Decision Outcome

Chosen option: **standards-first**, with these commitments:

- **v1 (Phase 1):** IOF XML 3.0 import + export; IOF XML 2.0.3 read.
- **v1 (Phase 2):** Eventor REST API (pull entries, push results).
- **v2 (Phase 4):** ROC protocol receiver, SIRAP TCP server, MeOS TCP
  input output (side-car mode), Livelox export.

Side-car mode (MeOS TCP input _output_) is the migration trick: a
club can run MeOS as the primary secretariat and this system as a
parallel kids'-finish/live-board service, building trust before
switching primary systems.

## More Information

- IOF XSD: <https://github.com/international-orienteering-federation/datastandard-v3>
- [REQUIREMENTS.md](../../.planning/REQUIREMENTS.md) REQ-STD-001..008.
- MeOS protocols: [meos-protocols.md](../../.planning/research/meos-protocols.md);
  code in [integrations/meos/](../../apps/edge/src/integrations/meos/) and
  [integrations/liveresultat/](../../apps/edge/src/integrations/liveresultat/).
- Related: [ADR-0009](0009-eventor-runner-cache.md),
  [ADR-0013](0013-meos-integration-requires-password.md).
