// Facts about the one kitchen that both the server and the browser rely on.

export const PRODUCT_NAME = "Stationkeeper";
export const KITCHEN_NAME = "Larder Row Kitchen";
export const TIME_ZONE = "America/Chicago";

export const STEP_MINUTES = 15;
export const DAY_MINUTES = 1440;
export const MIN_HOLD_MINUTES = 60;
export const MAX_HOLD_MINUTES = 480;
export const MAX_WEEKS = 12;
export const BOOK_AHEAD_DAYS = 365;
export const DIAL_PAST_DAYS = 30;
export const CLEANING_BUFFER_MINUTES = 30;
export const CHECK_IN_EARLY_MINUTES = 15;
export const HOLDOVER_GRACE_MINUTES = 10;
export const HOLDOVER_STEP_MINUTES = 15;
export const HOLDOVER_MAX_MINUTES = 240;
export const NOTES_MAX = 500;
export const REASON_MAX = 500;
export const HOLDER_MAX = 120;
export const FREE_WINDOW_MAX_HOURS = 168;
export const FILE_CAP_BYTES = 5_000_000;
export const FILE_CAP_LABEL = "5,000,000 bytes";
export const REMINDER_LEAD_DAYS = 14;

export type Role = "operator" | "owner" | "cook";
export type TenantStatus = "applied" | "documents_review" | "active" | "suspended" | "offboarded";
export type BookingStatus = "held" | "confirmed" | "checked_in" | "completed" | "cancelled" | "no_show";
export type PayWith = "account" | "hour_pack";
export type DocumentKind = "certificate_of_insurance" | "food_handler_card" | "health_permit";
export type DocumentStatus = "pending_review" | "approved" | "rejected";
export type StationKind = "hot_line" | "bake_deck" | "cold_prep";
export type InvoiceStatus = "issued" | "paid";
export type LineKind = "station_time" | "holdover" | "late_fee" | "storage";
export type LedgerAccount = "tenant_pack" | "kitchen_hours";
export type LedgerReason = "opening_balance" | "pack_purchase" | "booking" | "cancellation_return" | "fee_refund";

export const DOCUMENT_KINDS: readonly DocumentKind[] = ["certificate_of_insurance", "food_handler_card", "health_permit"];
export const REQUIRED_KINDS: readonly DocumentKind[] = ["certificate_of_insurance", "health_permit", "food_handler_card"];

export const KIND_LABELS: Record<DocumentKind, string> = {
  certificate_of_insurance: "Certificate of insurance",
  food_handler_card: "Food handler card",
  health_permit: "Health permit",
};

export const TENANT_STATUS_WORDS: Record<TenantStatus, string> = {
  applied: "Applied",
  documents_review: "Documents review",
  active: "Active",
  suspended: "Suspended",
  offboarded: "Offboarded",
};

export const BOOKING_STATUS_WORDS: Record<BookingStatus, string> = {
  held: "Held",
  confirmed: "Confirmed",
  checked_in: "Checked in",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export const INVOICE_STATUS_WORDS: Record<InvoiceStatus, string> = { issued: "Issued", paid: "Paid" };

export const LEDGER_REASON_WORDS: Record<LedgerReason, string> = {
  opening_balance: "Opening balance",
  pack_purchase: "Pack purchase",
  booking: "Booking",
  cancellation_return: "Cancellation return",
  fee_refund: "Fee refund",
};
