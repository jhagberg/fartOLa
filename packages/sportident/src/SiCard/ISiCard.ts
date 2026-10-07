// Ported from allestuetsmerweh/sportident.js — packages/sportident/src/SiCard/ISiCard.ts
// Upstream: https://github.com/allestuetsmerweh/sportident.js (MIT License)
// Local modifications: import path suffix `.ts`; optional startCode/finishCode/checkCode. See packages/sportident/NOTICE.md.

import type { SiStorage } from '../storage/SiStorage.ts';
import type { SiTimestamp } from '../siProtocol.ts';
import type { IPunch, IRaceResultData } from './IRaceResultData.ts';

export interface ISiCard {
  cardNumber: number;
  storage: SiStorage<IBaseSiCardStorageFields>;
  read: () => Promise<ISiCard>;
  toDict: () => IRaceResultData;
  toString: () => string;
}

export interface IBaseSiCardStorageFields {
  cardNumber: number;
  clearTime?: SiTimestamp;
  checkTime: SiTimestamp;
  startTime: SiTimestamp;
  finishTime: SiTimestamp;
  /** Station codes (CN); SI6 and newer only. */
  startCode?: number;
  finishCode?: number;
  checkCode?: number;
  /** The record was a touch-free (Air+) punch: PTD bit 7. SI8 and newer only. */
  startTouchFree?: boolean;
  finishTouchFree?: boolean;
  checkTouchFree?: boolean;
  punchCount: number;
  punches: IPunch[];
  cardHolder: { [key: string]: unknown };
}
