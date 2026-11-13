export type Role = 'coordinator' | 'interpreter' | 'requester' | 'billing_manager';

export const AGENCY_TIME_ZONE = 'America/Chicago';
export const AGENCY_NAME = 'Tandem Hands Collective';
export const SOLO_THRESHOLD_MINUTES = 60;

export const SETTING_CODES = ['medical', 'educational', 'legal', 'workplace'] as const;
export type SettingCode = (typeof SETTING_CODES)[number];

export const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  open: 'Open call',
  partially_covered: 'Partly covered',
  covered: 'Covered',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  cancelled_late: 'Cancelled (late)',
};

export type BookingStatus =
  | 'submitted' | 'open' | 'partially_covered' | 'covered'
  | 'in_progress' | 'completed' | 'cancelled' | 'cancelled_late';

export type CoverageState = 'covered' | 'partly_covered' | 'uncovered';
export type OpenCallStatus = 'none' | 'open' | 'closed';
export type SyncStatus = 'synced' | 'pending_sync';
export type LineKind = 'completed' | 'late_cancellation';

export const TEXT_LIMITS = {
  title: 120,
  location: 200,
  onsite_contact_name: 80,
  consumer_name: 80,
  onsite_contact_phone: 25,
  requester_notes: 1000,
  material_name: 120,
  search_q: 80,
} as const;

export const UPLOAD_LIMIT_BYTES = 10_000_000;
export const MAX_FILES_PER_BOOKING = 10;

export const ACCEPTED_TYPES: readonly string[] = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

export const FIELD_MESSAGES = {
  org_id: 'Choose a client organisation.',
  setting: 'Choose medical, educational or workplace.',
  title: 'Enter a title of up to 120 characters.',
  location: 'Enter where the interpreter should go.',
  onsite_contact_name: 'Name the person who meets the interpreter.',
  onsite_contact_phone: 'Enter a phone number for the on-site contact.',
  consumer_name: "Enter the Deaf consumer's name.",
  start: 'Enter a start date and time.',
  start_skipped: "That time doesn't exist in agency time on that date.",
  start_too_soon: 'Start must be at least 15 minutes from now.',
  duration_minutes: 'Length must be 30 to 480 minutes in 15-minute steps.',
  requester_notes: 'Notes can be up to 1,000 characters.',
  interpreter_id: 'Choose an interpreter.',
  seat: 'Choose a seat this booking has.',
  q: 'Search text can be up to 80 characters.',
  worked_minutes: 'Worked minutes must be a whole number from 1 to 720.',
  mileage_miles: 'Mileage must be a whole number from 0 to 500.',
  quoted_charge_cents: 'Confirm the quoted charge.',
  idempotency_key: 'Idempotency-Key must be 1 to 100 visible ASCII characters.',
  file: 'Choose a file to upload. A non-empty file is required.',
  file_full: 'A booking can hold up to 10 files.',
  effective_from: 'Choose a date after today.',
  effective_from_taken: 'A rate already starts on that date.',
  hourly_rate_cents: 'Enter an hourly rate from $0.01 to $1,000.00.',
  team_surcharge_bp: 'Enter a surcharge from 0 to 100 percent.',
  mileage_cents_per_mile: 'Enter a mileage rate from 0 to 1,000 cents.',
  week_start: 'Choose a Monday that is not in the future.',
  range: 'Choose a range of at most 31 days.',
} as const;
