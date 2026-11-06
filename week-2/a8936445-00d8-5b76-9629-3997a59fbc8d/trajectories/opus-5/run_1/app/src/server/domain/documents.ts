import { DOCUMENT_KINDS, REQUIRED_DOCUMENT_KINDS, type DocumentKind } from './constants.js';
import { addDays, resolveLocalOrTransition } from './time.js';
import type { DocumentRecord } from './types.js';

export interface RequiredDocumentState {
  valid: boolean;
  expires_on: string | null;
}

export function isApprovedAndValid(document: DocumentRecord, today: string): boolean {
  return document.status === 'approved' && document.expiresOn >= today;
}

function latestExpiry(documents: readonly DocumentRecord[], kind: DocumentKind): string | null {
  let latest: string | null = null;
  for (const document of documents) {
    if (document.kind !== kind || document.status !== 'approved') continue;
    if (latest === null || document.expiresOn > latest) latest = document.expiresOn;
  }
  return latest;
}

export function requiredDocumentStates(
  documents: readonly DocumentRecord[],
  today: string,
): Record<DocumentKind, RequiredDocumentState> {
  const states = {} as Record<DocumentKind, RequiredDocumentState>;
  for (const kind of DOCUMENT_KINDS) {
    const expiry = latestExpiry(documents, kind);
    states[kind] = { valid: expiry !== null && expiry >= today, expires_on: expiry };
  }
  return states;
}

export function missingRequiredKinds(
  documents: readonly DocumentRecord[],
  today: string,
): DocumentKind[] {
  const states = requiredDocumentStates(documents, today);
  return REQUIRED_DOCUMENT_KINDS.filter((kind) => !states[kind].valid);
}

/** The instant from which a required kind stops counting: 00:00 after its latest approved expiry. */
export function validityEdge(
  documents: readonly DocumentRecord[],
  kind: DocumentKind,
): Date | null {
  const expiry = latestExpiry(documents, kind);
  if (expiry === null) return null;
  return resolveLocalOrTransition(addDays(expiry, 1), 0);
}

export interface ExpiryBlock {
  kinds: DocumentKind[];
  dates: string[];
}

/** Occurrences that end after a required kind's validity edge, with the kinds that block them. */
export function occurrencesBlockedByExpiry(
  documents: readonly DocumentRecord[],
  occurrences: readonly { date: string; endAt: Date }[],
): ExpiryBlock | null {
  const kinds = new Set<DocumentKind>();
  const dates = new Set<string>();
  for (const kind of REQUIRED_DOCUMENT_KINDS) {
    const edge = validityEdge(documents, kind);
    for (const occurrence of occurrences) {
      if (edge === null || occurrence.endAt.getTime() > edge.getTime()) {
        kinds.add(kind);
        dates.add(occurrence.date);
      }
    }
  }
  if (kinds.size === 0) return null;
  return { kinds: [...kinds], dates: [...dates].sort() };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function detectContentType(bytes: Buffer): 'application/pdf' | 'image/jpeg' | 'image/png' | null {
  if (bytes.subarray(0, 5).equals(Buffer.from('%PDF-', 'latin1'))) return 'application/pdf';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  return null;
}

export function extensionFor(contentType: string): string {
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType === 'image/jpeg') return 'jpg';
  return 'png';
}

export function sanitiseFileName(raw: string): string {
  const lastSegment = raw.split(/[/\\]/).pop() ?? '';
  const cleaned = lastSegment.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'document';
}
