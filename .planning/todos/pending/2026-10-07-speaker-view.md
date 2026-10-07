---
created: 2026-10-07T15:00:00+02:00
title: Speaker view — one screen that splits itself as classes are added
area: web
files: []
---

## Problem

At a two-day competition in October 2026 the speaker ran eight separate
MeOS "Speakerstöd" windows, one per class, tiled by hand on one monitor.
What went wrong:

- Windows overlap and are cut off: names, long club names and time gaps
  are truncated ("+12:3").
- Small text, light green rows, low contrast: in direct sun the screen is
  nearly unreadable.
- Runners who have not started fill rows with noise ("27:00 −11:03 Ej
  start"), and negative time gaps.
- Each window has its own tabs (Händelser / Radio 1 / Mål) and settings;
  adding a class means opening and placing another window.

## What

A speaker page in the web app (one browser tab, full screen, any device),
following ADR-0016:

- **Pick classes; the layout splits itself.** 1 class = full width, 2 =
  two columns, 3–4 = 2×2, 5–6 = 3×2, and so on; each panel keeps whole
  names and all columns readable, and scrolls only inside itself.
- **Per class:** the radio controls in course order, then finish; place
  and time behind at each; the leader at each point; who is on the way
  (passed the last radio, not yet finished) with an expected finish time.
- **Events strip** across the top: the latest passings and finishes over
  all chosen classes, newest first, with new leaders highlighted (text +
  symbol, never colour alone).
- **Not started / DNS / MP** are folded away by default (a count per
  class), not shown as rows with fake times.
- Large text and high contrast; the bright-sun mode (REQ-UI-007) by
  default outdoors.
- Keyboard: add/remove classes, cycle panels, pause auto-scroll.
- Data: the edge projection and radio punches over WebSocket; works with
  MeOS as main system through MOP too (ADR-0007), so it can be used
  before fartOLa is the main system.
- Logic to mimic from MeOS (not its UI, ADR-0001/0016): the speaker
  prognosis and leader tracking (`oEventSpeaker.cpp`, see the MeOS port
  survey).

## Tests

- Layout: n chosen classes → expected grid (1, 2, 4, 6, 9).
- A radio passing updates place/behind for that class only.
- DNS/not started never render as a time row.
- Readable at 1920×1080 with 6 classes: no truncated name in the e2e
  screenshot check.
