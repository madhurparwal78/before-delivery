// The brief's Feedback states copy, in one place.

export const OUTAGE_COPY = 'Keel Outpost is not reachable right now. Try again in a moment.';

const REFUSALS: Record<string, string> = {
  session_full: 'This session is full. Join the waitlist to be next in line.',
  already_reserved: 'You already have a seat in this session.',
  not_reservable: 'This session does not take reservations. Just turn up.',
  no_reservation: 'You do not hold a seat in this session.',
  already_waitlisted: 'You are already on the waitlist for this session.',
  seats_available: 'Seats are open. Reserve a seat instead.',
  not_waitlisted: 'You are not on the waitlist for this session.',
  no_hold: 'No seat is being held for you in this session.',
  hold_expired: 'Your hold on this seat has ended.',
  request_in_progress: 'Your earlier request is still being handled.',
  idempotency_key_reused: 'That request could not be repeated. Press the button again.',
  already_guessed: 'You have already submitted your guess.',
  contest_closed: 'Guessing has closed.',
  already_revealed: 'The result has already been revealed.',
  email_taken: 'An account with this email already exists.',
  invalid_credentials: 'Email or password is incorrect.',
  rate_limited: 'Too many sign-in attempts. Try again in a few minutes.',
  unauthenticated: 'Sign in to continue.',
  forbidden: 'This page is for the organiser only.',
};

export function refusalCopy(code: string): string {
  return REFUSALS[code] ?? OUTAGE_COPY;
}

export function conflictCopy(title: string): string {
  return `You already hold a seat in "${title}" at that time.`;
}

export function belowReservedCopy(reserved: number): string {
  return `Capacity cannot be lower than the ${reserved} seats already reserved or held.`;
}

export const FIELD_COPY = {
  name: 'Enter a name of 1 to 80 characters.',
  email: 'Enter a valid email address.',
  password: 'Use at least 8 characters.',
  signinPassword: 'Enter your password.',
  wholeGuess: 'Enter a whole number from 1 to 100,000,000.',
  capacity: 'Enter a whole number from 1 to 500.',
  bio: 'Use at most 2,000 characters.',
  search: 'Use at most 2,048 characters.',
} as const;

export const FORBIDDEN_COPY = REFUSALS.forbidden ?? '';
