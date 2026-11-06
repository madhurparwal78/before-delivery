/**
 * The document status word. My kitchen and the operator's review dialog decide
 * it the same way, from the document's stored status and its expiry against
 * today in kitchen time.
 */

import {
  DOCUMENT_WORD_APPROVED,
  DOCUMENT_WORD_EXPIRED,
  DOCUMENT_WORD_PENDING,
  DOCUMENT_WORD_REJECTED,
} from '../shared/copy.js';
import type { ComplianceDocument, DocumentKind } from '../shared/types.js';

export function documentWord(document: ComplianceDocument, today: string): string {
  if (document.status === 'pending_review') return DOCUMENT_WORD_PENDING;
  if (document.status === 'rejected') return DOCUMENT_WORD_REJECTED;
  if (document.expires_on !== null && document.expires_on < today) return DOCUMENT_WORD_EXPIRED;
  return DOCUMENT_WORD_APPROVED;
}

export const DOCUMENT_KINDS: DocumentKind[] = ['coi', 'food_handler_card', 'business_licence'];

/** The latest upload of each kind, which is all either screen lists. */
export function latestPerKind(documents: readonly ComplianceDocument[]): ComplianceDocument[] {
  const rows: ComplianceDocument[] = [];
  for (const kind of DOCUMENT_KINDS) {
    const latest = documents.find((document) => document.kind === kind);
    if (latest) rows.push(latest);
  }
  return rows;
}
