import { ApiError } from '../errors';

export const AUTHOR_LABEL = 'Anonymous bench member';

const REVIEW_PATH = /\/companies\/[a-z0-9-]+\/reviews\/[0-9a-fA-F-]+/g;
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/;
/** At least seven digits, optionally led by +, with single spaces, dashes or dots between digits. */
const PHONE_IN_TEXT = /\+?\d(?:[ .-]?\d){6,}/;

function withoutReviewPaths(text: string): string {
  return text.replace(REVIEW_PATH, ' ');
}

function containsEmailAddress(text: string): boolean {
  return EMAIL_IN_TEXT.test(withoutReviewPaths(text));
}

/** A comma is not a separator, so grouped figures such as `₹6,40,000` never match. */
function containsPhoneNumber(text: string): boolean {
  return PHONE_IN_TEXT.test(withoutReviewPaths(text));
}

/**
 * Posted text must carry no contact details. Fields are checked in the order
 * given, with the email check across all of them before the phone check.
 */
export function assertNoContactDetails(fields: ReadonlyArray<[field: string, text: string]>): void {
  for (const [field, text] of fields) {
    if (containsEmailAddress(text)) throw new ApiError('contains_email', { field });
  }
  for (const [field, text] of fields) {
    if (containsPhoneNumber(text)) throw new ApiError('contains_phone', { field });
  }
}

/** `2026-03`, the only date detail a post carries. */
export function postedMonth(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

const LOCKED_EXCERPT_LENGTH = 140;

export function excerpt(text: string): string {
  return [...text].slice(0, LOCKED_EXCERPT_LENGTH).join('');
}

export function cutForLockedViewer(text: string, unlocked: boolean): { text: string; truncated: boolean } {
  if (unlocked || [...text].length <= LOCKED_EXCERPT_LENGTH) return { text, truncated: false };
  return { text: excerpt(text), truncated: true };
}
