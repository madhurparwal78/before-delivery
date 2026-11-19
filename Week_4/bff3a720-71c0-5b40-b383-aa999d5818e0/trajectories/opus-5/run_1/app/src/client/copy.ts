import { money } from '../shared/format.js';

export function seats(count: number): string {
  return count === 1 ? '1 seat' : `${count} seats`;
}

export function rides(count: number): string {
  return count === 1 ? '1 ride' : `${count} rides`;
}

export function passengers(count: number): string {
  return count === 1 ? '1 passenger' : `${count} passengers`;
}

export function stars(count: number): string {
  return count === 1 ? '1 star' : `${count} stars`;
}

export function ratings(count: number): string {
  return count === 1 ? '1 rating' : `${count} ratings`;
}

export function hours(count: number): string {
  return count === 1 ? '1 hour' : `${count} hours`;
}

/** `<h> h <m> min`, or `<m> min` under an hour, from the server's expires_in_seconds. */
export function timeLeft(secondsLeft: number): string {
  const total = Math.max(0, Math.floor(secondsLeft / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export function averageLine(average: number | null, count: number): string {
  if (average === null || count === 0) return 'No ratings yet';
  return `${average.toFixed(1)} from ${ratings(count)}`;
}

export const copy = {
  ridesFound: (count: number) => `${rides(count)} found`,
  noRides: 'No rides match. Try another date.',
  seatBooked: (from: string, to: string, date: string, priceCents: number) =>
    `Seat booked: ${from} to ${to}, ${date}. ${money(priceCents)} paid from your wallet.`,
  waitingForDriver: (name: string, time: string, date: string, secondsLeft: number) =>
    `Waiting for ${name} to answer. This request expires at ${time} on ${date} (${timeLeft(
      secondsLeft,
    )} left).`,
  requestAccepted: (name: string) => `Request accepted by ${name}.`,
  requestDeclined: (name: string, priceCents: number) =>
    `Request declined by ${name}. ${money(priceCents)} is back in your wallet.`,
  requestWithdrawn: (priceCents: number) =>
    `Request withdrawn. ${money(priceCents)} is back in your wallet.`,
  requestExpiredHeading: 'This request expired',
  requestExpiredBody: (priceCents: number) =>
    `${money(priceCents)} is back in your wallet.`,
  driverSeatBooked: (name: string, from: string, to: string, left: number) =>
    `Seat booked by ${name}: ${from} to ${to}. ${seats(left)} left.`,
  driverNewRequest: (name: string, from: string, to: string) =>
    `New request from ${name}: ${from} to ${to}.`,
  driverCancellation: (name: string, from: string, to: string, keptCents: number) =>
    `${name} cancelled: ${from} to ${to}. You keep ${money(keptCents)}.`,
  departureSaved: (count: number) => `Departure saved and ${passengers(count)} emailed.`,
  emailsQueued: 'Saved. Emails to passengers are queued and will be sent when mail is back.',
  seatsSaved: 'Seats saved.',
  rideCancelled: 'Ride cancelled. Every passenger has been refunded.',
  noticeLine: (name: string, kind: string, time: string | null) =>
    time ? `${name}: ${kind} sent at ${time}` : `${name}: ${kind} queued`,
  timeChangeFree: (oldTime: string, newTime: string, until: string, date: string) =>
    `Departure moved from ${oldTime} to ${newTime}. You can cancel for free until ${until} on ${date}.`,
  timeChange: (oldTime: string, newTime: string) =>
    `Departure moved from ${oldTime} to ${newTime}.`,
  rideCancelledForPassenger: (name: string, priceCents: number) =>
    `${name} cancelled this ride. ${money(priceCents)} is back in your wallet.`,
  quoteTier: (
    refundCents: number,
    paidCents: number,
    percent: number,
    hoursBefore: number,
  ) =>
    `Cancelling now refunds ${money(refundCents)} of ${money(paidCents)} (${percent}%, ${hours(
      hoursBefore,
    )} before departure).`,
  quoteFree: (paidCents: number) =>
    `Cancelling now refunds ${money(paidCents)} of ${money(
      paidCents,
    )} (100%, free after the driver's time change).`,
  newMessage: (name: string) => `New message from ${name}`,
  presenceOnline: (name: string) => `${name} is online`,
  presenceSeen: (name: string, time: string) => `${name} was online at ${time}`,
  presenceNever: (name: string) => `${name} has not opened this thread yet`,
  ratingNotOpen: 'You can rate this trip once it arrives.',
  ratingWaiting: 'Waiting for both ratings',
  ratingRevealBoth: (mine: number, name: string, theirs: number) =>
    `Ratings revealed: you gave ${stars(mine)}, ${name} gave you ${stars(theirs)}.`,
  ratingRevealMine: (mine: number, name: string) =>
    `Ratings revealed: you gave ${stars(mine)}. ${name} did not rate.`,
  ratingRevealTheirs: (name: string, theirs: number) =>
    `Ratings revealed: ${name} gave you ${stars(theirs)}. You did not rate.`,
  ratingClosedEmpty: 'The rating window closed without ratings.',
  codeSent: (email: string) => `Your code is on its way to ${email}.`,
  photoSaved: 'Profile photo saved.',
  idReceived: 'ID document received. It is waiting for review.',
  idStatus: (state: string) => `ID status: ${idStatusWords(state)}`,
  idVerifiedLive: 'Your ID is verified.',
  idRejectedLive: (reason: string) => `Please upload your ID again: ${reason}.`,
  founderVerified: (name: string) => `${name} is verified.`,
  founderAskedAgain: (name: string) => `${name} was asked to upload again.`,
  walletAdded: (amountCents: number) => `${money(amountCents)} added to your wallet.`,
  emptyUpcoming: 'No upcoming trips.',
  emptyPast: 'No past trips yet.',
  emptyWallet: 'No wallet movements yet.',
  emptyEarnings: 'No bookings on rides in this month.',
  emptyReview: 'No documents are waiting for review.',
  notFoundHeading: 'We could not find that page',
  livePaused: 'Live updates paused. Reconnecting.',
};

export function idStatusWords(state: string): string {
  switch (state) {
    case 'pending':
      return 'waiting for review';
    case 'verified':
      return 'verified';
    case 'rejected':
      return 'please upload again';
    default:
      return 'not uploaded';
  }
}

export function noticeKindWords(kind: string): string {
  return kind === 'time_change' ? 'time change' : 'cancellation';
}
