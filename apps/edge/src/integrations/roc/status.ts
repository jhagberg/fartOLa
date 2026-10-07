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
import { cardClockToEpochMs } from '../../projection/halfDayClockMath.ts';
import { competitionClockOffsetMin } from '../../time/competitionClock.ts';
import { placeTimeOfDay } from './place.ts';
import { cardTypeFromNumber } from '../../si/cardType.ts';
import type { RocPollStatus } from './poller.ts';
import {
  evaluateRadioWatchdog,
  WATCHDOG_DEFAULTS,
  type CardPunchIn,
  type RadioPunchIn,
} from './watchdog.ts';

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
      startText: competitions.rocStartCodes,
      checkText: competitions.rocCheckCodes,
      finishText: competitions.rocFinishCodes,
      raceStartedAtMs: competitions.raceStartedAtMs,
      date: competitions.date,
      clockOffsetMin: competitions.clockOffsetMin,
    })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .get();
  if (!comp) return null;

  const offsetMin = competitionClockOffsetMin(comp.date, comp.clockOffsetMin);
  const radioControls = parseRocControls(comp.controlsText);
  const startCodes = parseRocControls(comp.startText);
  const checkCodes = parseRocControls(comp.checkText);
  const finishCodes = parseRocControls(comp.finishText);
  const radio: RadioPunchIn[] = [];
  for (const e of handle.db
    .select({ eventTimeMs: events.eventTimeMs, payload: events.payload })
    .from(events)
    .where(and(eq(events.competitionId, competitionId), eq(events.eventType, 'radio_punch')))
    .all()) {
    const p = e.payload;
    if (p.event_type !== 'radio_punch') continue;
    // Placed again from the time of day and the receive time, as the poller
    // does, so events from earlier builds (no stored placement) match too.
    const timeMs = placeTimeOfDay(p.time_of_day, p.received_at_ms, offsetMin);
    radio.push({
      code: p.control_code,
      card: p.card_number,
      timeMs,
      receivedMs: p.received_at_ms,
      delayMs: p.received_at_ms - timeMs,
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
    // Start, finish and check are card fields, not punches. Each is compared
    // with the radio rows of the unit that stamped it (the card's CN).
    const siac = cardTypeFromNumber(p.card_number) === 'SIAC';
    const add = (
      clock: HalfDayClock | null,
      code: number,
      role?: 'start' | 'check' | 'finish'
    ): void => {
      if (clock === null) return;
      const timeMs = cardClockToEpochMs(clock, p.card_type, e.eventTimeMs, offsetMin);
      card.push({
        code,
        ...(role ? { role, unit: clock.code ?? null } : {}),
        card: p.card_number,
        timeMs,
        siac,
      });
    };
    add(p.start, 0, 'start');
    add(p.finish, 0, 'finish');
    add(p.check, 0, 'check');
    for (const x of p.punches) add(x, x.code);
  }

  const controls = evaluateRadioWatchdog(radio, card, {
    nowMs,
    expectedCodes: radioControls,
    roleCodes: { start: startCodes, check: checkCodes, finish: finishCodes },
  });

  return {
    settings: {
      enabled: comp.enabled,
      roc_competition_id: comp.unitId,
      start_id: comp.startId,
      last_id: comp.lastId,
      radio_controls: radioControls,
      start_codes: startCodes,
      check_codes: checkCodes,
      finish_codes: finishCodes,
      heard_codes: [...new Set(radio.map((r) => r.code))]
        .filter(
          (c) => ![...radioControls, ...startCodes, ...checkCodes, ...finishCodes].includes(c)
        )
        .sort((a, b) => a - b),
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
    clock_offset_min: offsetMin,
    window_min: WATCHDOG_DEFAULTS.windowMin,
    silence_min: WATCHDOG_DEFAULTS.silenceMin,
    coverage_threshold: WATCHDOG_DEFAULTS.coverageThreshold,
    controls,
  };
}
