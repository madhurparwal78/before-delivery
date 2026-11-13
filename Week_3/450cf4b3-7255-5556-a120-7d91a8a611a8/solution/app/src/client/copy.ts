// Every user-facing sentence from the brief's Feedback states, in one place.

import type { Booking, BookingEmail, BookingStatus, ClearanceReason, CoverState, DocumentNotice, DocumentKind, DoorEntry, DoorLogEntry, EmailStatus, Lapse, Me, Movement, SpanStatus, TenantStatus } from "../shared/api.js";
import { dateLabel } from "../shared/clock.js";
import { dollars, duration, LAPSE_TEXT, SPAN_HINT_TEXT } from "../shared/format.js";
import { dayOf, hhmm } from "./kitchen.js";

export const GENERIC = "Couldn't reach the kitchen. Nothing changed; try again.";
export const SESSION_ENDED = "Your session ended. Sign in again.";
export const MISSING_RECORD = "That record isn't available.";
export const FLOOR_STALE = "Floor plan couldn't refresh. Showing the last known stack.";

export function spanHint(spanMinutes: number, minimum: number, status: SpanStatus | null): string | null {
  if (spanMinutes < minimum) return SPAN_HINT_TEXT.length;
  return status === "started" || status === "beyond_horizon" ? SPAN_HINT_TEXT[status] : null;
}

export function statusLabel(status: TenantStatus, reason: Lapse | null): string {
  switch (status) {
    case "applied":
      return "Applied — upload your documents";
    case "documents_pending":
      return "Waiting for review";
    case "approved":
      return "Approved";
    case "suspended":
      return `Suspended — ${LAPSE_TEXT[reason ?? "insurance_lapsed"]}`;
  }
}

export function meStatusLabel(me: Me): string {
  return me.tenant ? statusLabel(me.tenant.status, me.tenant.suspendedReason) : "";
}

export function clearanceText(cleared: boolean, reason: ClearanceReason | null): string {
  return cleared || reason === null ? "Cleared" : `Not cleared — ${LAPSE_TEXT[reason]}`;
}

const LATER_STATUS: Record<Exclude<BookingStatus, "held" | "cancelled">, string> = {
  confirmed: "Confirmed", checked_in: "Checked in", completed: "Completed", no_show: "No-show",
};

/** The ticket card's status text; a confirm in flight reads "Confirming…" even at countdown zero. */
export function ticketStatus(b: Booking, secondsLeft: number, confirming = false): string {
  if (b.status === "held") return confirming ? "Confirming…" : secondsLeft > 0 ? `Held · ${secondsLeft} s left` : "Hold expired";
  if (b.status === "cancelled") return b.cancelReason === "hold_expired" ? "Hold expired" : "Cancelled";
  return LATER_STATUS[b.status];
}

/** "Free cancellation until <date> <HH:MM>" or the past-cutoff line, from the booking's cancelCreditMinutes. */
export function cancellationLine(b: Booking): string {
  return (b.cancelCreditMinutes ?? 0) > 0
    ? `Free cancellation until ${dateLabel(dayOf(b.cutoffAt))} ${hhmm(b.cutoffAt)}`
    : "Past cutoff — cancelling returns no hours";
}

export function cancelStepDescription(b: Booking): string {
  return (b.cancelCreditMinutes ?? 0) > 0 ? `You'll get ${duration(b.cancelCreditMinutes ?? 0)} back.` : "No hours will be returned.";
}

export function doorStatus(status: BookingStatus): string {
  return status === "held" ? "Held" : status === "cancelled" ? "Cancelled" : status === "confirmed" ? "Booked" : LATER_STATUS[status];
}

const NOTICE_NAME = { seven_days: "7-day notice", today: "Expires-today notice" } as const;

export const DOCUMENT_LABEL: Readonly<Record<DocumentKind, string>> = {
  insurance_certificate: "Certificate of insurance",
  food_handler_card: "Food-handler card",
};

function sentOn(at: string): string {
  return `${dateLabel(dayOf(at))} ${hhmm(at)}`;
}

/** One notice line on tenant detail and Documents. */
export function noticeLine(n: DocumentNotice): string {
  return n.status === "queued" ? `${NOTICE_NAME[n.point]}: Queued` : `${NOTICE_NAME[n.point]}: Sent ${sentOn(n.sentAt)}`;
}

export const noticeAnnouncement = (kind: DocumentKind, n: DocumentNotice): string =>
  `Notice sent: ${DOCUMENT_LABEL[kind]}, ${NOTICE_NAME[n.point]}.`;

export function coverLabel(state: CoverState, daysLeft: number | null): string {
  switch (state) {
    case "ok": return "Valid";
    case "expires_soon": return daysLeft === 1 ? "Expires in 1 day" : `Expires in ${daysLeft ?? 0} days`;
    case "expires_today": return "Expires today";
    case "lapsed": return "Lapsed";
    case "superseded": return "Superseded";
  }
}

