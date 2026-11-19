/**
 * Error codes and messages. Every API error is built here (single place).
 * Messages are printf-style: %s placeholders are substituted at build time.
 */
import type { ErrorCode } from '../domain.js';

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  unauthenticated: 'Sign in to continue',
  invalid_credentials: 'Email or password is incorrect',
  session_ended: 'This join link is no longer active',
  payment_required: 'Your workspace is read-only until the overdue payment is settled',
  plan_limit: "Your %s plan allows %s %s",
  forbidden: "You don't have permission to do that",
  cross_origin: 'Cross-origin requests are not accepted',
  not_found: 'Not found',
  illegal_transition: "The workshop can't move from %s to %s",
  phase_locked: "That isn't available while the workshop is %s",
  deadline_passed: "Time is up for this round",
  workshop_closed: 'This workshop has ended',
  workshop_not_open: "This workshop hasn't opened yet",
  room_full: 'This room is full',
  budget_exhausted: 'You have no dots left',
  no_dot_to_return: 'You have no dot on that cluster',
  op_conflict: 'That operation id was already used for a different change',
  no_join_link: 'Create a join link first',
  not_closed: "The workshop isn't closed yet",
  recap_not_ready: "The recap files aren't stored yet",
  plan_unchanged: "You're already on that plan",
  nothing_due: "There's nothing to pay",
  link_revoked: 'This join link has been turned off',
  link_expired: 'This join link has expired',
  too_large: 'That request is too large',
  unsupported_media_type: "That content type isn't accepted",
  validation: 'Check the highlighted fields',
  rate_limited: 'Too many requests — try again shortly',
  quota_exceeded: "You've reached today's invite limit",
  storage_unavailable: 'File storage is unavailable',
  billing_unavailable: 'Billing is unavailable',
};

export interface FieldMessages {
  unknownKey: string;
  clientOpId: string;
  workshopTitleLength: string;
  workshopTitleControl: string;
  template: string;
  datetimeMalformed: string;
  datetimeGap: (zone: string) => string;
  endNotAfterStart: string;
  sponsorEmail: string;
  fee: string;
  emailsEntry: string;
  emailsCount: string;
  imageDimensions: string;
  imageId: string;
  q: string;
  cursor: string;
  termFreeAnnual: string;
  fallback: string;
}

/** Field messages, decided once (DP-71 and the field table). */
export const FIELD_MESSAGES: FieldMessages = {
  unknownKey: "This field can't be set",
  clientOpId: 'Send an operation id of 8 to 64 letters, digits, - or _',
  workshopTitleLength: 'Enter a title of 1 to 120 characters',
  workshopTitleControl: "Titles can't contain line breaks or control characters",
  template: 'Choose a template',
  datetimeMalformed: 'Enter a date and time as YYYY-MM-DDTHH:MM',
  datetimeGap: (zone: string) => `That time doesn't exist in ${zone} because the clocks go forward`,
  endNotAfterStart: 'The end must be after the start',
  sponsorEmail: 'Enter an email address',
  fee: 'Enter an amount in euros with up to two decimals',
  emailsEntry: 'Every entry must be an email address',
  emailsCount: 'Send between 1 and 30 addresses at a time',
  imageDimensions: 'Images must be at most 8,000 pixels on each side',
  imageId: 'Upload the image again',
  q: 'Type between 1 and 100 characters',
  cursor: "That cursor isn't valid",
  termFreeAnnual: 'Free has no annual term',
  fallback: 'Check this value',
};
