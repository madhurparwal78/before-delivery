// Screen copy, decided once. The screens never show the API's top-level message.
import type { QuoteInfo } from '../shared/api.js';
import { formatCents } from './dom.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function cutoffText(iso: string): string {
  const d = new Date(iso);
  const datePart = iso.slice(0, 10);
  const [y, m, day] = datePart.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
  return `${weekday} ${datePart} ${iso.slice(11, 16)}`;
}

export function amount(cents: number): string {
  return formatCents(cents);
}

export function quoteCopy(quote: QuoteInfo): string {
  if (!quote.late) {
    return `On time: Cancelling now is on time. No charge. Free cancellation ended or ends ${cutoffText(quote.cutoff)}.`;
  }
  if (quote.interpreter_count === 0) {
    return `This is inside two business days, but no interpreter holds a seat yet. No charge.`;
  }
  return `This is a late cancellation (inside two business days). Charge: ${formatCents(quote.charge_cents)}.`;
}

export function quoteLabel(quote: QuoteInfo | null, pending: boolean): string {
  if (pending) return 'Checking the cancellation window…';
  if (quote === null) return 'Checking the cancellation window…';
  if (!quote.late || quote.interpreter_count === 0) return 'Confirm cancellation';
  return 'Confirm cancellation';
}

export function confirmButtonName(quote: QuoteInfo | null, changed: boolean): string {
  if (quote === null) return 'Checking the cancellation window…';
  return changed ? 'Confirm new charge' : 'Confirm cancellation';
}

export function openCallLine(status: string, closesAt: string | null, role: string): string {
  if (status === 'open' && closesAt) {
    const date = closesAt.slice(0, 10);
    const time = closesAt.slice(11, 16);
    return `Open call closes ${date} ${time}`;
  }
  if (status === 'closed') {
    if (role === 'coordinator') return 'Open call closed — assign directly';
    return '';
  }
  return '';
}

export const ERROR_COPY: Record<string, string> = {
  invalid_credentials: 'Email or password is wrong.',
  forbidden: "Your role can't do that.",
  not_found: "That booking isn't available to you.",
  idempotency_in_progress: 'That request is still being processed. Wait a moment, then check.',
  invalid_transition: '', // filled with status label at call sites
  seat_filled: 'Already filled — another interpreter took this seat.',
  already_holding_claim: 'You already hold a seat on this booking.',
  already_holding_assign: 'That interpreter already holds a seat on this booking.',
  schedule_conflict_claim: 'You already have an assignment at that time.',
  schedule_conflict_assign: 'That interpreter already has an assignment at this time.',
  not_qualified: "That interpreter's credentials don't cover this setting.",
  open_call_closed_board: 'The open call for this booking has closed. Assign an interpreter directly.',
  open_call_closed_claim: 'This open call has closed. Contact dispatch.',
  quote_changed: 'The cancellation window just changed. Review the new charge.',
  pending_sync: 'Some lines are still waiting to sync with billing. Try again shortly.',
  billing_unavailable: 'Billing is unreachable. Nothing was closed; try again shortly.',
  total_mismatch: 'Relayline and billing totals differ. Nothing was closed.',
  week_closed: 'This week is already closed.',
  rate_would_reprice: 'That date would reprice billed work. Choose a date on or after the stated date.',
  access_ended: 'Your access to these materials has ended.',
  link_expired: 'That download link has expired. Press Download again.',
  storage_unavailable: 'Prep materials are unavailable right now. Try again shortly.',
  storage_unavailable_upload: 'File storage is unavailable. Try the upload again shortly.',
  payload_too_large: 'Files must be 10,000,000 bytes or smaller.',
  unsupported_type: 'Only PDF, PNG, JPEG, Word (.docx) and PowerPoint (.pptx) files are accepted.',
  network: 'Relayline could not reach the server. Your last action may not have saved; refresh to check.',
  validation: 'Check the highlighted fields.',
  already_team: 'This booking already needs a team of two.',
};

export function invalidTransitionCopy(statusLabel: string): string {
  return `This booking is now ${statusLabel}. The page has been refreshed.`;
}

export const PENDING_COPY = {
  signIn: 'Signing in…',
  submitRequest: 'Submitting request…',
  makeTeam: 'Updating seats…',
  postOpenCall: 'Posting open call…',
  assign: 'Assigning…',
  claim: 'Claiming seat…',
  release: 'Releasing seat…',
  checkIn: 'Checking in…',
  recordCompletion: 'Recording completion…',
  cancel: 'Cancelling…',
  upload: 'Uploading file…',
  download: 'Preparing download…',
  closeWeek: 'Closing week…',
  addRate: 'Saving rate…',
} as const;

export const SUCCESS_COPY = {
  submitted: (ref: string) => `Request ${ref} submitted.`,
  madeTeam: (ref: string) => `${ref} now needs a team of two.`,
  openCall: (ref: string) => `Open call posted for ${ref}.`,
  assign: (name: string, seat: number, ref: string) => `${name} holds seat ${seat} on ${ref}.`,
  claim: (seat: number, ref: string) => `You hold seat ${seat} on ${ref}.`,
  release: (seat: number, ref: string) => `Seat ${seat} on ${ref} is open again.`,
  checkIn: (ref: string) => `${ref} is in progress.`,
  completed: (ref: string, lineRef: string) => `${ref} completed. Invoice line ${lineRef} recorded.`,
  cancelledNoCharge: (ref: string) => `${ref} cancelled.`,
  cancelledWithCharge: (ref: string, cents: number) => `${ref} cancelled. Late charge ${formatCents(cents)} recorded.`,
  upload: (file: string) => `${file} attached.`,
  closeWeek: (date: string, org: string, total: number, billing: number) =>
    `Week of ${date} closed for ${org}. Relayline ${formatCents(total)} matches billing ${formatCents(billing)}.`,
  addRate: (date: string) => `New rate takes effect ${date}.`,
} as const;

export function downloadErrorCopy(code: string): string {
  if (code === 'access_ended') return ERROR_COPY.access_ended;
  if (code === 'link_expired') return ERROR_COPY.link_expired;
  if (code === 'storage_unavailable') return ERROR_COPY.storage_unavailable;
  return ERROR_COPY.network;
}
