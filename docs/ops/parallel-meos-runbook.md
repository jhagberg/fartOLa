# Parallel MeOS + fartOLa runbook

**Audience:** Stora Tuna OK competition operators running fartOLa as primary
with MeOS as the parallel safety backup (per locked decision #2,
`.planning/phases/02-4-klubbs-mvp/02-CONTEXT.md`).
**Tested on:** 4-klubbs training, **2026-05-20** (Stora Tuna).
**Phase:** 2.0 (MVP). **Document version:** v1.0.

This runbook is the operator's playbook for running fartOLa + MeOS in
parallel on a closed club LAN. It is written for a stressed operator
mid-event: numbered steps, Swedish operator vocabulary (Bana, Hyrbricka,
Returnerad), English for technical terms (LAN, MIP, MOP, `/dev/ttyUSB0`).

> **Quick recovery pointer.** If fartOLa crashes during the event, jump
> straight to [When something breaks → fartOLa crashes mid-event](#fartola-crashes-mid-event).
> If MeOS crashes, jump to [MeOS crashes mid-event](#meos-crashes-mid-event).

---

## Before the event (T-2 hours)

These steps prepare both laptops and exercise the integration paths
before any real runner arrives. **Do them T-2h, not T-15min.** The bench
smoke (Step 9 below) is the only deterministic gate before you let kids
walk up to the registration desk.

### 0. One-time: install required tools on the fartOLa laptop

The bench-smoke script (Step 9) calls `curl`, `jq`, `xmllint`, and
`sqlite3` to assert the bridge is green. They're not always present on
a fresh Debian/Ubuntu/Mint install. On the fartOLa laptop, run **once**
(skip if already installed from a prior event):

```
sudo apt update
sudo apt install curl jq libxml2-utils sqlite3
```

Notes:

- `xmllint` ships in the `libxml2-utils` package, not a package named
  `xmllint`. The bench-smoke preflight names this explicitly if any tool
  is missing.
- On Fedora/RHEL: `sudo dnf install curl jq libxml2 sqlite`.
- On macOS (dev only — production is Linux): `brew install jq libxml2 sqlite` (curl is built-in).

Verify with:

```
curl --version && jq --version && xmllint --version && sqlite3 --version
```

All four should print a version line. If any errors, re-run the install
and recheck before proceeding to Step 0.5.

### 0.5. One-time: install the `fartola` binary + prepare the data directory

The runbook's `fartola --port ...` invocations below assume the binary
is on PATH and the SQLite database directory exists. On a fresh
laptop, do both **once**:

**Build + install the tarball** (from inside the repo working tree):

```
bash scripts/build-fartola.sh
npm install -g ./dist/fartola-[0-9]*.tgz
```

The `[0-9]*` pattern picks the stable `fartola-<version>.tgz` alias and
skips the pnpm-default `fartola-edge-<version>.tgz` that ships alongside;
the leading `./` keeps npm from interpreting the path as a GitHub
shorthand (`<user>/<repo>`).

`scripts/build-fartola.sh` runs `pnpm -r typecheck`, `pnpm -r test`,
builds `apps/web` (SvelteKit SPA), bundles it next to `apps/edge`'s
compiled output, then `pnpm pack`s the result into `dist/fartola-*.tgz`.
The `npm install -g` then drops the `fartola` binary on PATH (typically
`$(npm prefix -g)/bin/fartola`).

Verify:

```
which fartola
fartola --help
```

If `fartola --help` errors with "command not found", check
`$(npm prefix -g)/bin` is on your `$PATH` — the npm prefix is
user-owned on most modern Linux installs (no sudo needed) but the
default `$PATH` doesn't always pick it up. Quick fix:

```
export PATH="$(npm prefix -g)/bin:$PATH"
echo 'export PATH="$(npm prefix -g)/bin:$PATH"' >> ~/.bashrc
```

**Prepare the data directory** (XDG location, no sudo required):

```
mkdir -p ~/.local/share/fartola ~/.local/share/fartola/backups
```

The runbook uses **one persistent DB** at
`~/.local/share/fartola/fartola.db` across every event the laptop runs.
The schema is multi-competition (every table has a `competition_id`
FK and the active-competition pointer in the `config` table switches
between them), so cross-event Eventor cache reuse and retention
scrubber state carry forward. If you prefer a different layout
(e.g. `/var/lib/fartola/` for a server-style install), substitute
the path in every `--db-path` invocation below — the bridge doesn't
care, but you'll need `sudo mkdir -p /var/lib/fartola && sudo chown
$USER /var/lib/fartola` first because `/var/lib/` is root-owned.

**Set up the Eventor key** (D-EV-1 prerequisite; the bridge boots
without it but Eventor pre-fill silently degrades to the firmware
hint). Create `~/.env.fartola` in your home directory. The same file
will hold future integration keys (Livelox, Liveresultat) — one
file, one source of truth for all fartola secrets:

```
cat > ~/.env.fartola <<'EOF'
EVENTOR_API_KEY=<paste-stora-tuna-ok-key-here>
# LIVELOX_API_KEY=...        # future
# LIVERESULTAT_API_KEY=...   # future
EOF
chmod 600 ~/.env.fartola
```

The file is gitignored (matches the global `.env*` rule) and never
logged. To use it, `source ~/.env.fartola` before each `fartola ...`
invocation OR add `set -a; source ~/.env.fartola; set +a` to your
shell rc so the keys export automatically into every shell.

### 1. Power up the fartOLa laptop

- Open the laptop, log in.
- Plug the **BSM7/8-USB SI master reader** into a USB-A port.
- Verify the reader enumerates:
  - `ls /dev/ttyUSB0` should show the device node.
  - If `/dev/ttyUSB0` is missing, run `dmesg | grep cp210x` to see the
    kernel driver bind. If `brltty` shows up, remove it
    (`sudo apt-get remove brltty`) — `brltty` claims CP210x devices.

### 2. Power up the MeOS laptop

- Open the MeOS laptop, log in.
- Confirm both laptops are on the **same LAN switch / Wi-Fi network**.
- From the MeOS laptop, `ping <fartola-laptop-ip>` should respond within
  a few ms. If not, fix LAN before continuing.

### 3. Boot the fartOLa bridge (first boot — no competition yet)

On the fartOLa laptop. **This first boot intentionally omits
`--competition-id`** because the 4-klubbs competition doesn't exist
in the DB yet — Step 3.5 below creates it via the wizard. Once you
have the UUID, restart with `--competition-id <uuid>` (Step 3.6) so
MIP/MOP know which competition the wire belongs to.

```
source ~/.env.fartola  # exports EVENTOR_API_KEY for the child process
FARTOLA_DEV=1 fartola \
  --port 3000 --bind-host 0.0.0.0 --allow-lan \
  --db-path ~/.local/share/fartola/fartola.db \
  --backup-dir ~/.local/share/fartola/backups
```

Notes:

- `--bind-host 0.0.0.0` + `--allow-lan` is REQUIRED to expose `/mip`
  and `/mop` to the MeOS laptop. Without `--allow-lan` the argv parser
  refuses non-loopback bind hosts (T-WS-FAN-OUT guard).
- `FARTOLA_DEV=1` enables `/api/__dev/*` + `/api/__admin/*` operator
  endpoints + makes the TweaksPanel "Uppdatera Eventor" button visible.
  Pre-event setup uses it; at event time you may drop it if you want a
  pure-production posture.
- Watch for `listening on 0.0.0.0:3000` in the log. If the bridge
  silently exits, check the systemd unit log (`journalctl -u fartola -n
50`) or stderr if running interactively.
- First boot also triggers the Eventor cachedcompetitors download in
  the background (D-EV-1 upstart). Expect a ~10s blip then green
  "Eventor: cache OK" in the TweaksPanel.

### 3.5. Create the 4-klubbs competition via the wizard

The wizard takes the Condes / Purple Pen courseData XML and creates the
competition + classes + courses in one atomic POST.

1. On the fartOLa laptop, browser → `http://localhost:3000/_new?wizard=1`.
2. Fill **Name** (`4-klubbs 2026-05-20`), **Date** (`2026-05-20`).
3. Drag-drop the local courseData XML (
   `.reference/2026-05-20 4-klubbs_coursedata.xml`) onto the DropZone.
4. Click **Spara** / **Create**. The wizard hits `POST
/api/competitions/from-wizard` which atomically inserts the
   competition + all 5 courses (Vit/Grön/Gul/Orange/Violett) + classes
   (the course-only fallback synthesises a 1:1 class-per-course).
5. The browser redirects to `/competition/<uuid>/readout` — **capture
   the UUID from the URL**. It looks like
   `9bda20c2-605b-2fe3-cf27-209c4642dab8`.
6. Confirm the WalkupModal Bana picker now shows the 5 course names.

### 3.6. Restart the bridge with `--competition-id` (optional but recommended)

You can either:

A) **Set the active competition via REST** (no restart needed; survives
restart because it persists to the `config` table):

```
curl -X POST http://localhost:3000/api/sessions/active-competition \
  -H 'content-type: application/json' \
  -d '{ "competition_id": "<paste-uuid-from-step-3.5>" }'
```

B) **Restart with `--competition-id`** to make the CLI invocation
self-documenting:

```
# Ctrl-C the previous fartola, then:
source ~/.env.fartola
FARTOLA_DEV=1 fartola \
  --port 3000 --bind-host 0.0.0.0 --allow-lan \
  --db-path ~/.local/share/fartola/fartola.db \
  --backup-dir ~/.local/share/fartola/backups \
  --competition-id <paste-uuid-from-step-3.5>
```

Either way, the bridge log should now show
`active competition: <uuid>` near the listen line.

### 4. Open the fartOLa UI on the fartOLa laptop

- Browser → `http://localhost:3000/competition/<id>/readout`.
- Confirm the readout view loads. The Sidebar should show:
  Readout / Walkup / Hyrbrickor / Tweaks.

### 5. Confirm cross-LAN reachability from the MeOS laptop

- On the MeOS laptop, open a browser → `http://<fartola-ip>:3000/competition/<id>/readout`.
- The same readout page should load. If it does not, double-check
  `--bind-host 0.0.0.0` and the local firewall on the fartOLa laptop
  (`sudo ufw status` if applicable).

### 6. Configure MeOS to talk to fartOLa

First, on the fartOLa laptop: **Inställningar → MeOS-koppling** → type
a password → **Spara**. (Decision revised 2026-10-05: D-MIP-1 / D-MOP-4
used to be "no password, closed club LAN", but anyone on the LAN could
then read all entries via `/mip` and add runners via `/mop`.) Without a
password, `/mip` and `/mop` answer only the fartOLa laptop itself; the
MeOS laptop gets `HTTP Error 403`. A wrong or missing password gives
`HTTP Error 401`. If you really want MeOS without a password, tick
**Tillåt MeOS utan lösenord** — then everyone on the network can read
all entries and add runners (fartOLa logs a warning at startup).
`MEOS_PASSWORD` in `~/.env.fartola` overrides the UI value.

On the MeOS laptop, open MeOS:

1. **Tools → Online → Configure MIP / MOP** (exact menu path varies
   slightly by MeOS version).
2. Set the **MIP URL**: `http://<fartola-ip>:3000/mip`
   - Password: the one set in fartOLa.
3. Set the **MOP URL**: `http://<fartola-ip>:3000/mop`
   - Password: the same.
4. Set the **poll interval** to 5-10 seconds. Lower = snappier, higher =
   less LAN chatter.
5. Click **Save / OK**. Some MeOS versions don't persist this config
   across restart — be ready to re-enter if MeOS reboots mid-event.

### 7. Pre-flight check: class name parity (Pitfall 3)

This is the single most-common cause of MIP entries silently failing:

- In MeOS, list the **five 4-klubbs classes**: Vit / Grön / Gul / Orange /
  Violett.
- In fartOLa, open the Walkup modal and inspect the **Bana** picker
  — should show the same five entries.
- **Spelling and case MUST match identically.** MeOS does a case-sensitive
  `<classname>` lookup (`onlineinput.cpp:989-997`). Mismatch = the MIP
  entry is rejected silently and only shows in MeOS as "unknown class".
- **Recommendation:** copy-paste the class names between systems rather
  than retype. If you must retype, do it in BOTH systems by reading
  from a single canonical source (the courseData XML
  `.reference/2026-05-20 4-klubbs_coursedata.xml`).

### 8. Verify the Eventor cache

- Open the fartOLa TweaksPanel (Sidebar → Tweaks).
- Look for the **Eventor row**. A green dot + label
  `Eventor: cache OK (N dagar gammal)` means the runner database is
  loaded.
- If the label says `Eventor: stale (N dagar gammal)` or
  `Eventor: offline` or `Eventor: nyckel saknas`:
  - **stale**: press **Uppdatera** (FARTOLA_DEV mode only) to force a
    fresh download. The button is only visible when the bridge was
    booted with `FARTOLA_DEV=1`.
  - **offline**: confirm the EVENTOR_API_KEY is set in `~/.env.fartola`,
    and the fartOLa laptop has internet during this T-2h window. The
    bridge degrades gracefully — walkup will fall back to the SI-firmware
    `cardHolderHint`. **Never blocks the bridge** (D-EV-3, REQ-OPS-001).
  - **nyckel saknas**: the API key is missing. Either (a) edit
    `~/.env.fartola` in your home directory (same path used in the setup
    section above), `source ~/.env.fartola`, and restart `fartola`, or
    (b) open `http://localhost:3000/installningar` and paste the key
    into the **EVENTOR_API_KEY** row + Spara — Phase 2.0 plan 02-07
    wired the per-call `resolveSecret` lookup so the next "Uppdatera
    Eventor" click picks it up WITHOUT a restart (code-review F-001).

### 9. Run the bench smoke

The deterministic gate. From the fartOLa laptop, in the repo working
directory:

```
FARTOLA_PORT=3000 \
FARTOLA_DB=~/.local/share/fartola/fartola.db \
FARTOLA_HOST=127.0.0.1 \
FARTOLA_SKIP_BOOT=1 \
bash apps/edge/scripts/bench-smoke-phase2.sh
```

Expected output ends with:

```
✓ Phase 2.0 smoke: 6/6 passed
```

`FARTOLA_SKIP_BOOT=1` tells the script to reuse the already-running prod
bridge instead of booting its own throwaway. If you ran the smoke
against the prod bridge and got 6/6 green, the wire is healthy.

If you got fewer than 6/6: read the failure prefix (red text), reach for
the [When something breaks](#when-something-breaks) section, and
**do not let runners onto the desk** until the smoke is green or you've
explicitly decided to fall back to MeOS-only operation.

---

## During the event

The roles are split across the two laptops. The fartOLa operator is the
primary; the MeOS operator is mostly hands-off.

### Operator (you) at the fartOLa laptop

You drive registration via the **Walkup modal**:

1. A runner walks up. They hand you their SI bricka OR they want a
   rental.
2. Beep the bricka on the master reader (or type the card_number into
   the Bricka field). The Walkup modal opens, pre-filled if Eventor
   knew this card.
3. Fill in: Bana (the course color), Hyrbricka checkbox if rental, and
   if Hyrbricka — at least phone OR email (operator can't save a hired
   card without contact info; D-HB-3).
4. Click **Spara**.

For the **registration-desk kids line** specifically, navigate to
`http://localhost:3000/competition/<id>/registration` instead of
`/readout`. That surface has the card-beep queue + auto-advance from
Plan 02-02b — beep five kids in a row, they queue up; you save each in
turn and the modal auto-advances.

### MeOS laptop

Hands-off. MeOS polls `/mip` every 5-10s and receives `<entry>` updates
within ~10s of each walk-up Save. If you registered Hyrbricka in
fartOLa, the `<entry>` carries `hired="true"` so MeOS's own rental-
reminder kicks in as well (belt + braces).

### Card readouts

- Cards punch into the BSM-mini → fartOLa processes natively (Phase 1
  bridge path).
- For **rental cards**: the **Hyrbricka toast** surfaces on
  finish-readout with the renter's contact info and a **Returnerad**
  button.
  - One-tap Returnerad: card handed back, the row's `returned_at_ms` is
    set, the toast does not re-pop for this card.
  - **Ignorera** dismisses the toast for this session without marking
    Returnerad. Useful for runners who say "I'll bring it back later".
- MeOS does its own card readback at the MeOS desk for runners that
  pass through there too. Cross-validation is post-event (locked
  decision #3 — no runner double-stamping).

### End-of-event Returnerad pass

Before tearing down, open
`http://<fartola-ip>:3000/competition/<id>/hyrbrickor` — the admin
backstop view. Lists every **open** rental (`returned_at_ms IS NULL`)
with contact info. Each row has a Returnerad button. Use this to chase
the stragglers.

---

## When something breaks

This is the failure-fallback matrix. Each subsection is a recovery
recipe. Bring this page up before the event so you know what to look
for under stress.

### fartOLa crashes mid-event

Symptoms: the fartOLa UI tab goes blank or the readout stops updating;
`systemctl status fartola` shows `failed` or `inactive`.

1. Restart the bridge with the **same competition id**:
   ```
   sudo systemctl restart fartola
   ```
   (or the equivalent `fartola --port 3000 ...` invocation if you're not
   on systemd).
2. The bridge resumes from the SQLite event log — every walk-up + every
   card_read landed before the crash is durable (Phase 1 REQ-OPS-002).
3. **MOP auto-merge.** The MOP receiver auto-merges MeOS-side
   direktanmälningar registered during the outage (D-MOP-3) on the next
   `<MOPComplete>` poll cycle. A toast appears:
   `N löpare hämtade från MeOS`.
4. **D-LIM-1 manual workaround.** MOP `<cmp>` does **NOT** carry the
   hired flag. Hyrbrickor that were MARKED in MeOS during the outage
   will NOT auto-import on recovery. You must re-enter those rentals
   in fartOLa's Walkup modal (Hyrbricka checkbox + at least phone OR
   email) after restart. Cross-reference the MeOS hired-card list to
   find which ones to re-enter.
5. Verify with the bench smoke (Step 9 above) before letting the next
   runner up.

### MeOS crashes mid-event

Symptoms: MeOS won't open OR the MIP poll log goes silent.

1. fartOLa keeps running standalone. Phase 1 functionality (registration,
   readout, finish-punch processing, Hyrbricka toast) is unaffected.
2. Restart MeOS.
3. **Re-configure MIP/MOP if needed.** Some MeOS versions don't persist
   the `Tools → Online` config across restart — re-enter the URLs
   from Step 6 above if necessary.
4. fartOLa's MIP backlog catches MeOS back up automatically: MeOS's
   `lastid > 0` poll receives every `<entry>` it missed during the
   outage (D-MIP-2 — `events.local_seq` is monotonic).

### Eventor cache offline / API key missing

Symptoms: the TweaksPanel Eventor row shows red `offline` or
`nyckel saknas`.

1. The walkup form falls back to the SI-firmware `cardHolderHint`
   (Phase 1 baseline behavior). Operator types name + klubb manually.
2. **Never blocks the bridge** (D-EV-3, REQ-OPS-001). Registration
   keeps working at the slower, manual-typing tempo.
3. If you fix internet / key mid-event, press **Uppdatera** in TweaksPanel
   (FARTOLA_DEV mode) to force a refresh and re-enable autocomplete.

### LAN connectivity drops between laptops

Symptoms: MIP polls stop reaching fartOLa; MeOS desk shows runners
appear minutes late.

1. Both bridges keep running independently.
2. When connectivity returns:
   - MeOS resumes polling `/mip` and catches up on missed `<entry>` via
     `lastid > 0`.
   - fartOLa resumes accepting `/mop` POSTs. MOP auto-merge runs on the
     next `<MOPComplete>`.
3. No data loss — both systems' state is durable independently.

### Reader fails / wrong serial port

Symptoms: card beep doesn't open the Walkup modal; `journalctl -u fartola`
shows `EBUSY` or `ENOENT` on `/dev/ttyUSB0`.

1. Verify `/dev/ttyUSB0` permissions. Phase 1 Plan 18 ships a udev rule
   that grants the `dialout` group read+write. Your operator user must
   be in the `dialout` group (`groups $USER`).
2. Check `dmesg | grep cp210x` for kernel driver bind.
3. Unplug + replug the BSM-mini USB cable. Wait 2s for the device
   re-enumeration.
4. Restart `fartola` after fixing.

### Bench smoke fails before the event

Symptoms: Step 9 above does NOT print `6/6 passed`.

1. Read the red error prefix — it names which assertion failed.
2. Common causes (and fixes):
   - **/mip returns invalid XML** → bridge isn't fully up; wait 10s
     and retry.
   - **MOP POST returns ERROR** → check `journalctl -u fartola` for an
     XSD validation failure; usually a stale MeOS version sending a
     pre-v2.0 MOP payload.
   - **Eventor status missing** → key not set; see Step 8.
   - **Hyrbricka round-trip fails** → check the SQLite migration ran:
     `sqlite3 ~/.local/share/fartola/fartola.db ".schema hired_cards"`
     should include `marked_at_ms`.
3. **If you can't fix the smoke before the event start**, the safe
   fallback is **MeOS-only operation** — turn off fartOLa's `0.0.0.0`
   binding (so MeOS doesn't try to poll a flapping bridge), let the
   MeOS operator drive registration solo using their existing flow,
   and reconcile in fartOLa post-event by re-typing from MeOS's exported
   results.

---

## After the event

The post-event pass is the audit trail and the data handoff:

1. **Verify all rentals returned.** Open
   `http://<fartola-ip>:3000/competition/<id>/hyrbrickor` — the admin
   backstop. Any rows in the **open** section are un-returned. Contact
   the renter via phone or email shown on the row.
2. **Cross-check fartOLa vs. MeOS.** Both systems should agree on
   competitors + finish times. If they diverge, **fartOLa is
   authoritative** (locked decision #2). Note any discrepancies in
   the post-event log.
3. **Export the IOF XML 3.0 result list.** Browser → the export route
   on the competition. Save to disk.
4. **Upload to Eventor manually.** Use Eventor's web upload form.
   Phase 2.1 will automate this; for 2.0 it's a manual step.
5. **Take a SQLite backup snapshot.** Phase 1's daily backup already
   runs at midnight; for a deterministic post-event snapshot, the
   bridge writes to `--backup-dir` (default `./backups`). Confirm the
   snapshot exists; copy it to off-site backup.

The 30-day PII scrub (REQ-PRIV-002) runs automatically: 30 days after
the event date, `competitors.name` is anonymised, `competitors.club`
is nulled, and `hired_cards.contact_*` (Plan 02-06 extension) are
nulled. `card_number`, `marked_at_ms`, and `returned_at_ms` are
preserved as audit trail.

---

## Known limitations (Phase 2.0)

Carry these in your head; they document the trade-offs we accepted to
ship by 2026-05-20.

### D-LIM-1: MOP `<cmp>` lacks the hired flag

MOP's `<cmp>` payload does not carry a hired-card flag. Hyrbrickor
MARKED in MeOS during a fartOLa outage will NOT auto-import on
recovery. **Workaround:** re-enter those rentals in fartOLa's Walkup
modal after restart, cross-referencing the MeOS hired-card list.

Phase 2.1 may revisit with a custom MIP `<response type="hiredcards"/>`
query, but that's speculative — not in the spec we have today.

### Multi-course-per-card, same event

Phase 2.0 limits one course per card per competition (the `competitors`
table's partial unique index on `card_number` enforces this, and
Phase 1's `card_bound` projection assumes it). If a runner wants to
run e.g. Orange and then a separate open course with the same card,
register them **TWICE** with two different cards. Phase 2.1 will lift
this limitation via a `competitor_courses` junction.

### MIP `<classname>` is case-sensitive (Pitfall 3)

Spell **Vit / Grön / Gul / Orange / Violett** identically in MeOS and
fartOLa. Mismatch = the MIP entry is rejected silently. See Step 7 in
the Before-the-event section for the prevention recipe.

---

## Appendix: keyboard shortcuts + URL cheat-sheet

Quick-reference for stressed-operator lookups during the event.

### URLs (substitute `<fartola-ip>` and `<id>` from your boot)

| What                              | URL                                                      |
| --------------------------------- | -------------------------------------------------------- |
| Readout view                      | `http://<fartola-ip>:3000/competition/<id>/readout`      |
| Registration desk (kids line)     | `http://<fartola-ip>:3000/competition/<id>/registration` |
| Hyrbrickor admin backstop         | `http://<fartola-ip>:3000/competition/<id>/hyrbrickor`   |
| TweaksPanel (Eventor refresh etc) | Sidebar → Tweaks from any competition route              |
| Bridge health probe               | `http://<fartola-ip>:3000/api/health`                    |
| MIP poll URL (MeOS configures)    | `http://<fartola-ip>:3000/mip`                           |
| MOP push URL (MeOS configures)    | `http://<fartola-ip>:3000/mop`                           |
| IOF XML export                    | `http://<fartola-ip>:3000/api/competitions/<id>/export`  |

### Useful CLI

```
# Tail the bridge log live
journalctl -u fartola -f

# Confirm the bench smoke is green
FARTOLA_SKIP_BOOT=1 FARTOLA_PORT=3000 FARTOLA_DB=~/.local/share/fartola/fartola.db \
  bash apps/edge/scripts/bench-smoke-phase2.sh

# Inspect open rentals from the shell
sqlite3 ~/.local/share/fartola/fartola.db \
  "SELECT card_number, contact_name, contact_phone FROM hired_cards
   WHERE competition_id = '<id>' AND returned_at_ms IS NULL;"

# Force Eventor refresh (FARTOLA_DEV=1 only)
curl -X POST http://localhost:3000/api/__admin/eventor/refresh
```

### MeOS Tools → Online menu path

The exact menu wording varies slightly across MeOS versions. The
configuration target is the same:

- MeOS English: `Tools → Online → Configure online services`.
- MeOS Swedish: `Verktyg → Online → Konfigurera online-tjänster`.

Fields to fill: MIP URL + MOP URL (both `http://<fartola-ip>:3000/...`)

- poll interval (5-10s). Password fields: the MeOS-koppling password set
  in fartOLa (D-MIP-1 / D-MOP-4 revised 2026-10-05 — no longer blank).

---

_Phase: 02-4-klubbs-mvp_
_Locked decisions: 02-CONTEXT.md (round 1) + 02-CONTEXT.md `<decisions>` (round 2)_
_Last revised: 2026-05-17 (Plan 02-06)_
