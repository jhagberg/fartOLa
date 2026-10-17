---
created: 2026-10-17T00:00:00+02:00
title: Eventor calls Oxygen makes that fartOLa lacks
area: eventor
files:
  - apps/edge/src/eventor/
  - apps/edge/src/routes/eventor.ts
  - apps/edge/src/routes/eventorImport.ts
  - apps/edge/src/routes/eventorPush.ts
---

## Problem

Compared our Eventor calls with open-orienteering/oxygen
`packages/api/src/eventor.ts` at `3bc7cd44aa70c87c821d79f3ff7e7d13fb4572bd`
(AGPL-3.0, read through `gh api` only, nothing cloned or run). Oxygen is a
reference for which calls exist, not code to copy.

## Comparison

All paths are under `https://eventor.orientering.se/api/`. Oxygen function
names are from `eventor.ts`.

| Endpoint                                  | fartOLa                                                  | Oxygen                                      | What it gives an organiser                                |
| ----------------------------------------- | -------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------- |
| `GET export/cachedcompetitors` (zip)      | download.ts:91                                           | `fetchCachedCompetitors`                    | runner and card lookup for the whole country              |
| `GET export/clubs`                        | download.ts:92                                           | (uses `organisations`)                      | club names and ids                                        |
| `GET export/entries`                      | entries.ts:55                                            | `fetchEntries` (uses `entries`)             | entry list import                                         |
| `GET events`                              | events.ts:147                                            | `fetchEvents`, `fetchEventsBroad`           | pick the club's events in the wizard                      |
| `GET event/{id}`                          | fetchEvent.ts:69                                         | `fetchEventMeta`, `fetchEventOrganiser`     | event name, date, organiser                               |
| `GET eventclasses`                        | eventClasses.ts:76, entryFees.ts:107                     | `fetchEventClasses`                         | class list and fees                                       |
| `GET entryfees/events/{id}`               | entryFees.ts:106                                         | no                                          | fee schedule                                              |
| `POST import/resultlist` (zip)            | push.ts:184                                              | `uploadResults`                             | results to Eventor                                        |
| `POST import/startlist` (zip)             | push.ts:184                                              | `uploadStartList`                           | start list to Eventor                                     |
| `GET organisation/apiKey`                 | no                                                       | `validateApiKey`                            | "this key belongs to club X" check when the key is saved  |
| `GET export/classes` (IOF 3.0)            | no                                                       | `fetchNoTimingClassNames` (private)         | classes marked `UnorderedNoTimes` (no ranking)            |
| `GET starts/event/iofxml`                 | no                                                       | `fetchStartListCourseLengths` (private)     | course length per class from the published start list     |
| `GET organisations`                       | no                                                       | `fetchClubs`, `fetchReferencedClubs`        | club address and details (we use `export/clubs` instead)  |
| `GET results/event`                       | no                                                       | `fetchResults`                              | pull published results back (verify our upload)           |
| `GET competitors?organisationId=`         | no                                                       | `fetchCompetitors`                          | the club's own member list (a smaller cache than national)|
| `GET organisation/logo`                   | no                                                       | `fetchClubLogo`                             | club logo for start list or receipt header                |

## Calls we lack, ranked for a Swedish club competition

1. **`organisation/apiKey`**. Done when saving a key in settings shows the
   club it belongs to, and a bad key says so at once instead of failing at
   the first download.
2. **`export/classes` with `resultListMode`**. Done when a class that
   Eventor marks `UnorderedNoTimes` is imported without a ranking, with a
   test using a synthetic XML.
3. **`starts/event/iofxml` course lengths**. Done when classes imported
   from Eventor with no course file get a length from the start list. Check
   first whether todo `2026-10-09-eventor-classes-without-course-file`
   already covers this.
4. **`results/event`**. Done when, after a push, a screen can show that
   Eventor has the same result list (read-back check). Lower value, the
   POST already reports errors.
5. **`organisation/logo`**. Done when a start list or receipt shows the
   club logo, fetched once and cached on disk. Cosmetic.
6. **`competitors?organisationId=`**, **`organisations`**. Skip unless a
   need shows up: `cachedcompetitors` and `export/clubs` already cover them.

## How to build

- Write our own from Eventor's documentation
  (eventor.orientering.se/api/documentation). Use Oxygen only as a
  reference to cite in a code comment: "mimic + cite" (ADR-0001). Name the
  file and function, with the sha above.
- If a port is ever wanted, it stays in `apps/edge` (AGPL), with a header
  naming `open-orienteering/oxygen packages/api/src/eventor.ts@<sha>`,
  AGPL-3.0, and a NOTICE line. Never into `packages/sportident` (MIT).
- New files start with `// Authored for fartola. Not ported from upstream.`
  unless they are a port.

## Edge cases Oxygen handles that we do not

Facts from the file, to check against Eventor's docs before copying the idea.

- **Test-Eventor environment**: `EVENTOR_URLS` has `test:
  https://eventor-sweden-test.orientering.se/api/` next to `prod`;
  `eventorBaseUrl` also takes an `EVENTOR_API_BASE_URL` override for a local
  stub. Our base URL is a `DEFAULT_BASE_URL` constant per module
  (`baseUrl` option only, no test environment, no env override). Useful for
  trying `push.ts` without writing to the real Eventor.
- **Key rejection as its own error**: `EventorAuthError` for 403, so a
  caller can tell a dead key from a transient failure. We only have
  `forbidden` in `fetchEventorEvent` (fetchEvent.ts:82); the other modules
  throw a generic status error.
- **Key validation**: `validateApiKey` (see above).
- **Zip responses**: `fetchCachedCompetitors` unzips in memory with adm-zip.
  We stream with yauzl (download.ts) and are better placed for the 90 MB
  file; nothing to take.
- **Rate limits**: I found none in `eventor.ts`: no throttling and no
  retry on GET. We have more: `push.ts` retries 429/500/502/503 with
  backoff and every module has a timeout. Not a gap.
- **Timeout only on logo**: `fetchClubLogo` aborts after 8 s and returns
  `null` on any failure; the other Oxygen calls have no timeout.
- **Shared fetch helper**: one `eventorFetch` for all GETs (sets `ApiKey`,
  maps 403). We have `eventorGet` in eventClasses.ts:51, used only by two
  modules; the others each repeat the fetch, timeout and abort code.

## Not verified

- Eventor's own documentation was not read here; endpoint paths and
  parameters come from our code and from Oxygen.
- Rate limits at Eventor itself: unknown. The documentation may state
  limits that neither project handles.
