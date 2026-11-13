import type { BookingStatus, CoverageState, ErrorCode } from '../shared/api.js';
import { groupedCount, money } from './format.js';

export const STATUS_LABELS: Record<BookingStatus, string> = {
  submitted: 'Submitted',
  open: 'Open call',
  partially_covered: 'Partly covered',
  covered: 'Covered',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  cancelled_late: 'Cancelled (late)',
};

export const COVERAGE_LABELS: Record<CoverageState, string> = {
  uncovered: 'Uncovered',
  partly_covered: 'Partly covered',
  covered: 'Covered',
};

export const PENDING = {
  signIn: 'Signing in…',
  submitRequest: 'Submitting request…',
  makeTeam: 'Updating seats…',
  postOpenCall: 'Posting open call…',
  assign: 'Assigning…',
  claim: 'Claiming seat…',
  release: 'Releasing seat…',
  checkIn: 'Checking in…',
  complete: 'Recording completion…',
  quote: 'Checking the cancellation window…',
  cancel: 'Cancelling…',
  upload: (file: string) => `Uploading ${file}…`,
  download: 'Preparing download…',
  closeWeek: 'Closing week…',
  addRate: 'Saving rate…',
} as const;

export const NETWORK_FAILURE =
  'Relayline could not reach the server. Your last action may not have saved; refresh to check.';

export const SESSION_ENDED_LINE =
  'Your session has ended. Sign in again to finish this action.';

export const NOT_AVAILABLE = "That booking isn't available to you.";

const SHARED_ERRORS: Partial<Record<ErrorCode, string>> = {
  forbidden: "Your role can't do that.",
  not_found: NOT_AVAILABLE,
  idempotency_in_progress:
    'That request is still being processed. Wait a moment, then check.',
  invalid_credentials: 'Email or password is wrong.',
};

export function invalidTransitionCopy(status: BookingStatus): string {
  return `This booking is now ${STATUS_LABELS[status]}. The page has been refreshed.`;
}

const ACTION_ERRORS: Record<string, Partial<Record<ErrorCode, string>>> = {
  assign: {
    schedule_conflict: 'That interpreter already has an assignment at this time.',
    not_qualified: "That interpreter's credentials don't cover this setting.",
    seat_filled: 'Already filled — another interpreter took this seat.',
    already_holding: 'That interpreter already holds a seat on this booking.',
  },
  claim: {
    seat_filled: 'Already filled — another interpreter took this seat.',
    schedule_conflict: 'You already have an assignment at that time.',
    open_call_closed: 'This open call has closed. Contact dispatch.',
    already_holding: 'You already hold a seat on this booking.',
  },
  openCall: {
    open_call_closed:
      'The open call for this booking has closed. Assign an interpreter directly.',
  },
  submitRequest: {
    validation: 'Check the highlighted fields.',
  },
  complete: {
    validation: 'Check the highlighted fields.',
  },
  cancel: {
    quote_changed: 'The cancellation window just changed. Review the new charge.',
  },
  upload: {
    payload_too_large: 'Files must be 10,000,000 bytes or smaller.',
    unsupported_type:
      'Only PDF, PNG, JPEG, Word (.docx) and PowerPoint (.pptx) files are accepted.',
    storage_unavailable: 'File storage is unavailable. Try the upload again shortly.',
  },
  download: {
    access_ended: 'Your access to these materials has ended.',
    link_expired: 'That download link has expired. Press Download again.',
    storage_unavailable: 'Prep materials are unavailable right now. Try again shortly.',
  },
  closeWeek: {
    pending_sync: 'Some lines are still waiting to sync with billing. Try again shortly.',
    billing_unavailable: 'Billing is unreachable. Nothing was closed; try again shortly.',
    total_mismatch: 'Relayline and billing totals differ. Nothing was closed.',
    week_closed: 'This week is already closed.',
  },
};

export interface ErrorCopyInput {
  action: string;
  code: ErrorCode;
  status?: BookingStatus | undefined;
  fields?: Record<string, string> | undefined;
  earliestAllowed?: string | undefined;
}

export function errorCopy(input: ErrorCopyInput): string {
  if (input.code === 'invalid_transition' && input.status) {
    return invalidTransitionCopy(input.status);
  }
  if (input.code === 'rate_would_reprice' && input.earliestAllowed !== undefined) {
    return `That date would reprice billed work. Choose a date on or after ${input.earliestAllowed}.`;
  }
  const scoped = input.action === 'other' ? undefined : ACTION_ERRORS[input.action]?.[input.code];
  if (scoped !== undefined) return scoped;
  const shared = SHARED_ERRORS[input.code];
  if (shared !== undefined) return shared;
  if (input.code === 'validation') {
    const first = input.fields ? Object.values(input.fields)[0] : undefined;
    return first ?? 'Check the highlighted fields.';
  }
  return NOT_AVAILABLE;
}

export const SUCCESS = {
  submitRequest: (ref: string) => `Request ${ref} submitted.`,
  makeTeam: (ref: string) => `${ref} now needs a team of two.`,
  postOpenCall: (ref: string) => `Open call posted for ${ref}.`,
  assign: (name: string, seat: number, ref: string) =>
    `${name} holds seat ${seat} on ${ref}.`,
  claim: (seat: number, ref: string) => `You hold seat ${seat} on ${ref}.`,
  release: (seat: number, ref: string) => `Seat ${seat} on ${ref} is open again.`,
  checkIn: (ref: string) => `${ref} is in progress.`,
  complete: (ref: string, lineRef: string) =>
    `${ref} completed. Invoice line ${lineRef} recorded.`,
  cancel: (ref: string, chargeCents: number) =>
    chargeCents > 0
      ? `${ref} cancelled. Late charge ${money(chargeCents)} recorded.`
      : `${ref} cancelled.`,
  upload: (file: string) => `${file} attached.`,
  closeWeek: (date: string, org: string, relayline: number, billing: number) =>
    `Week of ${date} closed for ${org}. Relayline ${money(relayline)} matches billing ${money(billing)}.`,
  addRate: (date: string) => `New rate takes effect ${date}.`,
} as const;

export const QUOTE_COPY = {
  onTime: (cutoff: string) =>
    `Cancelling now is on time. No charge. Free cancellation ended or ends ${cutoff}.`,
  lateWithCharge: (amount: number) =>
    `This is a late cancellation (inside two business days). Charge: ${money(amount)}.`,
  lateNoSeat:
    'This is inside two business days, but no interpreter holds a seat yet. No charge.',
} as const;

export function titleHint(count: number): string {
  return `${groupedCount(count)} of 120 characters`;
}

export function notesHint(count: number): string {
  return `${groupedCount(count)} of 1,000 characters`;
}

export function openCallOpenLine(closesAt: string): string {
  return `Open call closes ${closesAt.slice(0, 10)} ${closesAt.slice(11, 16)}`;
}

export const OPEN_CALL_CLOSED_LINE = 'Open call closed — assign directly';

export function seatFilledNotice(seat: number): string {
  return `Seat ${seat} was just filled. Close this dialog to see the update.`;
}

export function noMatchLine(query: string): string {
  return `No interpreter matches "${query}".`;
}

export function weekTotalsLine(relayline: number, billing: number | null): string {
  return billing === null
    ? `Relayline ${money(relayline)} · billing not yet confirmed`
    : `Relayline ${money(relayline)} · billing ${money(billing)}`;
}

export const BILLING_UNAVAILABLE_LINE = 'Billing amounts are unavailable right now.';
