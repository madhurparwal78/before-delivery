export const MESSAGES = {
  applicantName: 'Tell us your name in 1 to 80 characters.',
  email: 'Use an email address like name@example.com.',
  homeTz: 'Choose a time zone from the list.',
  bedtime: 'Choose a bedtime between 20:00 and 23:59.',
  entryId: 'Use the entry id created on this device.',
  title: 'Keep the title to 120 characters or fewer.',
  textEmpty: 'Write at least one word.',
  textTooLong: 'Keep the dream text to 20,000 characters or fewer.',
  dreamsRecalled: 'Use a whole number from 0 to 20.',
  technique: 'Choose none, mild or ssild.',
  techniqueMinutes: 'Use a whole number of minutes from 0 to 180.',
  techniqueLocked: 'Technique practice unlocks on night 8.',
  boolean: 'Use true or false.',
  cohortName: 'Name the cohort in 1 to 80 characters.',
  startsOn: 'Use a date like 2026-11-02.',
  priceCents: 'Use a price from $1.00 to $1,000.00.',
  seats: 'Use 1 to 50 seats.',
  signRange: 'Select between 1 and 200 characters of this entry.',
  signCategory: 'Choose inner awareness, action, form or context.',
  checkId: 'Use the check id created on this device.',
  memoDuration: 'Send the recording length in milliseconds.',
  memoEmpty: 'The recording is empty.',
  memoSignature: "The recording doesn't match its audio type.",
} as const;

const FORBIDDEN_CHARACTERS = /[\p{Cc}\u2028\u2029]/u;

export function codePointLength(value: string): number {
  return [...value].length;
}

export function hasNonSpace(value: string): boolean {
  return /\S/u.test(value);
}

export function isCleanName(value: string): boolean {
  if (FORBIDDEN_CHARACTERS.test(value)) return false;
  const length = codePointLength(value);
  return length >= 1 && length <= 80 && hasNonSpace(value);
}

export function isEmailAddress(value: string): boolean {
  if (FORBIDDEN_CHARACTERS.test(value)) return false;
  if (codePointLength(value) > 254) return false;
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/u.test(value);
}

export function isBedtime(value: string): boolean {
  return /^(2[0-3]):[0-5]\d$/.test(value);
}

export type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: Record<string, string> };
