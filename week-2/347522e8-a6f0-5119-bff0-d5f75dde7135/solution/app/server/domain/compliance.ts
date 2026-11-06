// Compliance: the state of a renter's COI and food-handler card, who may book, and the scan that
// sends expiry notices and suspends lapsed renters.

import type { ComplianceView, RenterStatus } from "../../shared/api.js";
import { DOCUMENT_LABEL, type DocumentKind, isDocumentCurrent, isDocumentExpiring } from "../../shared/documents.js";
import { kitchenToday } from "../clock.js";
import { pool, rows, transaction } from "../db.js";
import { queueNotice } from "./outbox.js";
import { type DocumentRow, documentsOf } from "./documents.js";
import { changeRenterStatus } from "./renterStatus.js";

/** The most recently uploaded approved document of a kind: the one that counts for compliance. */
function latestApproved(documents: readonly DocumentRow[], kind: DocumentKind): DocumentRow | null {
  return documents.filter((d) => d.kind === kind && d.status === "approved").sort((a, b) => b.seq - a.seq)[0] ?? null;
}

export function complianceOf(documents: readonly DocumentRow[], today: string): ComplianceView {
  const coi = latestApproved(documents, "coi");
  const card = latestApproved(documents, "food_handler_card");
  const view = { coi_expires_on: coi?.expires_on ?? null, card_expires_on: card?.expires_on ?? null };
  if (!coi || !card) return { state: "incomplete", ...view };
  if (!isDocumentCurrent(coi, today) || !isDocumentCurrent(card, today)) return { state: "lapsed", ...view };
  const expiring = isDocumentExpiring(coi, today) || isDocumentExpiring(card, today);
  return { state: expiring ? "expiring" : "current", ...view };
}

/** COI and food-handler card are both approved and current. */
export function coiAndCardCurrent(documents: readonly DocumentRow[], today: string): boolean {
  const state = complianceOf(documents, today).state;
  return state === "current" || state === "expiring";
}

/** Activation from review also needs an approved, current business licence. */
export function readyForActivation(documents: readonly DocumentRow[], today: string): boolean {
  const licence = latestApproved(documents, "business_licence");
  return coiAndCardCurrent(documents, today) && licence !== null && isDocumentCurrent(licence, today);
}

/** Booking is checked status first, then compliance. */
export function bookingRefusal(status: RenterStatus, documents: readonly DocumentRow[], today: string): "renter_not_active" | "compliance_lapsed" | null {
  if (status === "applied" || status === "documents_review" || status === "offboarded") return "renter_not_active";
  if (status === "suspended" || !coiAndCardCurrent(documents, today)) return "compliance_lapsed";
  return null;
}

interface ScanRenterRow {
  id: string;
  email: string;
  status: RenterStatus;
}

async function scanRenter(renter: ScanRenterRow, today: string): Promise<void> {
  await transaction(async (tx) => {
    const documents = await documentsOf(tx, renter.id);
    for (const kind of ["coi", "food_handler_card"] as const) {
      const document = latestApproved(documents, kind);
      if (!document?.expires_on) continue;
      const label = DOCUMENT_LABEL[kind];
      if (!isDocumentCurrent(document, today)) {
        await queueNotice(tx, {
          kind: "document_expired",
          to: renter.email,
          subject: `Your ${label} has expired`,
          body: `Your ${label} expired on ${document.expires_on}.\n\nNew bookings are paused until a current ${label} is uploaded and approved. Upload it from My kitchen.`,
          dedupeKey: `document_expired:${document.id}`,
        });
      } else if (isDocumentExpiring(document, today)) {
        await queueNotice(tx, {
          kind: "document_expiring",
          to: renter.email,
          subject: `Your ${label} expires on ${document.expires_on}`,
          body: `Your ${label} expires on ${document.expires_on}.\n\nUpload a renewed ${label} from My kitchen before then so your bookings are not paused.`,
          dedupeKey: `document_expiring:${document.id}`,
        });
      }
    }
    if (renter.status === "active" && !coiAndCardCurrent(documents, today)) {
      await changeRenterStatus(tx, renter.id, "active", "suspended");
    }
  });
}

/** Runs at start-up and every COMPLIANCE_SCAN_SECONDS. Notices are deduplicated per document. */
export async function runComplianceScan(): Promise<void> {
  const today = kitchenToday();
  const renters = await rows<ScanRenterRow>(pool, "SELECT id, email, status FROM renters WHERE status <> 'offboarded'");
  for (const renter of renters) await scanRenter(renter, today);
}
