export const EMPLOYER_NAME = 'Kestrel Works';
export const TIME_ZONE = 'Europe/London';

export const REQUEST_STATES = ['pending', 'approved', 'rejected', 'cancelled'];

export const STATE_WORDS = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export const CORRECTION_TYPES = ['missed_in', 'missed_out', 'offsite', 'whole_day', 'night_shift'];

export const CORRECTION_TYPE_LABELS = {
  missed_in: 'Sign in was not recorded',
  missed_out: 'Sign out was not recorded',
  offsite: 'Worked away from the workplace',
  whole_day: 'Whole day worked but not recorded',
  night_shift: 'Night shift recorded against the wrong day',
};

export const CLAIM_REQUIREMENTS = {
  missed_in: ['claimed_in'],
  missed_out: ['claimed_out'],
  offsite: ['claimed_in', 'claimed_out'],
  whole_day: ['claimed_in', 'claimed_out'],
  night_shift: ['claimed_in', 'claimed_out'],
};

export const ROLE_LINES = {
  employee: 'Employee',
  manager: 'Manager',
  admin: 'People operations',
};

export const QUEUE_SORTS = ['day', 'raised', 'person'];

export const SORT_OPTIONS = [
  { value: '', label: 'Waiting first' },
  { value: 'day', label: 'Day, newest first' },
  { value: 'raised', label: 'Raised, oldest first' },
  { value: 'person', label: 'Person, A to Z' },
];

export const STATE_CHIP_FILTERS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const CALENDAR_MARKS = [
  { key: 'recorded', label: 'Attendance recorded', glyph: 'check' },
  { key: 'incomplete', label: 'Attendance incomplete', glyph: 'clock' },
  { key: 'leave_approved', label: 'Leave approved', glyph: 'calendar' },
  { key: 'leave_pending', label: 'Leave pending', glyph: 'bar' },
  { key: 'waiting', label: 'Correction waiting', glyph: 'bell' },
];

export const PAGE_SIZE = 25;

export const REASON_MIN = 20;
export const REASON_MAX = 280;
export const NOTE_MAX = 500;
export const REJECTION_NOTE_MIN = 10;
export const MAX_BODY_BYTES = 65536;
export const MAX_JSON_DEPTH = 8;
export const MAX_SEARCH_LENGTH = 100;
export const SIGN_IN_MAX_ATTEMPTS = 5;
export const GENESIS_HASH = '0'.repeat(64);
export const SEEDED_PASSWORD = 'deku-demo-pw-2026';
