import { isCalendarDate } from './zone';

/** The one definition of the legacy feedback CSV's shape, skip reasons and matching. */

export const LEGACY_HEADER = ['contact_email', 'contact_name', 'company_name', 'feedback', 'received_on'];

export const MAX_IMPORT_ROWS = 2000;

const PERSONAL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
]);

export function headerMatches(fields: readonly string[]): boolean {
  if (fields.length !== LEGACY_HEADER.length) return false;
  return fields.every((field, index) => field.trim().toLowerCase() === LEGACY_HEADER[index]);
}

export interface LegacyRow {
  line: number;
  email: string;
  contactName: string;
  companyName: string;
  feedback: string;
  receivedOn: string;
}

export function readLegacyRow(line: number, fields: readonly string[]): LegacyRow {
  return {
    line,
    email: fields[0] ?? '',
    contactName: fields[1] ?? '',
    companyName: fields[2] ?? '',
    feedback: fields[3] ?? '',
    receivedOn: fields[4] ?? '',
  };
}

export type SkipReason = 'missing_email' | 'invalid_email' | 'missing_feedback' | 'invalid_date' | 'duplicate';

/** The skip reasons that depend only on the row itself, in their published order. */
export function rowSkipReason(row: LegacyRow): SkipReason | null {
  const email = row.email.trim();
  if (email === '') return 'missing_email';
  if (!isValidImportEmail(email)) return 'invalid_email';
  if (row.feedback.trim() === '') return 'missing_feedback';
  const receivedOn = row.receivedOn.trim();
  if (receivedOn !== '' && !isCalendarDate(receivedOn)) return 'invalid_date';
  return null;
}

function isValidImportEmail(value: string): boolean {
  const parts = value.split('@');
  if (parts.length !== 2) return false;
  return parts[1].includes('.');
}

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function emailDomain(email: string): string {
  const domain = email.slice(email.indexOf('@') + 1);
  return domain.replace(/^www\./u, '');
}

export function isPersonalDomain(domain: string): boolean {
  return PERSONAL_DOMAINS.has(domain);
}

export function fallbackContactName(email: string): string {
  return email.slice(0, email.indexOf('@'));
}

/** Duplicate detection compares feedback with inner whitespace collapsed. */
export function duplicateKey(feedback: string, receivedOn: string): string {
  const collapsed = feedback.trim().replace(/\s+/gu, ' ');
  return `${receivedOn.trim()}\u0000${collapsed}`;
}

export function importNoteTitle(feedback: string): string {
  const text = feedback.trim();
  return text.length > 60 ? `${text.slice(0, 60)}\u2026` : text;
}
