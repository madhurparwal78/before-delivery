import type { ServiceKind } from '../types.js';

/** The per-kind sanitation buffer in minutes, decided in exactly one place. */
export function sanitationBufferMinutes(kind: string): number {
  switch (kind) {
    case 'blast_chiller': return 45;
    case 'oven': return 30;
    case 'mixer': return 30;
    case 'prep_table': return 15;
    default: return 0;
  }
}

export const BOOKING_STEP_MINUTES = 15;
export const CHECK_IN_LEAD_MINUTES = 15;
export const NO_SHOW_DELAY_MINUTES = 30;
export const BOOKING_HORIZON_DAYS = 90;
export const NEXT_DAY_CUTOFF_LOCAL_TIME = '18:00:00';
export const HOLD_LIMIT = 3;
export const LOT_VALID_DAYS = 60;
export const EXPIRING_SOON_DAYS = 14;
export const RETURN_GAP_HOURS = 24;
export const COI_MIN_COVERAGE_DOLLARS = 1000000;
export const MAX_JSON_BYTES = 65536;
export const MAX_MULTIPART_BYTES = 5500000;
export const MAX_FILE_BYTES = 5000000;
export const REPORT_MIN_MONTH = '2000-01';
export const REPORT_MAX_MONTH = '2099-12';
export const SERVICES: ServiceKind[] = [
  'potable_water',
  'grey_water',
  'grease',
  'food_storage',
  'cleaning',
  'restock',
];