/** Fingerprint text: the first 12 characters of the SHA-256, or a dash for a document with no file. */
export const fingerprintText = (sha256: string | null): string => (sha256 === null ? "—" : sha256.slice(0, 12));

const EMAIL_NAME = { booking_confirmed: "Confirmation email", booking_moved: "Move email" } as const;

/** A receipt or booking email line: "Confirmation email: Queued" / "Move email: Sent <date> <HH:MM>". */
export function bookingEmailLine(e: BookingEmail): string {
  return e.status === "queued" ? `${EMAIL_NAME[e.kind]}: Queued` : `${EMAIL_NAME[e.kind]}: Sent ${sentOn(e.sentAt)}`;
}

export const bookingEmailAnnouncement = (kind: BookingEmail["kind"]): string =>
  kind === "booking_confirmed" ? "Confirmation email sent." : "Move email sent.";

export function packReceiptLine(e: EmailStatus): string {
  return e.status === "queued" ? "Receipt email: Queued" : `Receipt email: Sent ${sentOn(e.sentAt)}`;
}

/** `<stations>`: the station, or "<station> and <shelf>" for a paired booking. */
export function stationsText(station: string, shelf: string | null): string {
  return shelf ? `${station} and ${shelf}` : station;
}

export function spanText(b: { start: string; end: string }): string {
  return `${hhmm(b.start)}–${hhmm(b.end)}`;
}

export function bookingDate(b: { start: string }): string {
  return dateLabel(dayOf(b.start));
}

export const claimCopy = {
  pending: (stations: string) => `Claiming ${stations}…`,
  held: (stations: string, span: string, seconds: number) => `Held ${stations} ${span}. Confirm within ${seconds} seconds.`,
  taken: (stations: string) => `Just taken. Someone else claimed ${stations} for that span.`,
  notApproved: (label: string) => `Your account can't book yet: ${label}.`,
  documents: (date: string) => `Your documents don't cover ${date}. Upload a renewal to book that day.`,
  hours: (minutes: number) => `No single pack has ${duration(minutes)} available. Buy a pack or release a hold to book this span.`,
  limit: (seconds: number) => `Too many claims in the last minute. Try again in ${seconds} seconds.`,
  network: "Couldn't reach the kitchen. Nothing was booked; try again.",
};

export const confirmCopy = {
  pending: "Confirming…",
  done: (b: Booking) => `Booked ${stationsText(b.stationName, b.shelfName)} ${bookingDate(b)} ${spanText(b)}. ${duration(b.debitedMinutes ?? 0)} debited; confirmation email on its way.`,
  expired: (station: string) => `Your hold ran out and ${station} was released.`,
  other: "This booking can no longer be confirmed.",
};

export const moveCopy = {
  pending: (stations: string) => `Moving ${stations}…`,
  done: (b: Booking, minutesChange: number) => {
    const change = minutesChange === 0 ? "No hours changed." : minutesChange > 0 ? `${duration(minutesChange)} debited.` : `${duration(-minutesChange)} returned to your pack.`;
    return `Moved to ${stationsText(b.stationName, b.shelfName)} ${bookingDate(b)} ${spanText(b)}. ${change}`;
  },
  refused: "This booking can no longer be moved.",
  hours: (more: number) => `This booking's pack doesn't have ${duration(more)} more available, so it can't move to that span.`,
};

export const SLAB = {
  lift: "Slab lifted. Arrow keys pick a station, Enter claims, Escape puts it back.",
  moveLift: (station: string, span: string) => `Moving ${station} ${span}. Arrow keys pick a station, Enter moves, Escape puts it back.`,
  target: (station: string, label: string) => `${station}: ${label}`,
  returned: "Slab returned. Nothing claimed.",
};

export const buyCopy = {
  pending: "Recording payment…",
  done: (hours: number, email: string) => `Pack added: ${hours} hours. Receipt on its way to ${email}.`,
  inProgress: "Your earlier press is still being recorded. Press the same button again in a moment; you won't be charged twice.",
  network: "Couldn't reach the kitchen. Press the same button again to finish this purchase; you won't be charged twice.",
  billingDown: "Billing is unreachable. You were not charged and no hours were added.",
  pendingPayment: "Payment taken, but your hours aren't on file yet. Press the same button again to finish; you won't be charged again.",
  dialogClosed: (hours: number) => `Purchase not sent. Confirm your password to buy a ${hours}-hour pack.`,
  resume: (hours: number) => `Your last purchase didn't finish. Press Buy ${hours}-hour pack again to finish it; you won't be charged twice.`,
};

export const RETRY_TAG = "Retry purchase";

