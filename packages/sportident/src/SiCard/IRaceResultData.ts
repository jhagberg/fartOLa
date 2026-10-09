// Ported from allestuetsmerweh/sportident.js — packages/sportident/src/SiCard/IRaceResultData.ts
// Upstream: https://github.com/allestuetsmerweh/sportident.js (MIT License)
// Local modifications: import path `siProtocol` -> `siProtocol.ts` (Node 22 strip-types
// requires the suffix; root tsconfig has `allowImportingTsExtensions: true`).
//   - startCode/finishCode/checkCode: station codes of the start, finish and check units.
//   - batteryMillivolts/hardwareVersion/softwareVersion: SIAC block 3.
// See packages/sportident/NOTICE.md for cumulative attribution.

import type { SiTimestamp } from '../siProtocol.ts';

export interface IRaceResultData {
  cardNumber?: number;
  cardHolder?: { [property: string]: unknown };
  clearTime?: SiTimestamp;
  checkTime?: SiTimestamp;
  startTime?: SiTimestamp;
  finishTime?: SiTimestamp;
  /** Station codes (CN) of the units that stamped start/finish/check. Absent on SI5. */
  startCode?: number;
  finishCode?: number;
  checkCode?: number;
  /** Subsecond of the start/finish time in 1/256 s (0-255): PTD bit 7 set, CN = TSS. Absent: no fraction. SI6 and newer. */
  startSubsec256?: number;
  finishSubsec256?: number;
  /** SIAC block 3: battery voltage in mV, hardware and software version "major.minor". */
  batteryMillivolts?: number;
  hardwareVersion?: string;
  softwareVersion?: string;
  punches?: IPunch[];
}

export interface IPunch {
  code: number;
  time: SiTimestamp;
}
