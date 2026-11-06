// Status words shown on screen for API states.

import type { BookingStatus, ComplianceView, RenterStatus } from "../shared/api.js";

export const RENTER_WORDS: Record<RenterStatus, string> = {
  applied: "Applied",
  documents_review: "In review",
  active: "Active",
  suspended: "Suspended",
  offboarded: "Offboarded",
};

export const SHEET_WORDS: Partial<Record<BookingStatus, string>> = {
  confirmed: "Confirmed",
  checked_in: "Checked in",
  completed: "Completed",
};

/** The docket's compliance line renders only the server's state and dates. */
export function complianceLine(compliance: ComplianceView): string {
  if (compliance.state === "current") return "Compliance: current";
  if (compliance.state === "lapsed") return "Compliance: lapsed";
  if (compliance.state === "incomplete") return "Compliance: incomplete";
  const dates = [compliance.coi_expires_on, compliance.card_expires_on].filter((date): date is string => date !== null);
  return `Compliance: expires ${dates.reduce((earliest, date) => (date < earliest ? date : earliest))}`;
}
