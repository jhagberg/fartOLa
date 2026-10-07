// Authored for fartola. Not ported from upstream.
//
// Glue between the event log and the pure watchdog: loads the radio punches
// and the read-out card punches of a competition, puts them on the
// competition wall clock and evaluates. Read-only; results are not touched.

import { and, eq, gte } from 'drizzle-orm';
import type { HalfDayClock } from '@fartola/sportident';
import type { RadioStatus } from '@fartola/shared-types';

import { competitions, events } from '../../db/schema.ts';
import type { DbHandle } from '../../db/index.ts';
import { cardClockToWallMs, wallMsToEpochMs } from '../../projection/halfDayClockMath.ts';
import { epochToWallClockMs } from '../../time/competitionClock.ts';
import { cardTypeFromNumber } from '../../si/cardType.ts';
import type { RocPollStatus } from './poller.ts';
import {
  evaluateRadioWatchdog,
  WATCHDOG_DEFAULTS,
  type CardPunchIn,
  type RadioPunchIn,
} from './watchdog.ts';

const ROC_START_CODE = 1;
const ROC_FINISH_CODE = 2;
const ROC_CHECK_CODE = 3;

/** '52,78,100' → [52, 78, 100]; anything that is not a code is dropped. */
export function parseRocControls(text: string | null): number[] {
  if (!text) return [];
  const codes = text
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(codes)].sort((a, b) => a - b);
}

export function buildRadioStatus(
  handle: DbHandle,
  competitionId: string,
  nowMs: number,
  poll: RocPollStatus | null
): RadioStatus | null {
  const comp = handle.db
    .select({
      enabled: competitions.rocEnabled,
      unitId: competitions.rocCompetitionId,
      startId: competitions.rocStartId,
      lastId: competitions.rocLastId,
      controlsText: competitions.rocControls,
      raceStartedAtMs: competitions.raceStartedAtMs,
    })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .get();
  if (!comp) return null;

  const radioControls = parseRocControls(comp.controlsText);
  const radio: RadioPunchIn[] = [];
  for (const e of handle.db
    .select({ eventTimeMs: events.eventTimeMs, payload: events.payload })
    .from(events)
    .where(and(eq(events.competitionId, competitionId), eq(events.eventType, 'radio_punch')))
    .all()) {
    const p = e.payload;
    if (p.event_type !== 'radio_punch') continue;
    radio.push({
      code: p.control_code,
      card: p.card_number,
      wallMs: p.wall_ms,
      receivedMs: p.received_at_ms,
      delayMs: p.received_at_ms - e.eventTimeMs,
      dateMismatch: p.date_mismatch,
    });
  }

  // A punch is read out after it is made, so a read from before the longest
  // look-back cannot hold a punch inside it. Reads before the race started are
  // identity scans (as in the reducer).
  const since = nowMs - (WATCHDOG_DEFAULTS.silenceLookbackMin + 5) * 60_000;
  const card: CardPunchIn[] = [];
  for (const e of handle.db
    .select({ eventTimeMs: events.eventTimeMs, payload: events.payload })
    .from(events)
    .where(
      and(
        eq(events.competitionId, competitionId),
        eq(events.eventType, 'card_read'),
        gte(events.eventTimeMs, since)
      )
    )
    .all()) {
    const p = e.payload;
    if (p.event_type !== 'card_read') continue;
    if (comp.raceStartedAtMs !== null && e.eventTimeMs < comp.raceStartedAtMs) continue;
    // Start, finish and check are card fields, not punches; ROC sends them
    // as codes 1, 2 and 3 (the control types of the oPunch rows).
    const clocks: Array<[number, HalfDayClock | null]> = [
      [ROC_START_CODE, p.start],
      [ROC_FINISH_CODE, p.finish],
      [ROC_CHECK_CODE, p.check],
      ...p.punches.map((x): [number, HalfDayClock] => [x.code, x]),
    ];
    const siac = cardTypeFromNumber(p.card_number) === 'SIAC';
    for (const [code, clock] of clocks) {
      if (clock === null) continue;
      const wallMs = cardClockToWallMs(clock, p.card_type, e.eventTimeMs);
      card.push({ code, card: p.card_number, wallMs, epochMs: wallMsToEpochMs(wallMs), siac });
    }
  }

  const controls = evaluateRadioWatchdog(radio, card, {
    nowWallMs: epochToWallClockMs(nowMs),
    nowMs,
    expectedCodes: radioControls,
  });

  return {
    settings: {
      enabled: comp.enabled,
      roc_competition_id: comp.unitId,
      start_id: comp.startId,
      last_id: comp.lastId,
      radio_controls: radioControls,
    },
    poll:
      poll === null
        ? null
        : {
            last_poll_at: poll.lastPollAt,
            last_success_at: poll.lastSuccessAt,
            last_error: poll.lastError,
            consecutive_failures: poll.consecutiveFailures,
          },
    now_ms: nowMs,
    window_min: WATCHDOG_DEFAULTS.windowMin,
    silence_min: WATCHDOG_DEFAULTS.silenceMin,
    coverage_threshold: WATCHDOG_DEFAULTS.coverageThreshold,
    controls,
  };
}
