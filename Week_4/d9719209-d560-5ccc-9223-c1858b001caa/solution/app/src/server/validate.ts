import { validation } from './errors.js';

export type Fields = Record<string, string>;

export const COPY = {
  email: 'Enter a valid email address',
  emailTaken: 'That email is already registered',
  username: 'Usernames are 3 to 20 letters, digits, underscores or hyphens',
  usernameTaken: 'That username is taken',
  password: 'Passwords are 10 to 128 characters',
  title: 'Titles are 1 to 300 characters',
  body: 'Bodies are at most 40,000 characters',
  alt: 'Alt text is at most 300 characters',
  comment: 'Comments are 1 to 10,000 characters',
  communityName: 'Names are 3 to 21 letters, digits or underscores',
  communityTaken: 'That name is taken',
  communityReserved: 'That name is reserved',
  communityTitle: 'Titles are 1 to 100 characters',
  communityDescription: 'Descriptions are at most 500 characters',
  communityType: 'Choose Public or Restricted',
  rules: 'Rules need a title of 1 to 100 characters, a description of at most 500, and at most 15 rules',
  reasonMissing: 'Choose a reason',
  reasonOther: 'Add a public note for Other',
  publicNote: 'Public notes are at most 300 characters',
  privateNote: 'Private notes are at most 1,000 characters',
  rule: 'Choose one of this community\'s rules',
  duration: 'Choose how long to lock the thread',
  version: 'Send the post version you saw',
  reportType: 'Choose a type',
  reportExplanation: 'Explain why this is illegal',
  reportConfirm: 'Confirm the statement to send',
  suspensionReason: 'Add a reason for the suspension',
  titleEdit: 'Titles can\'t be edited',
  idempotencyMissing: 'Idempotency-Key header is required',
  idempotencyReused: 'This key was already used for a different request',
  idempotencyFormat: 'Idempotency-Key must be 1 to 100 visible ASCII characters',
  sort: 'This sort is not valid',
  depth: 'Depth is a whole number from 1 to 8',
  value: 'Vote value must be 1, 0 or -1',
  token: 'This link has expired or was already used',
  totp: 'Enter the 6-digit code from your authenticator app',
  totpMismatch: 'That code didn\'t match',
} as const;

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

export function failIfAny(fields: Fields): void {
  if (Object.keys(fields).length > 0) throw validation(fields);
}

export const normaliseEmail = (raw: string): string => raw.trim();

export function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(email);
}

export const isValidUsername = (username: string): boolean => /^[A-Za-z0-9_-]{3,20}$/.test(username);

export const isValidPassword = (password: string): boolean => password.length >= 10 && password.length <= 128;

export const isValidCommunityName = (name: string): boolean => /^[A-Za-z0-9_]{3,21}$/.test(name);

export function isWithin(text: string, min: number, max: number): boolean {
  return text.length >= min && text.length <= max;
}

export function parseId(raw: string): string | null {
  return /^\d{1,18}$/.test(raw) ? raw : null;
}
