import { formatDateLabel, formatDuration, formatMoney, isoDate, isoTime } from '../shared/format';
import { spanHint } from '../shared/copy';
import type {
  Booking,
  BookingEmailStatus,
  BookingStatus,
  ClearanceReason,
  CoverState,
  DocumentKind,
  DocumentNotice,
  DoorEntry,
  DoorLogEntry,
  MovementKind,
  NoticePoint,
  PackReceiptEmailStatus,
  SuspendedReason,
  TenantStatus,
} from '../shared/types';

export const DOT = '\u00b7';
export const DASH = '\u2013';
export const EM_DASH = '\u2014';
export const ELLIPSIS = '\u2026';

export const generic = "Couldn't reach the kitchen. Nothing changed; try again.";
export const missingRecord = "That record isn't available.";
export const sessionEnded = 'Your session ended. Sign in again.';
export const floorReloadFailed = "Floor plan couldn't refresh. Showing the last known stack.";

export { spanHint };

export function stationLabel(freeMinutes: number, spanMinutes: number): string {
  if (freeMinutes <= 0) return 'full';
  return `${formatDuration(freeMinutes)} free of ${formatDuration(spanMinutes)}`;
}

export const justTaken = 'just taken';

export function shelvesFreeLine(free: number, total: number): string {
  return `Cooler: ${free} of ${total} shelves free all span`;
}

export function ticketStatus(
  booking: Booking,
  secondsLeft: number,
  confirmPending: boolean,
): string {
  if (confirmPending) return `Confirming${ELLIPSIS}`;
  if (booking.status === 'held') {
    if (secondsLeft <= 0) return 'Hold expired';
    return `Held ${DOT} ${secondsLeft} s left`;
  }
  if (booking.status === 'cancelled') {
    return booking.cancelReason === 'hold_expired' ? 'Hold expired' : 'Cancelled';
  }
  if (booking.status === 'confirmed') return 'Confirmed';
  if (booking.status === 'checked_in') return 'Checked in';
  if (booking.status === 'completed') return 'Completed';
  return 'No-show';
}

export function cancellationLine(booking: Booking): string {
  if ((booking.cancelCreditMinutes ?? 0) > 0) {
    return `Free cancellation until ${formatDateLabel(isoDate(booking.cutoffAt))} ${isoTime(booking.cutoffAt)}`;
  }
  return `Past cutoff ${EM_DASH} cancelling returns no hours`;
}

export function cancelStepDescription(booking: Booking): string | null {
  if (booking.status !== 'confirmed') return null;
  const minutes = booking.cancelCreditMinutes ?? 0;
  if (minutes > 0) return `You'll get ${formatDuration(minutes)} back.`;
  return 'No hours will be returned.';
}

export function doorStatusText(status: BookingStatus): string {
  switch (status) {
    case 'held':
      return 'Held';
    case 'confirmed':
      return 'Booked';
    case 'checked_in':
      return 'Checked in';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    case 'no_show':
      return 'No-show';
  }
}

export function clearanceReasonText(reason: ClearanceReason): string {
  switch (reason) {
    case 'insurance_lapsed':
      return 'certificate of insurance lapsed';
    case 'food_handler_lapsed':
      return 'food-handler card lapsed';
    case 'not_approved':
      return 'not approved yet';
  }
}

export function clearanceText(entry: DoorEntry): string {
  if (entry.cleared) return 'Cleared';
  return `Not cleared ${EM_DASH} ${clearanceReasonText(entry.reason ?? 'not_approved')}`;
}

export function checkInOpensLine(checkInOpensAt: string): string {
  return `Check-in opens ${isoTime(checkInOpensAt)}`;
}

export function doorLogLine(entry: DoorLogEntry): string {
  const time = isoTime(entry.at);
  if (entry.action === 'check_in') return `In ${time} ${DOT} ${entry.by}`;
  if (entry.action === 'check_out') return `Out ${time} ${DOT} ${entry.by} ${DOT} cleaned`;
  return `No-show ${time} ${DOT} ${entry.by}`;
}

