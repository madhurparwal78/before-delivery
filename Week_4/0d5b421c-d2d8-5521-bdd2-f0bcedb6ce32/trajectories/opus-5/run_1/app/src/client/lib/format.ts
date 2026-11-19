import type { AvailabilitySlot, Booking, TonightRoom } from '../../shared/types';

export const RESTAURANT_TIMEZONE = 'Europe/Lisbon';

export function euros(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function browserZoneDiffers(): boolean {
  return Intl.DateTimeFormat().resolvedOptions().timeZone !== RESTAURANT_TIMEZONE;
}

const localTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const localWeekdayFormatter = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
});

const localDateFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function localTimeOf(startsAt: string): string {
  return localTimeFormatter.format(new Date(startsAt));
}

export function localWeekdayOf(startsAt: string): string {
  return localWeekdayFormatter.format(new Date(startsAt));
}

export function localDateOf(startsAt: string): string {
  return localDateFormatter.format(new Date(startsAt));
}

/** `20:30 (15:30 your time), 64 covers free` and its published variants. */
export function slotOptionName(slot: AvailabilitySlot, date: string): string {
  let label = slot.time;
  if (browserZoneDiffers()) {
    const localDate = localDateOf(slot.starts_at);
    label +=
      localDate === date
        ? ` (${localTimeOf(slot.starts_at)} your time)`
        : ` (${localTimeOf(slot.starts_at)} ${localWeekdayOf(slot.starts_at)} your time)`;
  }
  if (!slot.bookable) return `${label}, too late to book online`;
  let rest = `, ${slot.covers_free} covers free`;
  if (slot.eligible_tables === 0) rest += ', waitlist only';
  return `${label}${rest}`;
}

const lisbonDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: RESTAURANT_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today in Lisbon, read from the server's clock. */
export function lisbonDateNow(instantMs: number): string {
  return lisbonDateFormatter.format(new Date(instantMs));
}

export function partyLabel(partySize: number): string {
  return partySize === 1 ? '1 guest' : `${partySize} guests`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** `Fri 14 Nov` for a Lisbon date, read from the date itself so no device zone is involved. */
export function formatLisbonDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const instant = new Date(Date.UTC(year, month - 1, day));
  const weekday = WEEKDAYS[instant.getUTCDay()] ?? '';
  return `${weekday} ${day} ${MONTHS[month - 1] ?? ''}`;
}

export function bookingSummaryLine(date: string, time: string | null, partySize: number): string {
  const parts = [formatLisbonDate(date)];
  if (time) parts.push(time);
  parts.push(partyLabel(partySize));
  return parts.join(' · ');
}

export function depositLine(booking: Booking): string {
  const amount = euros(booking.deposit.amount_cents);
  switch (booking.deposit.state) {
    case 'paid':
      return `Deposit €${amount} paid`;
    case 'refunded':
      return `Refunded: €${amount}`;
    case 'retained':
      return `Deposit kept: €${amount}`;
    case 'none':
    default:
      return 'No deposit';
  }
}

export function cancelResultAnnouncement(booking: Booking): string {
  const amount = euros(booking.deposit.amount_cents);
  if (booking.deposit.state === 'refunded') {
    return `Booking cancelled. Your €${amount} deposit has been refunded.`;
  }
  if (booking.deposit.state === 'retained') {
    return `Booking cancelled. Your €${amount} deposit has been kept.`;
  }
  return 'Booking cancelled. No deposit was taken.';
}

export function refundPreviewLine(booking: Booking, refunds: boolean): string {
  if (booking.deposit.amount_cents === 0 || booking.deposit.state === 'none') {
    return 'There is no deposit on this booking.';
  }
  const amount = euros(booking.deposit.amount_cents);
  return refunds
    ? `Cancelling now refunds your €${amount} deposit in full.`
    : `Cancelling now keeps your €${amount} deposit.`;
}

export function roomCaption(room: TonightRoom, nextSlot: string | null): string {
  if (nextSlot === null) {
    return `${room.name} · ${room.seats} seats · Online booking for tonight has closed`;
  }
  const nextTwo = room.next_table_for_two ?? 'none';
  return `${room.name} · ${room.seats} seats · ${room.covers_free_at_next_slot ?? 0} covers free at ${nextSlot} · Next table for two tonight: ${nextTwo}`;
}

export function depositParagraph(cents: number): string {
  return `A deposit of €${euros(
    cents,
  )} is charged now: €15 for each guest. It is refunded in full if you cancel at least 24 hours before your table. After that it is kept.`;
}

export const STATUS_WORDS: Record<Booking['status'], string> = {
  booked: 'Booked',
  seated: 'Seated',
  completed: 'Completed',
  no_show: 'No-show',
  cancelled_refunded: 'Cancelled, refunded',
  cancelled_retained: 'Cancelled, deposit kept',
};

export function hostBookingLine(booking: Booking): string {
  return [
    booking.time,
    booking.reference,
    booking.name,
    `Party of ${booking.party_size}`,
    `Table ${booking.table_id}`,
    STATUS_WORDS[booking.status],
    depositLine(booking),
  ].join(' · ');
}

export function countdownText(msRemaining: number): string {
  const total = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export const COPY = {
  planLoading: 'Laying out the room...',
  planFailed: "We couldn't load the floor plan. Refresh to try again.",
  notFound: "We couldn't find that page.",
  holdsPaused: 'Table holds are paused. Please try again in a few minutes.',
  depositsPaused: "Deposits are paused. Bookings that need a deposit can't be confirmed right now.",
  liveUpdatesPaused: 'Live updates are paused. The plan refreshes every 30 seconds.',
  deadManageLink: 'This booking link no longer works.',
  deadOfferLink: 'This offer link no longer works.',
  offerEnded: 'This offer has ended.',
  sessionEnded: 'Your session has ended. Sign in again to continue.',
  signInError: "That email and password don't match.",
  cancelDepositsPaused:
    "We couldn't reach our payments system, so your booking is unchanged. Please try again shortly.",
  paymentFailed: "Your deposit didn't go through, so nothing was booked. Your table is still held.",
  bookedHeading: "You're booked",
  cancelledHeading: 'Booking cancelled',
  offerHeading: 'A table is yours to claim',
  emptyBookings: 'No bookings yet tonight.',
  nameError: 'Enter your name.',
  emailError: 'Enter an email address like name@example.com.',
  phoneError: 'Use 32 characters or fewer.',
  depositError: 'Tick the box to accept the deposit.',
  guestSentence: 'Pick the table, not just the time. We hold it for five minutes while you decide.',
};

export function announceHoldPending(tableId: string): string {
  return `Holding table ${tableId}...`;
}

export function announceHoldGranted(tableId: string): string {
  return `Table ${tableId} is held for you.`;
}

export function announceTableTaken(tableId: string): string {
  return `Table ${tableId} was just taken. Pick another table.`;
}

export const ANNOUNCE_NOT_FOR_PARTY =
  "That table isn't set for your party. Pick an outlined table.";

export const ANNOUNCE_SLOT_CLOSED = "That time can't be booked online any more. Pick another time.";

export function announceHoldEnded(tableId: string): string {
  return `Your hold on table ${tableId} has ended.`;
}

export function announceReleased(tableId: string): string {
  return `Table ${tableId} released.`;
}

export function waitlistJoined(position: number): string {
  return `You're on the waitlist at position ${position}. We'll email you if a table frees up.`;
}
