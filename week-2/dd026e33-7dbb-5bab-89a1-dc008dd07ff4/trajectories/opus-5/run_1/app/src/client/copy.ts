import { BAND_LABEL, type Band } from '../shared/coatstack';
import { dateLabel, instantDateLabel, momentLabel, slotLabel } from '../shared/zurich';
import type { CareFlag, Invoice, ReleaseStatus } from '../shared/types';
import { CARE_FLAG_LABEL } from '../shared/types';

/** The Zurich calendar date of a timestamp, as a label. */
export function timestampDateLabel(timestamp: string): string {
  return instantDateLabel(new Date(timestamp));
}

export const SERVICE_NOTICE = {
  storage:
    "Photo storage is unreachable. Photos and condition reports can't be uploaded right now; bays, belongings and care rounds still work.",
  billing:
    "Billing is unreachable. Invoices can't be issued or paid right now; bay billing will catch up when it's back.",
  mail: "Email is unreachable. Owner emails are queued, and releases can't be completed until it's back.",
} as const;

export const NOT_FOUND_HEADING = "We couldn't find that page";

export const SIGN_IN_AGAIN = {
  text: 'Your session has ended. Sign in again to carry on.',
  pending: 'Signing in...',
  refused: 'Email or password is wrong.',
  notResent: 'Signed in again. Nothing was saved; press again.',
} as const;

export const NO_ANSWER = {
  roundEntry: "No answer from the server. Press Save entry again; it won't be logged twice.",
  issueInvoice: "No answer from the server. Press Issue invoice again; it won't be issued twice.",
  requestRelease: "No answer from the server. Press Request release again; it won't be requested twice.",
  recordTransfer: "No answer from the server. Press Record transfer again; it won't be recorded twice.",
} as const;

export const IDEMPOTENCY_CONFLICT =
  'This was already sent with different values. Close this form and check the latest record.';

export const SIGN_IN = {
  pending: 'Signing in...',
  wrong: 'Email or password is wrong.',
  revoked: 'Your access has been revoked.',
} as const;

export const STORAGE_DOWN_UPLOAD =
  'Photo storage is unreachable. Nothing was uploaded; try again when the notice clears.';
export const UPLOAD_CUT_OFF = 'The upload was cut off. Nothing was stored; upload it again.';
export const UPLOAD_TOO_LARGE = 'That file is too large to upload.';

export const MOVED_ON = 'This job has moved on. Reload to see its current state.';

export function searchAnnouncement(count: number): string {
  return count === 1 ? '1 car found.' : `${count} cars found.`;
}

export function revokeConfirmation(name: string): string {
  return `${name} will be signed out on every device.`;
}

export function startupLabel(startup: {
  status: string;
  next_due: string | null;
}): string | null {
  if (startup.status === 'not_scheduled') return 'No start-up schedule';
  if (startup.status === 'overdue') return 'Start-up overdue';
  if (startup.next_due === null) return null;
  return `Next start-up due ${dateLabel(startup.next_due)}`;
}

export function bayBillingLabel(billing: {
  status: string;
  charged_through_date: string | null;
  billing_end_date: string | null;
}): string | null {
  if (billing.billing_end_date !== null) {
    return `Bay billing ends ${dateLabel(billing.billing_end_date)}`;
  }
  if (billing.status === 'pending') return 'Bay billing pending';
  if (billing.status === 'active' && billing.charged_through_date !== null) {
    return `Billed monthly, paid through ${dateLabel(billing.charged_through_date)}`;
  }
  if (billing.status === 'none') return null;
  return 'Bay billing pending';
}

export function cardBayLine(car: {
  status: string;
  bay: { code: string } | null;
}): string {
  if (car.status === 'released') return 'Released';
  if (car.bay !== null) return `Bay ${car.bay.code}`;
  return 'Awaiting intake';
}

export function invoiceStatusLabel(invoice: Invoice): string {
  if (invoice.status === 'paid') {
    return invoice.balance_live
      ? 'Paid'
      : `Paid, last confirmed ${timestampDateLabel(invoice.status_confirmed_at)}`;
  }
  return 'Awaiting payment';
}

export function outstandingLine(invoice: Invoice): string {
  const base = `Outstanding: CHF ${invoice.balance}`;
  return invoice.balance_live
    ? base
    : `${base}, last confirmed ${timestampDateLabel(invoice.status_confirmed_at)}`;
}

export function unpaidLine(total: string, live: boolean, confirmedDate: string | null): string {
  const base = `Unpaid: CHF ${total}`;
  return live || confirmedDate === null
    ? base
    : `${base}, last confirmed ${timestampDateLabel(confirmedDate)}`;
}

export function occupancyLine(occupied: number, total: number): string {
  return `${occupied} of ${total} bays occupied`;
}

export function estimateLabel(
  status: string,
  expiresAt: string | null,
): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'sent':
      return expiresAt === null
        ? 'Sent'
        : `Sent, approve by ${timestampDateLabel(expiresAt)}`;
    case 'approved':
      return 'Approved';
    case 'declined':
      return 'Declined';
    case 'expired':
      return 'Expired';
    case 'in_progress':
      return 'In progress';
    case 'finished':
      return 'Finished';
    case 'invoiced':
      return 'Invoiced';
    default:
      return 'Paid';
  }
}

export const RELEASE_HEADING: Record<ReleaseStatus, string> = {
  requested: 'Release requested',
  booked: 'Your release is booked',
  staged: 'Your car is ready for handover',
  released: 'Released',
  cancelled: 'Release cancelled',
};

export function releaseAnnouncement(status: ReleaseStatus, slot: string): string | null {
  switch (status) {
    case 'booked':
      return `Your release is booked for ${slotLabel(slot)}.`;
    case 'staged':
      return 'Your car is ready for handover.';
    case 'released':
      return 'Your car has been released.';
    case 'cancelled':
      return 'Release cancelled.';
    default:
      return null;
  }
}

export function holdLine(invoiceNumbers: string[]): string {
  return `Your car is held until invoice ${invoiceNumbers.join(', ')} is paid.`;
}

export const HOLD_ROW_LABEL = 'Held: unpaid invoice';

export function flagsSuffix(flags: CareFlag[]): string {
  if (flags.length === 0) return '';
  return ` Flagged: ${flags.map((flag) => CARE_FLAG_LABEL[flag]).join(', ')}.`;
}

export function stageAnnouncement(input: {
  stageName: string;
  position: number;
  count: number;
  panelName: string;
  reading: string | null;
  band: Band | null;
}): string {
  const head = `${input.stageName}, stage ${input.position} of ${input.count}.`;
  if (input.reading === null || input.band === null) {
    return `${head} ${input.panelName}: no reading.`;
  }
  return `${head} ${input.panelName}: ${input.reading}, ${BAND_LABEL[input.band]}.`;
}

export function staffAccessLabel(member: { active: boolean; revoked_at: string | null }): string {
  if (member.active) return 'Active';
  return member.revoked_at === null
    ? 'Access revoked'
    : `Access revoked ${timestampDateLabel(member.revoked_at)}`;
}

export { dateLabel, momentLabel, slotLabel };
