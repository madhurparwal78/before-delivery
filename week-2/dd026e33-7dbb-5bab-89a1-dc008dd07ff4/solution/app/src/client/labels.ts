// Status labels from the brief (Feedback states › Status labels), built from server values only.
import type { BayBilling, Car, Invoice, Job, JobStatus, ReleaseStatus, Startup } from "../shared/api.js";
import { formatDay, formatTimestampDay } from "../shared/zurich.js";

export function chf(amount: string): string {
  return `CHF ${amount}`;
}

export function startupLabel(startup: Startup): string {
  if (startup.status === "not_scheduled") return "No start-up schedule";
  if (startup.status === "overdue") return "Start-up overdue";
  return `Next start-up due ${startup.next_due ? formatDay(startup.next_due) : ""}`;
}

export function bayBillingLabel(billing: BayBilling): string {
  if (billing.billing_end_date) return `Bay billing ends ${formatDay(billing.billing_end_date)}`;
  if (billing.status === "active" && billing.charged_through_date)
    return `Billed monthly, paid through ${formatDay(billing.charged_through_date)}`;
  if (billing.status === "none") return "No bay billing yet";
  return "Bay billing pending";
}

export function bayLine(car: Car): string {
  if (car.status === "released") return "Released";
  if (car.bay) return `Bay ${car.bay.code}`;
  return "Awaiting intake";
}

export const CAR_STATUS_LABEL: Record<Car["status"], string> = {
  awaiting_intake: "Awaiting intake",
  stored: "Stored",
  released: "Released",
};

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  approved: "Approved",
  declined: "Declined",
  expired: "Expired",
  in_progress: "In progress",
  finished: "Finished",
  invoiced: "Invoiced",
  paid: "Paid",
};

/** The estimate label; a sent estimate names the Zurich date it must be approved by. */
export function estimateLabel(job: Job): string {
  if (job.status === "sent") return `Sent, approve by ${job.expires_at ? formatTimestampDay(job.expires_at) : ""}`;
  return JOB_STATUS_LABEL[job.status];
}

export function invoiceStatusLabel(invoice: Invoice): string {
  if (invoice.status === "awaiting_payment") return "Awaiting payment";
  return invoice.balance_live ? "Paid" : `Paid, last confirmed ${formatTimestampDay(invoice.status_confirmed_at)}`;
}

export function outstandingLine(invoice: Invoice): string {
  const line = `Outstanding: ${chf(invoice.balance)}`;
  return invoice.balance_live ? line : `${line}, last confirmed ${formatTimestampDay(invoice.status_confirmed_at)}`;
}

export const RELEASE_STATUS_LABEL: Record<ReleaseStatus, string> = {
  requested: "Requested",
  booked: "Booked",
  staged: "Staged",
  released: "Released",
  cancelled: "Cancelled",
};

export const PORTAL_RELEASE_HEADING: Record<ReleaseStatus, string> = {
  requested: "Release requested",
  booked: "Your release is booked",
  staged: "Your car is ready for handover",
  released: "Released",
  cancelled: "Release cancelled",
};

export const ROLE_LABEL = {
  concierge: "Concierge",
  care_technician: "Care technician",
  workshop_lead: "Workshop lead",
  house_manager: "House manager",
  owner: "Owner",
} as const;

export const NO_ANSWER = {
  round: "No answer from the server. Press Save entry again; it won't be logged twice.",
  invoice: "No answer from the server. Press Issue invoice again; it won't be issued twice.",
  release: "No answer from the server. Press Request release again; it won't be requested twice.",
  transfer: "No answer from the server. Press Record transfer again; it won't be recorded twice.",
} as const;

export const IDEMPOTENCY_CONFLICT = "This was already sent with different values. Close this form and check the latest record.";
export const SIGNED_IN_AGAIN = "Signed in again. Nothing was saved; press again.";
export const JOB_MOVED_ON = "This job has moved on. Reload to see its current state.";
export const NOT_FOUND = "We couldn't find that page";
