import type { ErrorCode } from './api.js';

export const REFUSAL_COPY: Readonly<Record<string, string>> = {
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
  outage: 'Keel Outpost is not reachable right now. Try again in a moment.',
  unavailable: 'Keel Outpost is not reachable right now. Try again in a moment.',
};

export function refusalCopy(code: ErrorCode, extras: { title?: string; reserved?: number } = {}): string {
  if (code === 'time_conflict') return `You already hold a seat in "${extras.title ?? ''}" at that time.`;
  if (code === 'below_reserved') {
    return `Capacity cannot be lower than the ${extras.reserved ?? 0} seats already reserved or held.`;
  }
  return REFUSAL_COPY[code] ?? REFUSAL_COPY['outage'] as string;
}

export const FIELD_COPY = {
  name: 'Enter a name of 1 to 80 characters.',
  email: 'Enter a valid email address.',
  signupPassword: 'Use at least 8 characters.',
  signinPassword: 'Enter your password.',
  guess: 'Enter a whole number from 1 to 100,000,000.',
  capacity: 'Enter a whole number from 1 to 500.',
  bio: 'Use at most 2,000 characters.',
  search: 'Use at most 2,048 characters.',
} as const;

export const EMPTY_COPY = {
  filtered: 'No sessions match these filters.',
  reserved: 'You have not reserved any seats yet.',
  held: 'No seats are being held for you.',
  waitlist: 'You are not on any waitlist.',
  saved: 'Nothing saved yet. Browse the agenda.',
  roster: 'No seats reserved yet.',
  noGuesses: 'No guesses were submitted.',
} as const;

export const PENDING_COPY = {
  reserve: 'Reserving seat…',
  cancel: 'Cancelling…',
  join: 'Joining waitlist…',
  leave: 'Leaving waitlist…',
  claim: 'Claiming seat…',
  release: 'Releasing hold…',
  save: 'Saving…',
  signin: 'Signing in…',
  signup: 'Creating account…',
  signout: 'Signing out…',
  guess: 'Sending guess…',
  showMore: 'Loading more reserved attendees…',
  download: 'Preparing roster…',
  capacity: 'Saving capacity…',
  bio: 'Saving bio…',
  reveal: 'Revealing…',
} as const;

export const SUCCESS_COPY = {
  reserve: 'Seat reserved.',
  cancel: 'Reservation cancelled. Your seat has been released.',
  leave: 'You left the waitlist.',
  claim: 'Seat claimed. It is yours.',
  release: 'Hold released.',
  saved: 'Saved to My Agenda.',
  unsaved: 'Removed from My Agenda.',
  signout: 'You are signed out.',
  guess: 'Guess received. Good luck.',
  download: 'Roster downloaded.',
  capacity: 'Capacity saved.',
  bio: 'Bio saved.',
  reveal: 'Result revealed.',
} as const;

export const NOT_FOUND_COPY = {
  session: 'We could not find that session.',
  page: 'We could not find that page.',
  organiserAgenda: 'My Agenda is for attendees. Use the organiser page instead.',
} as const;

export const FORMAT_OPTIONS: readonly { readonly slug: string; readonly label: string }[] = [
  { slug: 'demo-qa', label: 'Demo + Q&A' },
  { slug: 'fireside', label: 'Fireside' },
  { slug: 'game', label: 'Game' },
  { slug: 'keynote', label: 'Keynote' },
  { slug: 'panel', label: 'Panel' },
  { slug: 'workshop', label: 'Workshop' },
];

export const SPONSORS: readonly string[] = ['LEDGERWEEK', 'Tidewater Labs', 'Quayside', 'Harbor Group', 'Reedwork'];

export const STATEMENT_ROWS: readonly string[] = ['The next', '$5 trillion', 'in transactions', "won't be", 'human.'];

export const FOOTER_COPY =
  'Keel Outpost 2026 · October 31 - November 1 · Harbour Quay Hall, Port Ashby. Questions about the programme: programme@example.com';

export const INTRO_COPY =
  'Join us in Port Ashby for Keel Outpost 2026 at Harbour Quay Hall, with LEDGERWEEK. One vision: money that moves as freely as messages. This is where the global Keel community - founders, builders, developers, investors, traders - gathers to shape what comes next.';

export const STATEMENT_FOLLOW_ON =
  'Agentic finance needs the right rails. Instant settlement. Autonomous payments. Private transactions.';

export const RECORD_COPY = {
  headline: "Live at Keel Outpost, we're going after our own record.",
  body: 'On July 4th we pushed the network to 6M+ transactions per second through a live experiment. On day one of Keel Outpost we run it again, live, on the main stage.',
  title: 'Call the number',
  description: 'Submit one guess. Closest to the final figure takes first place.',
  prizes: ['1st Place 10,000 credits', '2nd Place 5,000 credits', '3rd Place 1,000 credits'],
  closed: 'Guessing has closed. The result is coming soon.',
} as const;
