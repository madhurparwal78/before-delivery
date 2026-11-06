/**
 * The published feedback copy and date formatting — the single place for
 * every string a person sees. Shared by server messages and browser screens.
 */
import { zurichDate, zurichSlotLabel, zurichMomentLabel } from './dates.ts';

export { zurichDate, zurichSlotLabel, zurichMomentLabel };

export function money(total: string): string {
  return `CHF ${total}`;
}

/** `<n> cars found.` per settled search. */
export function carsFound(count: number): string {
  return count === 1 ? `1 car found.` : `${count} cars found.`;
}

export const SERVICE_NOTICES = {
  storage: `Photo storage is unreachable. Photos and condition reports can't be uploaded right now; bays, belongings and care rounds still work.`,
  billing: `Billing is unreachable. Invoices can't be issued or paid right now; bay billing will catch up when it's back.`,
  mail: `Email is unreachable. Owner emails are queued, and releases can't be completed until it's back.`,
} as const;

export const NO_ANSWER_COPY = {
  roundEntry: `No answer from the server. Press Save entry again; it won't be logged twice.`,
  issueInvoice: `No answer from the server. Press Issue invoice again; it won't be issued twice.`,
  requestRelease: `No answer from the server. Press Request release again; it won't be requested twice.`,
  recordTransfer: `No answer from the server. Press Record transfer again; it won't be recorded twice.`,
} as const;

export const IDEMPOTENCY_CONFLICT_COPY = `This was already sent with different values. Close this form and check the latest record.`;
export const SIGN_IN_AGAIN_TEXT = `Your session has ended. Sign in again to carry on.`;
export const SIGN_IN_AGAIN_PENDING = `Signing in...`;
export const SIGN_IN_AGAIN_REFUSED = `Email or password is wrong.`;
export const SIGNED_IN_AGAIN_NOTHING = `Signed in again. Nothing was saved; press again.`;
export const SIGN_IN_WRONG = `Email or password is wrong.`;
export const SIGN_IN_REVOKED = `Your access has been revoked.`;
export const NOT_FOUND_HEADING = `We couldn't find that page`;
export const STORAGE_DOWN_UPLOAD = `Photo storage is unreachable. Nothing was uploaded; try again when the notice clears.`;
export const UPLOAD_CUT_OFF = `The upload was cut off. Nothing was stored; upload it again.`;
export const UPLOAD_TOO_LARGE = `That file is too large to upload.`;
export const SAVING = `Saving...`;
export const UNITS_UPDATED = `Units updated.`;
export const SAVING_UNITS = `Saving units...`;
export const ACCESS_REVOKED_FOR = (name: string) => `Access revoked for ${name}.`;
export const ACCESS_RESTORED_FOR = (name: string) => `Access restored for ${name}.`;
export const RELEASE_CANCELLED = `Release cancelled.`;

export function revokeConfirmText(name: string): string {
  return `${name} will be signed out on every device.`;
}

export function alreadySignedCopy(): string {
  return `A signed condition report is already stored for this stay.`;
}

export function invoiceUnpaidCopy(numbers: string[]): string {
  return `Invoice ${numbers.join(', ')} is unpaid. Record the payment before release.`;
}

export function belongingsCheckedInCopy(labels: string[]): string {
  return `Check out every item first: ${labels.join(', ')}.`;
}

export function mailDownReleaseCopy(): string {
  return `Email is unreachable, so the release was not completed. Nothing has changed.`;
}

export function billingDownInvoiceCopy(): string {
  return `Billing is unreachable. The invoice was not issued; try again when the notice clears.`;
}

export function billingDownTransferCopy(): string {
  return `Billing is unreachable. Nothing was recorded; try again when the notice clears.`;
}

export function estimateChangedCopy(jobNumber: string): string {
  return `Estimate ${jobNumber} was changed by someone else. Your edits are kept; reload to see the latest.`;
}

export function invalidTransitionCopy(): string {
  return `This job has moved on. Reload to see its current state.`;
}

export function stageAlreadyLoggedCopy(stageName: string): string {
  return `${stageName} is already logged for this job.`;
}

export function stageOutOfOrderCopy(stageName: string): string {
  return `${stageName} can't be logged after a later stage.`;
}

export function estimateExpiredApproveCopy(dateIso: string): string {
  return `This estimate expired on ${zurichDate(dateIso)} and can no longer be approved.`;
}

export function estimateExpiredDeclineCopy(dateIso: string): string {
  return `This estimate expired on ${zurichDate(dateIso)} and can no longer be answered.`;
}

export function estimateExpiredAnnouncement(jobNumber: string, dateIso: string): string {
  return `Estimate ${jobNumber} expired on ${zurichDate(dateIso)}.`;
}

export function approvedAnnouncement(ownerName: string, jobNumber: string): string {
  return `${ownerName} approved estimate ${jobNumber}.`;
}

