/**
 * Document validity and the renter's compliance state. Both the API, the
 * compliance scan, the booking gate and the share page read them from here.
 */

import { addDays, daysBetween } from '../../shared/kitchenTime.js';
import type { Compliance, ComplianceState, DocumentKind, DocumentStatus } from '../../shared/types.js';

export const EXPIRY_NOTICE_DAYS = 14;

/** The two kinds whose lapse stops bookings and suspends a renter. */
export const BLOCKING_KINDS: DocumentKind[] = ['coi', 'food_handler_card'];

export interface DocumentFacts {
  id: string;
  kind: DocumentKind;
  expires_on: string | null;
  status: DocumentStatus;
  seq: number;
}

/** "Latest" always means most recently uploaded. */
function bySeqDescending<T extends { seq: number }>(documents: readonly T[]): T[] {
  return [...documents].sort((a, b) => b.seq - a.seq);
}

export function latestApprovedOfKind<T extends DocumentFacts>(
  documents: readonly T[],
  kind: DocumentKind,
): T | null {
  return bySeqDescending(documents).find((doc) => doc.kind === kind && doc.status === 'approved') ?? null;
}

/** An approved document is current while today is on or before its expiry. A licence with no date never expires. */
export function isDocumentCurrent(document: DocumentFacts, today: string): boolean {
  if (document.status !== 'approved') return false;
  if (document.expires_on === null) return true;
  return document.expires_on >= today;
}

/** The latest approved document of each kind, kept only while current. */
export function currentApprovedByKind<T extends DocumentFacts>(
  documents: readonly T[],
  today: string,
): T[] {
  const kinds: DocumentKind[] = ['coi', 'food_handler_card', 'business_licence'];
  const out: T[] = [];
  for (const kind of kinds) {
    const latest = latestApprovedOfKind(documents, kind);
    if (latest && isDocumentCurrent(latest, today)) out.push(latest);
  }
  return out;
}

export function complianceOf(documents: readonly DocumentFacts[], today: string): Compliance {
  const coi = latestApprovedOfKind(documents, 'coi');
  const card = latestApprovedOfKind(documents, 'food_handler_card');
  const state = ((): ComplianceState => {
    if (!coi || !card) return 'incomplete';
    if (!isDocumentCurrent(coi, today) || !isDocumentCurrent(card, today)) return 'lapsed';
    const horizon = addDays(today, EXPIRY_NOTICE_DAYS);
    if (
      (coi.expires_on !== null && coi.expires_on <= horizon) ||
      (card.expires_on !== null && card.expires_on <= horizon)
    ) {
      return 'expiring';
    }
    return 'current';
  })();
  return {
    state,
    coi_expires_on: coi?.expires_on ?? null,
    card_expires_on: card?.expires_on ?? null,
  };
}

/** Whether the COI and food-handler card are both approved and current. */
export function blockingDocumentsCurrent(
  documents: readonly DocumentFacts[],
  today: string,
): boolean {
  const state = complianceOf(documents, today).state;
  return state === 'current' || state === 'expiring';
}

/** What `documents_review` -> `active` requires: all three approved, the two dated ones current. */
export function activationDocumentsSatisfied(
  documents: readonly DocumentFacts[],
  today: string,
): boolean {
  const licence = latestApprovedOfKind(documents, 'business_licence');
  if (!licence || !isDocumentCurrent(licence, today)) return false;
  return blockingDocumentsCurrent(documents, today);
}

/** True while the document sits inside the 14-day expiry notice window. */
export function isWithinExpiryNotice(document: DocumentFacts, today: string): boolean {
  if (document.expires_on === null) return false;
  const days = daysBetween(today, document.expires_on);
  return days >= 0 && days <= EXPIRY_NOTICE_DAYS;
}

/** `applied` -> `documents_review` needs at least one upload of each of the three kinds. */
export function hasAllThreeKinds(documents: readonly DocumentFacts[]): boolean {
  return (['coi', 'food_handler_card', 'business_licence'] as DocumentKind[]).every((kind) =>
    documents.some((doc) => doc.kind === kind),
  );
}
