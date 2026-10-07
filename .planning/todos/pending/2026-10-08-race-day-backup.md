---
created: 2026-10-08T12:00:00+02:00
title: Automatic backup during the competition — USB stick, cloud, or both
area: ops
files:
  - apps/edge/src/backup/daily.ts
  - apps/edge/src/bin/fartola.ts
---

## Problem

Today fartOLa takes one SQLite snapshot a day at local midnight into
`--backup-dir` and keeps seven (`scheduleDailyBackup`, REQ-OPS-003). On a
competition day that protects almost nothing: the snapshot is taken after
the race, and it sits on the same disk as the database. If the laptop or
the Pi's SD card dies at 11:00, the morning's card reads, direct entries
and manual decisions are gone. MeOS offers automatic periodic backup;
fartOLa should do at least as well, without the club having to know its
hardware (a Pi with snapshotting file systems is one setup, a borrowed
laptop another).

## What

- **Frequent snapshots while a competition is active:** every N minutes
  (default 5) and right after important operator actions (draw, results
  push). Use the SQLite online-backup API so the server keeps running.
  Keep a rolling set (e.g. the last 12 plus one per hour), not just seven
  days.
- **Somewhere else than the database disk.** Targets, any combination:
  - **USB stick:** detect a mounted stick with a `fartola-backup` folder
    (or a configured path) and copy each snapshot there. Warn if it is
    removed or full.
  - **Cloud:** Google Drive and others through a small, well-known tool
    (e.g. rclone) rather than our own OAuth code; uploads only when online,
    queued while offline.
  - **Another fartOLa node or laptop** on the LAN, later (Phase 4 sync is
    the real long-term answer).
- **Event log export:** because results are recomputed from events
  (ADR-0003), also write the event log as an append-only NDJSON file next
  to the snapshot. It is small, easy to inspect and enough to rebuild.
- **Status where people work (ADR-0016 rule 5):** "Senaste säkerhetskopia
  11:05 · USB ✓ · Drive ✓ (köad)", and a warning when the last good copy
  is older than the interval.
- **Restore:** a documented, tested way to start fartOLa from a snapshot
  (or rebuild from the NDJSON event log) on another machine, and a test of
  that path.
- **Personal data (ADR-0008):** backups contain names and contacts.
  Encrypt cloud copies, apply the same retention/scrub rules to backups,
  and say in the settings where copies go.

## Tests

- Snapshots are taken on the interval while active, and after a draw.
- A missing or full USB target warns; the local snapshot still happens.
- Offline cloud target queues and uploads when back online (fake target).
- Restore from a snapshot and rebuild from the NDJSON log both give the
  same projection as the original.