export function doorSummary(date: string, count: number, cleared: number): string {
  const bookings = count === 1 ? '1 booking' : `${count} bookings`;
  return `Door list for ${formatDateLabel(date)}: ${bookings}, ${cleared} cleared.`;
}

export function doorChange(entry: DoorEntry): string {
  return (
    `${entry.tenantName} ${entry.stationName} ${isoTime(entry.start)}${DASH}${isoTime(entry.end)}: ` +
    `${doorStatusText(entry.status)}.`
  );
}

export function noticeLine(notice: DocumentNotice): string {
  const label = notice.point === 'seven_days' ? '7-day notice' : 'Expires-today notice';
  if (notice.status === 'sent' && notice.sentAt !== null) {
    return `${label}: Sent ${formatDateLabel(isoDate(notice.sentAt))} ${isoTime(notice.sentAt)}`;
  }
  return `${label}: Queued`;
}

export function documentTypeLabel(kind: DocumentKind): string {
  return kind === 'insurance_certificate' ? 'Certificate of insurance' : 'Food-handler card';
}

export function noticeAnnouncement(kind: DocumentKind, point: NoticePoint): string {
  const label = point === 'seven_days' ? '7-day notice' : 'Expires-today notice';
  return `Notice sent: ${documentTypeLabel(kind)}, ${label}.`;
}

export function coverLabel(coverState: CoverState, daysLeft: number | null): string {
  switch (coverState) {
    case 'ok':
      return 'Valid';
    case 'expires_soon':
      return daysLeft === 1 ? 'Expires in 1 day' : `Expires in ${daysLeft ?? 0} days`;
    case 'expires_today':
      return 'Expires today';
    case 'lapsed':
      return 'Lapsed';
    case 'superseded':
      return 'Superseded';
  }
}

export function fingerprintText(sha256: string | null): string {
  return sha256 === null ? '\u2014' : sha256.slice(0, 12);
}

export function receiptEmailLine(email: BookingEmailStatus): string {
  const label = email.kind === 'booking_confirmed' ? 'Confirmation email' : 'Move email';
  if (email.status === 'sent' && email.sentAt !== null) {
    return `${label}: Sent ${formatDateLabel(isoDate(email.sentAt))} ${isoTime(email.sentAt)}`;
  }
  return `${label}: Queued`;
}

export function receiptEmailAnnouncement(kind: BookingEmailStatus['kind']): string {
  return kind === 'booking_confirmed' ? 'Confirmation email sent.' : 'Move email sent.';
}

export function packReceiptLine(receipt: PackReceiptEmailStatus): string {
  if (receipt.status === 'sent' && receipt.sentAt !== null) {
    return `Receipt email: Sent ${formatDateLabel(isoDate(receipt.sentAt))} ${isoTime(receipt.sentAt)}`;
  }
  return 'Receipt email: Queued';
}

export function buyResume(hours: number): string {
  return (
    `Your last purchase didn't finish. Press Buy ${hours}-hour pack again to finish it; ` +
    `you won't be charged twice.`
  );
}

export function suspendedReasonText(reason: SuspendedReason | null): string {
  return reason === 'food_handler_lapsed'
    ? 'food-handler card lapsed'
    : 'certificate of insurance lapsed';
}

export function tenantStatusLabel(status: TenantStatus, reason: SuspendedReason | null): string {
  switch (status) {
    case 'applied':
      return `Applied ${EM_DASH} upload your documents`;
    case 'documents_pending':
      return 'Waiting for review';
    case 'approved':
      return 'Approved';
    case 'suspended':
      return `Suspended ${EM_DASH} ${suspendedReasonText(reason)}`;
  }
}

export function statusChange(label: string): string {
  return `Status changed: ${label}.`;
}

export function ledgerLabel(movement: MovementKind): string {
  switch (movement) {
    case 'purchase':
      return 'Purchase';
    case 'booking_debit':
      return 'Booking';
    case 'cancellation_credit':
      return 'Cancellation credit';
    case 'move_adjustment':
      return 'Move';
    case 'refund':
      return 'Refund';
  }
}

