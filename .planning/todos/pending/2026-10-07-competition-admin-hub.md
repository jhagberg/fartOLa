---
created: 2026-10-07T15:00:00+02:00
title: Competition admin hub — files, deadlines and PM/inbjudan templates for the whole arrangement
area: planning
files: []
---

## Problem

After a two-day competition in October 2026, much of the work turned out
to fall between groups (course setting, SI/IT, expedition, open courses):
course XML arrived late, number series for controls were not agreed
early, rental cards had no owner, radio placement was not checked for
coverage in advance, and the PM/inbjudan are rewritten each time.

## Idea (needs an RFC before building)

A part of fartOLa (or a companion app) that holds one competition from
planning to results:

- **Files with deadlines:** course setters upload course data (IOF XML
  from Condes/Purple Pen/OCAD) by a set date, e.g. three weeks before;
  fartOLa validates it at once (classes, controls, number series, radio
  and last controls) and the course controller sees the same version.
- **Checklist with owners:** a template of tasks per role (radio coverage
  checked at the terrain visit, rental-card sets scanned, SI units
  programmed, zero time set, network cables protected overnight), each
  with a person and a date.
- **Templates:** PM and inbjudan with fields filled from the competition
  (date, classes, start times, courses, contacts); kept and reused.
- **Reuse:** copy last year's competition as a starting point.
- **Radio placement check:** with the course file (control positions)
  and the competition area, suggest where radio controls can work, so it
  is known before the terrain visit, not on race day:
  - mobile coverage at each control from the operators'/PTS coverage
    data (for ROC, which sends over the mobile network);
  - line of sight from each control to the receiver/arena over the
    terrain, from an elevation model (for jSh/SRR radio links), flagging
    radio shadow (one control would likely have been in shadow had it been
    placed 50 m further down a slope);
  - rank candidate controls (coverage, shadow, how many classes pass) so
    course setters can pick a radio control that also serves many classes.
  Check first: which coverage data is open and how fine it is (PTS
  "Mobiltäckning", operator maps), and the licence of Lantmäteriet's
  elevation data. The result is advice; the terrain visit confirms it.
- **PM checklist from real PMs (research first):** download a large set
  of PMs and inbjudningar from Eventor for many kinds of competitions
  (club, district, national, multi-day, sprint, night), extract their
  headings and topics, and count what most good PMs cover (parking,
  distances, start procedure, rental cards, toilets, maps, rules for the
  class, radio/speaker, prizes, contact). The result is a template and a
  "did you forget" checklist. Use the Eventor API politely (rate-limited,
  public documents only), keep the downloaded files out of git, and
  publish only the aggregate findings.

Open questions for the RFC: part of fartOLa or separate; who logs in
(club members outside the secretariat → accounts, not event codes); how
it relates to Eventor, which already holds inbjudan/PM for sanctioned
competitions.
