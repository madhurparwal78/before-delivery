// The visible copy for every feedback state, exactly as specified.
import type { ApiFailure } from './api.js';
import type { RequestView, GateResult, Quote } from './types.js';

export function gateSummary(ref: string, seatPosition: number, gates: GateResult[]): string {
  const [c, v, s, k] = gates;
  const st = (g: GateResult | undefined) => (g ? (g.pass ? 'pass' : 'fail') : 'unchecked');
  return `${ref} seat ${seatPosition}: Credential ${st(c)}, Valid on date ${st(v)}, Schedule ${st(s)}, Consumer ${st(k)}.`;
}

export const copy = {
  signIn: {
    pending: 'Signing in…',
    error: (f: ApiFailure | null) => 'That email and passcode do not match.',
  },
  dryRun: {
    pending: (ref: string, seat: number) => `Checking gates for ${ref} seat ${seat}…`,
    success: gateSummary,
    failure: (ref: string) => `Could not check gates for ${ref}. Nothing was offered.`,
    seatTaken: (name: string) => `Seat taken by ${name}.`,
  },
  pin: {
    pending: (ref: string, seat: number, name: string) => `Offering ${ref} seat ${seat} to ${name}…`,
    success: (ref: string, seat: number, name: string) => `Offered ${ref} seat ${seat} to ${name}.`,
    gateFailed: (reason: string) => `Not offered. ${reason}`,
    seatTaken: (name: string) => `Seat taken by ${name}.`,
    windowClosed: 'Too late to send an offer for this seat.',
  },
  saveDraft: {
    pending: 'Saving…',
    success: (ref: string) => `Draft ${ref} saved.`,
    validation: 'Check the highlighted fields.',
  },
  submit: {
    pending: 'Submitting…',
    success: (ref: string) => `${ref} submitted to dispatch.`,
    validation: 'Check the highlighted fields.',
    invalidTransition: 'This request can no longer be submitted.',
  },
  upload: {
    pending: (filename: string) => `Uploading ${filename}…`,
    success: (filename: string) => `${filename} attached.`,
    tooLarge: (filename: string) => `${filename} is too large.`,
    unsupported: (filename: string) => `${filename} is not a supported file type.`,
    storage: 'File storage is unreachable. Nothing was uploaded.',
  },
  quote: {
    pending: 'Working out the charge…',
    late: (fee: string, seated: number) => `Late cancellation. $${fee} will be charged for ${seated} seated interpreter(s).`,
    onTime: 'On-time cancellation. No charge.',
    started: 'This assignment has started and can no longer be cancelled.',
  },
  cancel: {
    pending: (ref: string) => `Cancelling ${ref}…`,
    success: (ref: string, fee: string) => `${ref} cancelled. Charge: $${fee}.`,
    feeChanged: (fee: string) => `The charge is now $${fee}. Review it and confirm again.`,
    billing: 'Billing is unreachable. The request is not cancelled. Try again in a few minutes.',
  },
  accept: {
    pending: 'Sending your answer…',
    success: (ref: string) => `Accepted. ${ref} is on your schedule.`,
    closed: (status: string) => `This offer is no longer open (${status}).`,
  },
  decline: {
    pending: 'Sending your answer…',
    success: 'Declined. The seat goes back to dispatch.',
    closed: (status: string) => `This offer is no longer open (${status}).`,
  },
  timesheet: {
    pending: 'Submitting timesheet…',
    success: (ref: string, hours: string) => `Timesheet for ${ref} submitted: ${hours} billed hours.`,
    notEnded: 'You can submit after the assignment ends.',
    validation: 'Check the highlighted fields.',
  },
  approve: {
    pending: 'Approving…',
    success: (ref: string, name: string, amount: string) => `Approved ${ref} for ${name}: $${amount}.`,
    billing: 'Billing is unreachable. The timesheet is not approved. Try again in a few minutes.',
    storage: 'File storage is unreachable. The timesheet is not approved.',
  },
  rates: {
    pending: 'Saving rates…',
    success: 'Rates saved. They apply to approvals and cancellations from now on.',
    validation: 'Check the highlighted fields.',
  },
  invoices: {
    pending: 'Loading invoices…',
    success: (count: number, total: string) => `${count} invoice(s), total $${total}.`,
    billing: 'Billing is unreachable, so invoices cannot be shown right now.',
  },
  credential: {
    pending: 'Saving credential…',
    success: (type: string, date: string) => `${type} saved, valid through ${date}.`,
    validation: 'Check the highlighted fields.',
    storage: 'File storage is unreachable. Nothing was saved.',
  },
  preferences: {
    pending: 'Saving preferences…',
    success: 'Preferences saved.',
    validation: 'An interpreter cannot be both preferred and blocked.',
  },
  status: {
    mailDown: 'Mail is unreachable. Emails are queued and send automatically when it returns.',
    billingDown: 'Billing is unreachable. Approvals, charged cancellations and invoices are paused.',
  },
  offerClosedText: (status: string) => `This offer is no longer open (${status}).`,
};

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: 'Draft', submitted: 'Submitted', partially_staffed: 'Partially staffed',
    staffed: 'Staffed', completed: 'Completed', invoiced: 'Invoiced',
    cancelled_on_time: 'Cancelled on time', cancelled_late: 'Cancelled late',
    open: 'Open', offered: 'Offered', accepted: 'Accepted',
    active: 'Active', declined: 'Declined', expired: 'Expired', withdrawn: 'Withdrawn',
  };
  return map[status] ?? status;
}

export function quoteLateText(quote: Quote): string {
  return quote.late
    ? `Late cancellation. $${quote.fee} will be charged for ${quote.seated} seated interpreter(s).`
    : 'On-time cancellation. No charge.';
}

export function seatsText(request: RequestView): string {
  return `${request.seats_claimed}/${request.seats_total}`;
}
