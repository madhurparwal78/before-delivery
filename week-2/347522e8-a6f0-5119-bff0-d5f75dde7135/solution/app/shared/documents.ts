// Document validity, defined once: compliance on the server and the status words on screen both
// read it.

import { addDays } from "./kitchenTime.js";

export const DOCUMENT_KINDS = ["coi", "food_handler_card", "business_licence"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export type DocumentStatus = "pending_review" | "approved" | "rejected";

export const DOCUMENT_LABEL: Record<DocumentKind, string> = {
  coi: "certificate of insurance",
  food_handler_card: "food-handler card",
  business_licence: "business licence",
};

interface DatedDocument {
  status: DocumentStatus;
  expires_on: string | null;
}

/** An approved document is current while today is on or before its expiry date; a licence without a date always is. */
export function isDocumentCurrent(document: DatedDocument, today: string): boolean {
  return document.status === "approved" && (document.expires_on === null || document.expires_on >= today);
}

const EXPIRING_WITHIN_DAYS = 14;

/** A dated document expires within the next 14 days, today and day 14 included. */
export function isDocumentExpiring(document: DatedDocument, today: string): boolean {
  return document.expires_on !== null && document.expires_on <= addDays(today, EXPIRING_WITHIN_DAYS);
}

type DocumentStatusWord = "Waiting for review" | "Approved" | "Rejected" | "Expired";

export function documentStatusWord(document: DatedDocument, today: string): DocumentStatusWord {
  if (document.status === "pending_review") return "Waiting for review";
  if (document.status === "rejected") return "Rejected";
  return isDocumentCurrent(document, today) ? "Approved" : "Expired";
}