export const refundCopy = {
  pending: "Refunding…",
  done: (cents: number, business: string) => `Refunded $${dollars(cents)} to ${business}.`,
  inUse: "This pack has a booking or hold on it, so it can't be refunded.",
  empty: "This pack has no hours left to refund.",
  already: "This pack has already been refunded.",
  changed: (cents: number) => `The refundable amount changed to $${dollars(cents)}. Check it and press Refund again.`,
  dialogClosed: "Refund not sent. Confirm your password to refund this pack.",
  billingDown: "Billing is unreachable. No refund was issued.",
};

export const passwordCopy = {
  prompt: "Confirm your password to continue.",
  pending: "Checking password…",
  wrong: "That password doesn't match your account.",
  limit: "Too many sign-in attempts for that email. Try again in a few minutes.",
};

export const signInCopy = {
  pending: "Signing in…",
  wrong: "That email and password don't match an account.",
  limit: passwordCopy.limit,
};

export const applyCopy = {
  pending: "Sending application…",
  taken: "An account already uses that email.",
  received: "Application received. Upload your certificate of insurance and food-handler card next.",
  count: (n: number) => (n === 1 ? "1 field needs attention." : `${n} fields need attention.`),
};

export const uploadCopy = {
  pending: "Uploading…",
  done: (kind: DocumentKind, expiresOn: string) => `Uploaded. ${DOCUMENT_LABEL[kind]} on file through ${dateLabel(expiresOn)}.`,
  restored: "Your upload wasn't sent. Check it and press Upload.",
  storageDown: "Document storage is unreachable. Nothing was saved; try again shortly.",
  previewsDown: "Previews are unavailable while document storage is unreachable.",
};

export const approveCopy = {
  pending: "Approving…",
  done: (business: string) => `${business} approved.`,
  lapsed: (business: string) => `${business} has a lapsed document and can't be approved.`,
};

export const statusChanged = (label: string): string => `Status changed: ${label}.`;

export const cancelCopy = {
  pending: "Cancelling…",
  done: (b: Booking) => {
    if (b.refundedMinutes === null) return "Hold released.";
    return b.refundedMinutes > 0
      ? `Cancelled. ${duration(b.refundedMinutes)} returned to your pack.`
      : "Cancelled. It was past the cutoff, so no hours were returned.";
  },
  refused: "This booking can no longer be cancelled.",
};

export const MOVEMENT_LABEL: Readonly<Record<Movement, string>> = {
  purchase: "Purchase", booking_debit: "Booking", cancellation_credit: "Cancellation credit", move_adjustment: "Move", refund: "Refund",
};

/** One door-log line, with the entry's kitchen-local time. */
export function doorLogLine(entry: DoorLogEntry): string {
  if (entry.action === "check_in") return `In ${hhmm(entry.at)} · ${entry.by}`;
  if (entry.action === "check_out") return `Out ${hhmm(entry.at)} · ${entry.by} · cleaned`;
  return `No-show ${hhmm(entry.at)} · ${entry.by}`;
}

export const doorCopy = {
  checkInPending: "Checking in…",
  checkedIn: (business: string, station: string) => `${business} checked in at ${station}.`,
  notCleared: (reason: ClearanceReason) => `Not cleared for the floor: ${LAPSE_TEXT[reason]}.`,
  window: "Too early or too late to check in this booking.",
  checkInOther: "This booking can't be checked in now.",
  checkOutPending: "Checking out…",
  checkedOut: "Checked out. Cleanup logged.",
  cleanupRequired: "Confirm the station was cleaned and sanitised.",
  checkOutOther: "This booking can't be checked out now.",
  noShowPending: "Marking no-show…",
  noShow: "Marked no-show.",
  tooEarly: "The booking hasn't started yet.",
  noShowOther: "This booking can't be marked no-show now.",
  opens: (at: string) => `Check-in opens ${hhmm(at)}`,
  summary: (date: string, entries: readonly DoorEntry[]) => {
    const cleared = entries.filter((e) => e.cleared).length;
    return `Door list for ${dateLabel(date)}: ${entries.length === 1 ? "1 booking" : `${entries.length} bookings`}, ${cleared} cleared.`;
  },
  change: (e: Pick<DoorEntry, "tenantName" | "stationName" | "start" | "end" | "status">) =>
    `${e.tenantName} ${e.stationName} ${hhmm(e.start)}–${hhmm(e.end)}: ${doorStatus(e.status)}.`,
};

export const reportCopy = {
  pending: "Loading report…",
  done: (date: string, minutes: number) => `Daily usage for ${dateLabel(date)}: Total booked ${duration(minutes)}.`,
  updated: (date: string, minutes: number) => `Daily usage for ${dateLabel(date)} updated: Total booked ${duration(minutes)}.`,
};

/** The shelves-free line under the hour rail. */
export const coolerLine = (free: number, total: number): string => `Cooler: ${free} of ${total} shelves free all span`;