export function declinedAnnouncement(ownerName: string, jobNumber: string): string {
  return `${ownerName} declined estimate ${jobNumber}.`;
}

export function cannotChangeOwnAccessCopy(): string {
  return `You can't change your own access.`;
}

export function carNotStoredRoundCopy(): string {
  return `This car is no longer in a bay.`;
}

export function carReleasedCopy(): string {
  return `This car has been released.`;
}

export function insufficientItemsCopy(label: string): string {
  return `Nothing left to check out for ${label}.`;
}

export function bayOccupiedCopy(code: string): string {
  return `Bay ${code} was just taken. Choose another bay.`;
}

export function bayTooSmallCopy(code: string): string {
  return `Bay ${code} is too small for this car.`;
}

export function bayClassChangeCopy(code: string): string {
  return `Bay ${code} is a different bay class. Moves stay within the same class.`;
}

export function slotTakenCopy(): string {
  return `That slot was just taken. Choose another.`;
}

export function releaseAlreadyOpenCopy(): string {
  return `This car already has an open release.`;
}

export function carInWorkshopCopy(): string {
  return `This car is in the workshop and can't be released yet.`;
}

export function carNotStoredReleaseCopy(): string {
  return `This car is not in a bay.`;
}

export function alreadyPaidCopy(): string {
  return `This invoice is already paid.`;
}

/** Round entry success copy. */
export function roundEntryMessage(carName: string, started: boolean, nextDue: string | null, flagLabels: string[]): string {
  let message: string;
  if (started) {
    message = `Start-up logged for ${carName}. Next start-up due ${nextDue ?? ''}.`;
  } else {
    message = `Round entry saved for ${carName}.`;
  }
  if (flagLabels.length > 0) {
    message = `${message} Flagged: ${flagLabels.join(', ')}.`;
  }
  return message;
}

export function registerCarPending(): string {
  return `Registering car...`;
}

export function registeredCopy(carName: string): string {
  return `${carName} registered.`;
}

export function assigningBay(code: string): string {
  return `Assigning bay ${code}...`;
}

export function assignedBayCopy(carName: string, code: string): string {
  return `${carName} assigned to bay ${code}.`;
}

export function belongingsSavedCopy(label: string, direction: 'in' | 'out', count: number): string {
  return direction === 'in' ? `${label}: ${count} checked in.` : `${label}: ${count} checked out.`;
}

export function uploadingReportPending(): string {
  return `Uploading signed condition report...`;
}

export function reportStoredCopy(carName: string): string {
  return `Signed condition report stored for ${carName}.`;
}

export function uploadingPhotoPending(fileName: string): string {
  return `Uploading ${fileName}...`;
}

export function photoAttachedCopy(carName: string): string {
  return `Photo attached to ${carName}.`;
}

export function estimateSavedCopy(jobNumber: string): string {
  return `Estimate ${jobNumber} saved.`;
}

export function estimateSentCopy(jobNumber: string, ownerName: string): string {
  return `Estimate ${jobNumber} sent to ${ownerName}.`;
}

export function estimateRevisedCopy(jobNumber: string): string {
  return `Estimate ${jobNumber} is a draft again.`;
}

export function stageLoggedCopy(stageName: string, readings: number): string {
  return `${stageName} logged with ${readings} readings.`;
}

export function readingSavedCopy(panelName: string, reading: string): string {
  return `Reading saved: ${panelName} ${reading}.`;
}

export function finishedCopy(jobNumber: string): string {
  return `Job ${jobNumber} marked finished.`;
}

export function issuingInvoicePending(): string {
  return `Issuing invoice...`;
}

export function invoiceIssuedCopy(invoiceNumber: string, total: string): string {
  return `Invoice ${invoiceNumber} issued for CHF ${total}.`;
}

export function approvingPending(): string {
  return `Sending your answer...`;
}

export function approvedCopy(carName: string): string {
  return `Estimate approved. Work on your ${carName} can begin.`;
}

export function declinedCopy(): string {
  return `Estimate declined.`;
}

export function requestingReleasePending(): string {
  return `Requesting release...`;
}

export function releaseRequestedHeading(): string {
  return `We've received your release request`;
}

export function releaseRequestedText(slotLabel: string): string {
  return `We'll confirm ${slotLabel} by email once the concierge books it.`;
}

export function releaseBookedCopy(carName: string, slotLabel: string): string {
  return `Release booked for ${carName}, ${slotLabel}. The owner will be emailed.`;
}

export function releaseStagedCopy(carName: string): string {
  return `${carName} staged for handover.`;
}

export function releaseCompletedCopy(carName: string, bayCode: string): string {
  return `${carName} released. Bay ${bayCode} is free.`;
}

export function recordingTransferPending(): string {
  return `Recording transfer...`;
}

export function transferPaidCopy(invoiceNumber: string): string {
  return `Invoice ${invoiceNumber} is paid.`;
}

export function transferRecordedCopy(amount: string, balance: string): string {
  return `Payment of CHF ${amount} recorded. CHF ${balance} outstanding.`;
}

