---
created: 2026-10-08T12:00:00+02:00
title: Competition checklist — tasks built from the settings, ticked off by the data
area: web
files: []
---

## Problem

Doing a competition right means remembering many steps: scanning the
rental-card box, testing every radio unit with both an ordinary card and
SIAC Air, updating the Eventor runner database the evening before (not
on race morning), setting max time and zero time, drawing with the SOFT
method, and so on. Today that lives in people's heads. ADR-0016 says the
system should help people do the right thing.

## What

One checklist model, used in fartOLa now and by the competition admin hub
later (`2026-10-07-competition-admin-hub.md`):

- **Built from the competition's settings:** "rental cards: yes" adds
  "Läs in hyrbrickslådan"; listed radio controls add "Testa varje
  radioenhet med vanlig bricka och SIAC Air".
- **Each task:** a short how-to, a role (SI, sekretariat, tävlingsledare),
  a time relative to the competition (week before, evening before,
  morning, during, after), and a button to the screen that does it.
- **Ticked off by fartOLa when the data shows it is done**; a manual tick
  only for what fartOLa cannot see.
- The start page shows what is left ("3 saker kvar före första start").
- Templates editable per club and reused next year.

Tasks fartOLa can check itself (first version):

| When           | Task                                                             |
| -------------- | ---------------------------------------------------------------- |
| Week before    | Courses imported and valid (classes, controls, number series)    |
|                | Entries imported from Eventor                                    |
|                | Class types and start methods; free start in open classes        |
|                | Draw with the SOFT method; start list published to Eventor       |
|                | Max time and zero time set                                       |
|                | Radio controls listed; ROC id set                                |
|                | Event codes for helpers created                                  |
| Evening before | Eventor runner database refreshed; backup target set and working |
| Race morning   | Rental-card boxes scanned (one set per owner)                    |
|                | Reader and printer tested (test print)                           |
|                | Each radio unit tested with an ordinary card and SIAC Air        |
|                | MeOS / liveresultat connections working                          |
| During         | Radio watchdog, missing starts, runners in the forest            |
|                | DNS after the last start (rule-based, not a manual sweep)        |
| After          | Rental-card reconciliation per box, sent to the owner            |
|                | Final results to Eventor; export; backup                         |
|                | Personal data scrubbed per retention (ADR-0008)                  |

Planning tasks with people and documents (directive, inbjudan/PM, course
files three weeks before, coverage check at the terrain visit, SI unit
programming, double units at level 1) belong to the admin hub; when it
exists, choices made there switch tasks on here.

## Tests

- Settings → expected task list (rental cards on/off, radio on/off).
- A task flips to done when its data appears (e.g. a rental set scanned).
- Manual-only tasks keep their state across restarts.