export const slabLifted = 'Slab lifted. Arrow keys pick a station, Enter claims, Escape puts it back.';

export function moveLifted(stationName: string, start: string, end: string): string {
  return `Moving ${stationName} ${start}${DASH}${end}. Arrow keys pick a station, Enter moves, Escape puts it back.`;
}

export function dropTargetMove(stationName: string, label: string): string {
  return `${stationName}: ${label}`;
}

export const slabReturned = 'Slab returned. Nothing claimed.';

export function applyCount(count: number): string {
  return count === 1 ? '1 field needs attention.' : `${count} fields need attention.`;
}

export function reportSuccess(date: string, minutes: number): string {
  return `Daily usage for ${formatDateLabel(date)}: Total booked ${formatDuration(minutes)}.`;
}

export function reportUpdate(date: string, minutes: number): string {
  return `Daily usage for ${formatDateLabel(date)} updated: Total booked ${formatDuration(minutes)}.`;
}

export const reportPending = `Loading report${ELLIPSIS}`;

export function stationsName(stationName: string, shelfName: string | null): string {
  return shelfName === null ? stationName : `${stationName} and ${shelfName}`;
}

export const signin = {
  pending: `Signing in${ELLIPSIS}`,
  wrong: "That email and password don't match an account.",
  limit: 'Too many sign-in attempts for that email. Try again in a few minutes.',
};

export const passwordDialog = {
  prompt: 'Confirm your password to continue.',
  pending: `Checking password${ELLIPSIS}`,
  wrong: "That password doesn't match your account.",
  limit: signin.limit,
};

export const apply = {
  pending: `Sending application${ELLIPSIS}`,
  success: 'Application received. Upload your certificate of insurance and food-handler card next.',
};

export const claim = {
  pending: (stations: string): string => `Claiming ${stations}${ELLIPSIS}`,
  success: (stations: string, start: string, end: string, seconds: number): string =>
    `Held ${stations} ${start}${DASH}${end}. Confirm within ${seconds} seconds.`,
  taken: (stations: string): string => `Just taken. Someone else claimed ${stations} for that span.`,
  notApproved: (statusLabel: string): string => `Your account can't book yet: ${statusLabel}.`,
  documents: (date: string): string =>
    `Your documents don't cover ${formatDateLabel(date)}. Upload a renewal to book that day.`,
  hours: (minutes: number): string =>
    `No single pack has ${formatDuration(minutes)} available. Buy a pack or release a hold to book this span.`,
  rateLimited: (seconds: number): string =>
    `Too many claims in the last minute. Try again in ${seconds} seconds.`,
  network: "Couldn't reach the kitchen. Nothing was booked; try again.",
};

export const confirmBooking = {
  pending: `Confirming${ELLIPSIS}`,
  success: (stations: string, date: string, start: string, end: string, minutes: number): string =>
    `Booked ${stations} ${formatDateLabel(date)} ${start}${DASH}${end}. ` +
    `${formatDuration(minutes)} debited; confirmation email on its way.`,
  expired: (stationName: string): string => `Your hold ran out and ${stationName} was released.`,
  other: 'This booking can no longer be confirmed.',
};

export const moveBooking = {
  pending: (stations: string): string => `Moving ${stations}${ELLIPSIS}`,
  success: (stations: string, date: string, start: string, end: string, change: number): string => {
    const tail =
      change === 0
        ? 'No hours changed.'
        : change > 0
          ? `${formatDuration(change)} debited.`
          : `${formatDuration(-change)} returned to your pack.`;
    return `Moved to ${stations} ${formatDateLabel(date)} ${start}${DASH}${end}. ${tail}`;
  },
  blocked: 'This booking can no longer be moved.',
  hours: (minutes: number): string =>
    `This booking's pack doesn't have ${formatDuration(minutes)} more available, so it can't move to that span.`,
};

