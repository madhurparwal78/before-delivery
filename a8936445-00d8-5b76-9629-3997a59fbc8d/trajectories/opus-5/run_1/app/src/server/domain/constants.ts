export const KITCHEN = {
  name: 'Larder Row Kitchen',
  timeZone: 'America/Chicago',
  salesTaxRatePercent: '8.25',
  mailFrom: 'Stationkeeper at Larder Row Kitchen <bookings@larderrow.test>',
} as const;

export const CLEANING_BUFFER_MINUTES = 30;
export const MIN_HOLD_MINUTES = 60;
export const MAX_HOLD_MINUTES = 480;
export const MAX_WEEKS = 12;
export const BOOKING_WINDOW_DAYS = 365;
export const DIAL_PAST_DAYS = 30;
export const CHECK_IN_LEAD_MINUTES = 15;
export const HOLDOVER_GRACE_MINUTES = 10;
export const HOLDOVER_ROUNDING_MINUTES = 15;
export const MAX_HOLDOVER_MINUTES = 240;
export const DOCUMENT_SIZE_CAP_BYTES = 5_000_000;
export const UPLOAD_REQUEST_CAP_BYTES = 5_100_000;
export const JSON_BODY_CAP_BYTES = 65_536;
export const REMINDER_LEAD_DAYS = 14;
export const MAX_SEARCH_ROWS = 200;

export const DOCUMENT_KINDS = ['certificate_of_insurance', 'food_handler_card', 'health_permit'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const REQUIRED_DOCUMENT_KINDS: readonly DocumentKind[] = [
  'certificate_of_insurance',
  'health_permit',
  'food_handler_card',
];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  certificate_of_insurance: 'Certificate of insurance',
  food_handler_card: 'Food handler card',
  health_permit: 'Health permit',
};

export type TenantStatus = 'applied' | 'documents_review' | 'active' | 'suspended' | 'offboarded';
export type BookingStatus = 'held' | 'confirmed' | 'checked_in' | 'completed' | 'cancelled' | 'no_show';
export type PayWith = 'account' | 'hour_pack';
export type UserRole = 'operator' | 'owner' | 'cook';
export type StationKind = 'hot_line' | 'bake_deck' | 'cold_prep';
export type LedgerAccount = 'tenant_pack' | 'kitchen_hours';
export type LedgerReason =
  | 'opening_balance'
  | 'pack_purchase'
  | 'booking'
  | 'cancellation_return'
  | 'fee_refund';
export type InvoiceLineKind = 'station_time' | 'holdover' | 'late_fee' | 'storage';
