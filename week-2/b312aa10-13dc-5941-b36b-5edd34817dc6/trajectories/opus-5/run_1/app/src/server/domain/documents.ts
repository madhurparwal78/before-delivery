/**
 * Which document is current, its expiry status, the notice ladder and the
 * booking and check-in document rules.
 */
import { addDays, daysBetween } from '../../shared/calendar.js';
import type { DocumentStatus, DocumentType } from '../../shared/format.js';
import { localToInstant } from './time.js';
import type { DocumentRow } from './types.js';

/** A document expires at 24:00 kitchen time at the end of its expiry date. */
export function expiryEndInstant(zone: string, expiryDate: string): number {
  const end = localToInstant(zone, addDays(expiryDate, 1), '00:00');
  return end ?? localToInstant(zone, expiryDate, '23:45')!;
}

export function expiryStatus(document: DocumentRow, today: string): DocumentStatus {
  if (document.status !== 'approved') return document.status;
  const remaining = daysBetween(today, document.expiryDate);
  if (remaining < 0) return 'expired';
  if (remaining <= 14) return 'expiring';
  return 'approved';
}

/** The approved document of that type with the latest expiry date. */
export function currentDocument(
  documents: DocumentRow[],
  type: DocumentType,
): DocumentRow | null {
  const approved = documents.filter(
    (document) => document.type === type && document.status === 'approved',
  );
  let found: DocumentRow | null = null;
  for (const document of approved) {
    if (
      !found ||
      document.expiryDate > found.expiryDate ||
      (document.expiryDate === found.expiryDate && Number(document.seq) > Number(found.seq))
    ) {
      found = document;
    }
  }
  return found;
}

export function isCurrent(documents: DocumentRow[], document: DocumentRow): boolean {
  return currentDocument(documents, document.type)?.id === document.id;
}

export type DocumentRefusal =
  | { reason: 'missing'; type: DocumentType }
  | { reason: 'expires_first'; type: DocumentType; date: string }
  | { reason: 'check_in_missing'; type: DocumentType }
  | { reason: 'check_in_expired'; type: DocumentType; date: string };

/** A hold or confirm needs an approved current document covering the block. */
export function bookingDocumentRefusal(
  documents: DocumentRow[],
  required: DocumentType[],
  zone: string,
  blockEndMs: number,
): DocumentRefusal | null {
  for (const type of required) {
    const current = currentDocument(documents, type);
    if (!current) return { reason: 'missing', type };
    if (blockEndMs > expiryEndInstant(zone, current.expiryDate)) {
      return { reason: 'expires_first', type, date: current.expiryDate };
    }
  }
  return null;
}

/** Check-in needs a current unexpired document of every type required then. */
export function checkInDocumentRefusal(
  documents: DocumentRow[],
  required: DocumentType[],
  zone: string,
  nowMs: number,
): DocumentRefusal | null {
  for (const type of required) {
    const current = currentDocument(documents, type);
    if (!current) return { reason: 'check_in_missing', type };
    if (nowMs > expiryEndInstant(zone, current.expiryDate)) {
      return { reason: 'check_in_expired', type, date: current.expiryDate };
    }
  }
  return null;
}

export type NoticeKind = '14' | '3';

/** The notice a current document is due, if any. */
export function dueNotice(document: DocumentRow, today: string): NoticeKind | null {
  const remaining = daysBetween(today, document.expiryDate);
  if (remaining >= 0 && remaining <= 3) return '3';
  if (remaining >= 4 && remaining <= 14) return '14';
  return null;
}