export const cancelBooking = {
  pending: `Cancelling${ELLIPSIS}`,
  hold: 'Hold released.',
  refunded: (minutes: number): string => `Cancelled. ${formatDuration(minutes)} returned to your pack.`,
  late: 'Cancelled. It was past the cutoff, so no hours were returned.',
  blocked: 'This booking can no longer be cancelled.',
};

export const buyPack = {
  pending: `Recording payment${ELLIPSIS}`,
  success: (hours: number, email: string): string =>
    `Pack added: ${hours} hours. Receipt on its way to ${email}.`,
  inProgress:
    "Your earlier press is still being recorded. Press the same button again in a moment; you won't be charged twice.",
  dialogClosed: (hours: number): string =>
    `Purchase not sent. Confirm your password to buy a ${hours}-hour pack.`,
  network:
    "Couldn't reach the kitchen. Press the same button again to finish this purchase; you won't be charged twice.",
  billingDown: 'Billing is unreachable. You were not charged and no hours were added.',
  pendingPayment:
    "Payment taken, but your hours aren't on file yet. Press the same button again to finish; you won't be charged again.",
  retryTag: 'Retry purchase',
};

export const upload = {
  pending: `Uploading${ELLIPSIS}`,
  success: (kind: DocumentKind, date: string): string =>
    `Uploaded. ${documentTypeLabel(kind)} on file through ${formatDateLabel(date)}.`,
  restored: "Your upload wasn't sent. Check it and press Upload.",
  storageDown: 'Document storage is unreachable. Nothing was saved; try again shortly.',
  previewDown: 'Previews are unavailable while document storage is unreachable.',
};

export const approveTenant = {
  pending: `Approving${ELLIPSIS}`,
  success: (business: string): string => `${business} approved.`,
  lapsed: (business: string): string => `${business} has a lapsed document and can't be approved.`,
};

export const checkIn = {
  pending: `Checking in${ELLIPSIS}`,
  success: (business: string, stationName: string): string =>
    `${business} checked in at ${stationName}.`,
  notCleared: (reason: ClearanceReason): string =>
    `Not cleared for the floor: ${clearanceReasonText(reason)}.`,
  window: 'Too early or too late to check in this booking.',
  other: "This booking can't be checked in now.",
};

export const checkOut = {
  pending: `Checking out${ELLIPSIS}`,
  success: 'Checked out. Cleanup logged.',
  cleanupBox: 'Confirm the station was cleaned and sanitised.',
  other: "This booking can't be checked out now.",
};

export const noShow = {
  pending: `Marking no-show${ELLIPSIS}`,
  success: 'Marked no-show.',
  tooEarly: "The booking hasn't started yet.",
  other: "This booking can't be marked no-show now.",
};

export const refundPack = {
  pending: `Refunding${ELLIPSIS}`,
  success: (cents: number, business: string): string =>
    `Refunded $${formatMoney(cents)} to ${business}.`,
  inUse: "This pack has a booking or hold on it, so it can't be refunded.",
  empty: 'This pack has no hours left to refund.',
  already: 'This pack has already been refunded.',
  amountChanged: (cents: number): string =>
    `The refundable amount changed to $${formatMoney(cents)}. Check it and press Refund again.`,
  dialogClosed: 'Refund not sent. Confirm your password to refund this pack.',
  billingDown: 'Billing is unreachable. No refund was issued.',
};

export function balanceParts(
  balance: number,
  purchased: number,
  held: number,
): { base: string; hold: string } {
  return {
    base: `${formatDuration(balance)} left of ${formatDuration(purchased)}`,
    hold: held > 0 ? ` ${DOT} ${formatDuration(held)} on hold` : '',
  };
}

export function packHeading(hours: number, packNumber: number): string {
  return `${hours}-hour pack #${packNumber}`;
}

export function ledgerTableName(hours: number, packNumber: number, purchasedAt: string): string {
  return `Ledger ${hours}-hour pack #${packNumber} ${formatDateLabel(isoDate(purchasedAt))}`;
}

export function totalBookedLine(minutes: number): string {
  return `Total booked ${formatDuration(minutes)}`;
}
