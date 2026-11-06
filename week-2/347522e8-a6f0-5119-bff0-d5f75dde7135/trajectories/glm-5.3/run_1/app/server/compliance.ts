import { rows, type Db } from "./db.js";
import { kitchenToday } from "./kitchenTime.js";

// Document validity, compliance state and renter review requirements — each
// decided in this one place (DP-31, DP-32, DP-33, DP-04).

export type DocumentKind = "coi" | "food_handler_card" | "business_licence";

export type DocumentRow = {
  id: string;
  renter_id: string;
  kind: DocumentKind;
  expires_on: string | null;
  status: "pending_review" | "approved" | "rejected";
  object_key: string;
  original_name: string;
  size_bytes: number;
  content_type: string;
  created_at: string;
};

export const documentLabels: Record<DocumentKind, string> = {
  coi: "certificate of insurance",
  food_handler_card: "food-handler card",
  business_licence: "business licence",
};

// An approved document is current while today is on or before its expires_on.
// A licence without a date is always current.
export const isCurrent = (document: { status: string; expires_on: string | null }, today: string): boolean => {
  if (document.status !== "approved") return false;
  if (document.expires_on === null) return true;
  return document.expires_on >= today;
};

export const latestByKind = (documents: DocumentRow[]): Map<DocumentKind, DocumentRow> => {
  const map = new Map<DocumentKind, DocumentRow>();
  for (const document of documents) {
    const existing = map.get(document.kind);
    if (!existing || existing.created_at <= document.created_at) map.set(document.kind, document);
  }
  return map;
};

export const latestApprovedByKind = (documents: DocumentRow[]): Map<DocumentKind, DocumentRow> => {
  const map = new Map<DocumentKind, DocumentRow>();
  for (const document of documents) {
    if (document.status !== "approved") continue;
    const existing = map.get(document.kind);
    if (!existing || existing.created_at <= document.created_at) map.set(document.kind, document);
  }
  return map;
};

export type Compliance = {
  state: "current" | "expiring" | "lapsed" | "incomplete";
  coi_expires_on: string | null;
  card_expires_on: string | null;
};

export const complianceOf = (documents: DocumentRow[], today: string): Compliance => {
  const approved = latestApprovedByKind(documents);
  const coi = approved.get("coi") ?? null;
  const card = approved.get("food_handler_card") ?? null;
  const coiExpiry = coi?.expires_on ?? null;
  const cardExpiry = card?.expires_on ?? null;
  if (!coi || !card) {
    return { state: "incomplete", coi_expires_on: coiExpiry, card_expires_on: cardExpiry };
  }
  if (!isCurrent(coi, today) || !isCurrent(card, today)) {
    return { state: "lapsed", coi_expires_on: coiExpiry, card_expires_on: cardExpiry };
  }
  const soon = new Date(today);
  soon.setUTCDate(soon.getUTCDate() + 14);
  const soonStr = soon.toISOString().slice(0, 10);
  const earliest = [coiExpiry, cardExpiry].filter((d): d is string => d !== null).sort()[0] ?? null;
  if (earliest !== null && earliest <= soonStr) {
    return { state: "expiring", coi_expires_on: coiExpiry, card_expires_on: cardExpiry };
  }
  return { state: "current", coi_expires_on: coiExpiry, card_expires_on: cardExpiry };
};

export const loadDocuments = (db: Db, renterId: string): Promise<DocumentRow[]> =>
  rows<DocumentRow>(
    db,
    `select id, renter_id, kind, expires_on::text as expires_on, status, object_key,
            original_name, size_bytes, content_type, created_at
     from documents where renter_id = $1
     order by created_at desc, id desc`,
    [renterId],
  );

export const complianceForRenter = async (db: Db, renterId: string, now: Date): Promise<Compliance> => {
  const documents = await loadDocuments(db, renterId);
  return complianceOf(documents, kitchenToday(now));
};

// Booking eligibility (Business rules: who may book). Status first, then
// document currency.
export type BookingEligibility = "ok" | "renter_not_active" | "compliance_lapsed";

export const bookingEligibility = (
  renterStatus: string,
  compliance: Compliance,
  today: string,
): BookingEligibility => {
  if (renterStatus === "applied" || renterStatus === "documents_review" || renterStatus === "offboarded") {
    return "renter_not_active";
  }
  if (renterStatus === "suspended") return "compliance_lapsed";
  if (compliance.state === "incomplete" || compliance.state === "lapsed") return "compliance_lapsed";
  void today;
  return "ok";
};

// Activation requirement: approved licence plus an approved, current COI and card.
export const canActivate = (documents: DocumentRow[], today: string): boolean => {
  const approved = latestApprovedByKind(documents);
  const licence = approved.get("business_licence");
  const coi = approved.get("coi");
  const card = approved.get("food_handler_card");
  if (!licence || !isCurrent(licence, today)) return false;
  if (!coi || !isCurrent(coi, today)) return false;
  if (!card || !isCurrent(card, today)) return false;
  return true;
};

// applied -> documents_review happens once the renter has at least one document
// of each of the three kinds uploaded.
export const hasAllThreeKinds = (documents: DocumentRow[]): boolean => {
  const kinds = new Set(documents.map((d) => d.kind));
  return kinds.has("coi") && kinds.has("food_handler_card") && kinds.has("business_licence");
};
