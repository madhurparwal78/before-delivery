import type { BookingStatus } from "../../shared/api";
import { ApiFailure } from "./api";
import { formatDollars } from "./format";

export const STATUS_LABELS: Record<BookingStatus, string> = {
  submitted: "Submitted",
  open: "Open call",
  partially_covered: "Partly covered",
  covered: "Covered",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  cancelled_late: "Cancelled (late)",
};

export const COVERAGE_LABELS = { uncovered: "Uncovered", partly_covered: "Partly covered", covered: "Covered" } as const;

export const ROLE_LABELS = {
  coordinator: "Dispatch coordinator",
  interpreter: "Staff interpreter",
  requester: "Client requester",
  billing_manager: "Billing manager",
} as const;

/** Where an error happened decides which copy the screen shows for the same error code. */
export type ActionKind =
  | "sign_in"
  | "sign_out"
  | "submit"
  | "team"
  | "open_call"
  | "assign"
  | "claim"
  | "release"
  | "check_in"
  | "complete"
  | "cancel"
  | "upload"
  | "download"
  | "close_week"
  | "add_rate";

export const NETWORK_COPY = "Relayline could not reach the server. Your last action may not have saved; refresh to check.";
export const NOT_AVAILABLE_COPY = "That booking isn't available to you.";
const CHECK_FIELDS_COPY = "Check the highlighted fields.";

/** The copy for a failure; the API's own top-level message is never shown. */
export function failureCopy(failure: unknown, kind: ActionKind): string {
  if (!(failure instanceof ApiFailure) || failure.body === null) return NETWORK_COPY;
  const { body } = failure;
  switch (body.error) {
    case "invalid_credentials":
      return "Email or password is wrong.";
    case "forbidden":
      return "Your role can't do that.";
    case "not_found":
      return NOT_AVAILABLE_COPY;
    case "invalid_transition":
      return `This booking is now ${STATUS_LABELS[body.status ?? "submitted"]}. The page has been refreshed.`;
    case "validation":
      return kind === "upload" && body.fields?.["file"] ? body.fields["file"] : CHECK_FIELDS_COPY;
    case "open_call_closed":
      return kind === "claim"
        ? "This open call has closed. Contact dispatch."
        : "The open call for this booking has closed. Assign an interpreter directly.";
    case "schedule_conflict":
      return kind === "claim" ? "You already have an assignment at that time." : "That interpreter already has an assignment at this time.";
    case "not_qualified":
      return "That interpreter's credentials don't cover this setting.";
    case "seat_filled":
      return "Already filled — another interpreter took this seat.";
    case "already_holding":
      return "You already hold a seat on this booking.";
    case "already_team":
      return "This booking already needs a team of two.";
    case "idempotency_in_progress":
      return "That request is still being processed. Wait a moment, then check.";
    case "quote_changed":
      return "The cancellation window just changed. Review the new charge.";
    case "payload_too_large":
      return "Files must be 10,000,000 bytes or smaller.";
    case "unsupported_type":
      return "Only PDF, PNG, JPEG, Word (.docx) and PowerPoint (.pptx) files are accepted.";
    case "storage_unavailable":
      return kind === "upload" ? "File storage is unavailable. Try the upload again shortly." : "Prep materials are unavailable right now. Try again shortly.";
    case "access_ended":
      return "Your access to these materials has ended.";
    case "link_expired":
      return "That download link has expired. Press Download again.";
    case "pending_sync":
      return "Some lines are still waiting to sync with billing. Try again shortly.";
    case "billing_unavailable":
      return "Billing is unreachable. Nothing was closed; try again shortly.";
    case "total_mismatch":
      return "Relayline and billing totals differ. Nothing was closed.";
    case "week_closed":
      return "This week is already closed.";
    case "rate_would_reprice":
      return `That date would reprice billed work. Choose a date on or after ${body.earliest_allowed ?? ""}.`;
    default:
      return "Something went wrong. Refresh the page and try again.";
  }
}

export const PENDING = {
  sign_in: "Signing in…",
  submit: "Submitting request…",
  team: "Updating seats…",
  open_call: "Posting open call…",
  assign: "Assigning…",
  claim: "Claiming seat…",
  release: "Releasing seat…",
  check_in: "Checking in…",
  complete: "Recording completion…",
  quote: "Checking the cancellation window…",
  cancel: "Cancelling…",
  download: "Preparing download…",
  close_week: "Closing week…",
  add_rate: "Saving rate…",
} as const;

export const uploading = (file: string): string => `Uploading ${file}…`;

export const SUCCESS = {
  submitted: (ref: string) => `Request ${ref} submitted.`,
  team: (ref: string) => `${ref} now needs a team of two.`,
  openCall: (ref: string) => `Open call posted for ${ref}.`,
  assigned: (name: string, seat: number, ref: string) => `${name} holds seat ${seat} on ${ref}.`,
  claimed: (seat: number, ref: string) => `You hold seat ${seat} on ${ref}.`,
  released: (seat: number, ref: string) => `Seat ${seat} on ${ref} is open again.`,
  checkedIn: (ref: string) => `${ref} is in progress.`,
  completed: (ref: string, line: string) => `${ref} completed. Invoice line ${line} recorded.`,
  cancelled: (ref: string) => `${ref} cancelled.`,
  cancelledLate: (ref: string, cents: number) => `${ref} cancelled. Late charge ${formatDollars(cents)} recorded.`,
  attached: (file: string) => `${file} attached.`,
  weekClosed: (week: string, org: string, relayline: number, billing: number) =>
    `Week of ${week} closed for ${org}. Relayline ${formatDollars(relayline)} matches billing ${formatDollars(billing)}.`,
  rateAdded: (date: string) => `New rate takes effect ${date}.`,
};

export const SEAT_FILLED_NOTICE = (seat: number): string => `Seat ${seat} was just filled. Close this dialog to see the update.`;
