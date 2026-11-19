import { createHash, randomBytes } from 'node:crypto';

export const NAME_MESSAGE = 'Enter your full name.';
export const EMAIL_MESSAGE = 'Enter a valid email address.';
export const CONSENT_MESSAGE = 'Please confirm your consent to apply.';
export const RESUME_MESSAGE = 'Attach a PDF résumé of at most 5,000,000 bytes.';

const RESUME_MAX_BYTES = 5_000_000;
const NAME_MAX_POINTS = 120;
const EMAIL_MAX_LENGTH = 254;
const CONTROL_OR_SEPARATOR = /[\u0000-\u001F\u007F\u2028\u2029]/;
const EMAIL_FORBIDDEN = /[\r\n,;\s"'<>\u0000-\u001F\u007F]/;
const REFERENCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function codePoints(value: string): number {
  return [...value].length;
}

export function validCandidateName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed === '' || codePoints(trimmed) > NAME_MAX_POINTS) return false;
  return !CONTROL_OR_SEPARATOR.test(trimmed);
}

export function validCandidateEmail(email: string): boolean {
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > EMAIL_MAX_LENGTH) return false;
  if (EMAIL_FORBIDDEN.test(trimmed)) return false;
  const parts = trimmed.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  if (local.length === 0) return false;
  if (!domain.includes('.')) return false;
  const labels = domain.split('.');
  return labels.every((label) => label.length > 0);
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validResume(bytes: Buffer): boolean {
  if (bytes.length < 1 || bytes.length > RESUME_MAX_BYTES) return false;
  return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
}

export function newReference(): string {
  const raw = randomBytes(8);
  let reference = '';
  for (const byte of raw) {
    reference += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  }
  return `AR-${reference}`;
}

export function newResumeKey(requisitionId: string): string {
  return `resumes/${requisitionId}/${randomBytes(16).toString('hex')}.pdf`;
}

export function newTrackingToken(): string {
  return randomBytes(32).toString('base64url');
}

export function tokenDigest(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
