export const fieldMessages = {
  emailInvalid: 'Enter a valid email address.',
  emailTaken: 'That email already has an account.',
  passwordShort: 'Use at least 10 characters.',
  passwordEmpty: 'Enter your password.',
  handleShape: 'Use 3 to 24 lowercase letters, digits or hyphens.',
  handleTaken: 'That handle is taken.',
  handleSelf: 'You cannot follow yourself.',
  displayName: 'Enter 1 to 60 characters.',
  title: 'Enter a title of 1 to 80 characters.',
  longText: 'Use at most 2000 characters.',
  body: 'Write a comment of 1 to 2000 characters.',
  q: 'Enter 1 to 100 characters.',
  liftLocalShape: 'Use a date and time like 2027-03-29T09:00.',
  liftLocalFuture: 'Choose a time in the future.',
  expiresAtFuture: 'Choose a time in the future.',
  expiresAtWindow: 'Choose an expiry within the next 30 days.',
  planMissing: 'Choose a plan to upgrade to.',
  planUnknown: 'Unknown plan.',
  planTooSmall: 'Choose a larger plan than the current one.',
  idempotencyKey: 'Send an Idempotency-Key of 1 to 64 characters.',
  limit: 'Use a whole number of 1 or more.',
  cursor: 'Invalid cursor.',
  memberId: 'Unknown member.',
  file: 'Attach one file.',
  frameRate: 'Choose 24, 25 or 30 frames per second.',
  durationMs: 'Enter a duration from 1 to 3600000 milliseconds.',
  credentials: 'Email or password is incorrect.',
} as const;

export function liftLocalGapMessage(timeZone: string): string {
  return `That time does not exist in ${timeZone} on that date.`;
}

export function toPositionMessage(itemCount: number): string {
  return `Choose a position from 1 to ${itemCount}.`;
}

export function frameIndexMessage(lastFrame: number): string {
  return `Choose a frame from 0 to ${lastFrame}.`;
}

/** Form field keys map to the control carrying the matching label. */
export const fieldLabels: Record<string, string> = {
  email: 'Email',
  password: 'Password',
  handle: 'Handle',
  displayName: 'Display name',
  authorName: 'Your name',
  title: 'Title',
  publicDescription: 'Public description',
  internalNote: 'Internal note',
  body: 'Comment',
  q: 'Search references and clusters',
  liftLocal: 'Lift date',
  expiresAt: 'Expires',
  plan: 'Plan',
  frameRate: 'Frame rate',
  file: 'Upload references',
  memberId: 'Email',
  collaboratorEmail: 'Collaborator email',
};
