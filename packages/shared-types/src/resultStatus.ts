// Authored for fartola. Not ported from upstream.
//
// Result statuses as SOFT names them in published result lists (SOFT
// Regelverk för OL 20260701_2, TA till TR 7.8.2 and TR 4.21.3). The
// projection keeps its detailed statuses (MP, DNF, MAX …) for the
// secretariat; everything printed or published maps through softStatus().
//
//   MP, DNF, MAX → "Ej godkänd"  (felstämplat eller utgått; maxtid ger
//                                  ogiltigt resultat, TR 4.21.1)
//   DQ           → "Diskad"
//   DNS          → "Ej start"
//   OK, no_timing class → "Deltagit"
//   PEND (never read out) → "Ej utläst" while results are live, "Ej start"
//                 once final. fartOLa has no results-locked state; "final" is
//                 the IOF ResultList exported as Final (status="Complete").
//   CANCEL       → "Återbud" (SOFT has no name; withdrawn before the race)

export type ResultStatusCode = 'PEND' | 'OK' | 'MP' | 'DNF' | 'DNS' | 'DQ' | 'CANCEL' | 'MAX';

export type SoftStatus =
  | 'OK'
  | 'DELTAGIT'
  | 'EJ_GODKAND'
  | 'DISKAD'
  | 'EJ_START'
  | 'EJ_UTLAST'
  | 'ATERBUD';

export function softStatus(
  status: ResultStatusCode,
  opts: { noTiming?: boolean; final?: boolean } = {}
): SoftStatus {
  switch (status) {
    case 'OK':
      return opts.noTiming === true ? 'DELTAGIT' : 'OK';
    case 'MP':
    case 'DNF':
    case 'MAX':
      return 'EJ_GODKAND';
    case 'DQ':
      return 'DISKAD';
    case 'DNS':
      return 'EJ_START';
    case 'PEND':
      return opts.final === true ? 'EJ_START' : 'EJ_UTLAST';
    case 'CANCEL':
      return 'ATERBUD';
  }
}

/** Swedish labels, for surfaces without i18n (printed receipts). */
export const SOFT_STATUS_SV: Record<SoftStatus, string> = {
  OK: 'Godkänd',
  DELTAGIT: 'Deltagit',
  EJ_GODKAND: 'Ej godkänd',
  DISKAD: 'Diskad',
  EJ_START: 'Ej start',
  EJ_UTLAST: 'Ej utläst',
  ATERBUD: 'Återbud',
};