/** Portal release live announcements. */
export function portalReleaseAnnouncement(status: string, slotLabel: string): string {
  switch (status) {
    case 'booked':
      return `Your release is booked for ${slotLabel}.`;
    case 'staged':
      return `Your car is ready for handover.`;
    case 'released':
      return `Your car has been released.`;
    default:
      return `Release cancelled.`;
  }
}

/** Portal invoice live announcements. */
export function portalInvoiceAnnouncement(
  kind: 'fell' | 'paid' | 'unpaid_again',
  invoiceNumber: string,
  string: string,
): string {
  if (kind === 'paid') return `Invoice ${invoiceNumber} is paid.`;
  if (kind === 'unpaid_again') return `Invoice ${invoiceNumber} is awaiting payment again. CHF ${string} outstanding.`;
  return `Payment received. CHF ${string} outstanding.`;
}

export function bayBillingEndsAnnouncement(carName: string, dateIso: string): string {
  return `Bay billing for ${carName} ends ${zurichDate(dateIso)}.`;
}

/** Stage announcer after every step or panel change. */
export function stageAnnouncement(
  stageName: string,
  position: number,
  count: number,
  panelName: string,
  reading: string | null,
  bandLabel: string | null,
): string {
  const readingPart = reading !== null ? `${panelName}: ${reading}, ${bandLabel}.` : `${panelName}: no reading.`;
  return `${stageName}, stage ${position} of ${count}. ${readingPart}`;
}

/** Status labels shown on screen, never announced. */
export function startupStatusLabel(status: string, nextDue: string | null): string {
  if (status === 'overdue') return `Start-up overdue`;
  if (status === 'not_scheduled') return `No start-up schedule`;
  return `Next start-up due ${nextDue ? zurichDate(nextDue) : ''}`;
}

export function myCarsBayLine(status: string, bayCode: string | null): string {
  if (status === 'stored') return `Bay ${bayCode ?? ''}`;
  if (status === 'awaiting_intake') return `Awaiting intake`;
  return `Released`;
}

export function invoiceStatusLabel(paid: boolean, confirmedAt: string | null): string {
  if (!paid) return `Awaiting payment`;
  return confirmedAt ? `Paid, last confirmed ${zurichDate(confirmedAt)}` : `Paid`;
}

export function outstandingLine(balance: string, confirmedAt: string | null): string {
  return confirmedAt
    ? `Outstanding: CHF ${balance}, last confirmed ${zurichDate(confirmedAt)}`
    : `Outstanding: CHF ${balance}`;
}

export function boardUnpaidLine(total: string, confirmedAt: string | null): string {
  return confirmedAt
    ? `Unpaid: CHF ${total}, last confirmed ${zurichDate(confirmedAt)}`
    : `Unpaid: CHF ${total}`;
}

export function occupancyLine(occupied: number, total: number): string {
  return `${occupied} of ${total} bays occupied`;
}

export function bayBillingLabel(billing: { status: string; charged_through_date: string | null; billing_end_date: string | null }): string {
  if (billing.status === 'ending' && billing.billing_end_date) {
    return `Bay billing ends ${zurichDate(billing.billing_end_date)}`;
  }
  if (billing.status === 'active' && billing.charged_through_date) {
    return `Billed monthly, paid through ${zurichDate(billing.charged_through_date)}`;
  }
  if (billing.status === 'pending') {
    return `Bay billing pending`;
  }
  return ``;
}

export function estimateLabel(status: string, expiresAt: string | null): string {
  switch (status) {
    case 'draft':
      return `Draft`;
    case 'sent':
      return expiresAt ? `Sent, approve by ${zurichDate(expiresAt)}` : `Sent`;
    case 'approved':
      return `Approved`;
    case 'declined':
      return `Declined`;
    case 'expired':
      return `Expired`;
    case 'in_progress':
      return `In progress`;
    case 'finished':
      return `Finished`;
    case 'invoiced':
      return `Invoiced`;
    case 'paid':
      return `Paid`;
    default:
      return ``;
  }
}

export function releaseHeading(status: string): string {
  switch (status) {
    case 'requested':
      return `Release requested`;
    case 'booked':
      return `Your release is booked`;
    case 'staged':
      return `Your car is ready for handover`;
    case 'released':
      return `Released`;
    default:
      return `Release cancelled`;
  }
}

export const RELEASES_ROW_HOLD = `Held: unpaid invoice`;

export function portalHoldLine(numbers: string[]): string {
  return `Your car is held until invoice ${numbers.join(', ')} is paid.`;
}

export function staffAccessLabel(active: boolean, revokedAt: string | null): string {
  return active ? `Active` : `Access revoked ${revokedAt ? zurichDate(revokedAt) : ''}`;
}

export function stagePositionLabel(stageName: string, position: number, count: number): string {
  return `${stageName}, stage ${position} of ${count}`;
}
