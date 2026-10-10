---
created: 2026-10-09T22:30:00+02:00
title: Eventor import needs a course file first, and matches classes by name only
area: edge
files:
  - apps/edge/src/ingest/entryImport.ts
  - apps/edge/src/routes/eventorImport.ts
  - apps/edge/src/eventor/eventClasses.ts
  - apps/edge/src/ingest/courseImport.ts
---

## Problem

1. `POST /api/competitions/:id/eventor-import` refuses entries whose classes
   do not exist yet: "EntryList references 40 class name(s) but no matching
   classes exist in the competition; upload CourseData first"
   (`entryImport.ts:196`). Classes only come from a course file. Seen
   2026-10-09 with Tuna Ting dag 1 (Eventor 54362): no course file, no
   entries. A training where everyone enters on the day has no classes at
   all until a course file is loaded. OLA, by comparison, creates the
   classes from Eventor when it fetches the event (it had Bana 1-3 for the
   veteran training, event 60826, with 0 entries).
2. Entries are matched to classes by name only (`classIdByName`,
   `entryImport.ts:92-133`), and no Eventor class id is stored. A course
   file from MeOS uses MeOS's class names, which can differ from Eventor's:
   at Tuna Ting "H21K" vs "H21 Kort" and "Insk. 2,0" vs "Inskolning 2,0".
   Those entries would be skipped. MeOS keeps the Eventor class id in
   `oClass.ExtId`, and IOF CourseData carries it as
   `ClassCourseAssignment/ClassId`.
   The short names are the expected ones in a course file: SOFT's course
   setting guide (Snättringe SK, among SOFT's support documents) says the
   class names in OCAD must equal the classes' short names in Eventor, as
   OLA links courses to classes by short name. Eventor's ClassList has
   both (`H21 Kort` / `ShortName` `H21K`, `D21 Kort` / `D21K`,
   `Inskolning 2,0` / `Insk. 2,0` at Tuna Ting); its EntryList has only the
   class id and the long name.

## Fix

- When a competition is linked to an Eventor event, create its classes
  from Eventor's class list (`eventclasses`, already fetched for class
  kinds) with their Eventor class id, so entries can be imported before
  any course file.
- Store the Eventor class id and short name on the class. Match entries
  by class id; match course assignments by class id, then short name,
  then name.
- A later course file then attaches courses to the existing classes
  (by class id, else name) instead of creating new ones.

Test with the Tuna Ting dag 1 files: the Eventor EntryList alone gives 40
classes and 507 entries; a MeOS-named course file (H21K, Insk. 2,0) then
links all 44 classes.
