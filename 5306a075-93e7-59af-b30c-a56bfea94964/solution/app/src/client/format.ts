// Display labels and dates.
import type { Importance, NoteSource, Role } from "../shared/api.js";

export const SOURCE_LABELS: Record<NoteSource, string> = {
  support_ticket: "Support ticket", sales_call: "Sales call", email: "Email", csv_import: "CSV import",
};
export const IMPORTANCE_LABELS: Record<Importance, string> = { nice_to_have: "Nice to have", important: "Important", critical: "Critical" };
export const ROLE_LABELS: Record<Role, string> = { head_of_product: "Head of product", product_manager: "Product manager", customer_success: "Customer success" };

/** "Mar 14, 2027, 3:30 AM" in the workspace time zone. */
export const localTime = (instant: string, timeZone: string): string =>
  new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(instant));

export const shortDate = (instant: string, timeZone: string): string =>
  new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(new Date(instant));

/** A calendar date "2027-03-15" as "Mar 15, 2027". */
export const calendarDate = (date: string): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(`${date}T00:00:00Z`));

export const twoDecimals = (value: number): string => value.toFixed(2);
