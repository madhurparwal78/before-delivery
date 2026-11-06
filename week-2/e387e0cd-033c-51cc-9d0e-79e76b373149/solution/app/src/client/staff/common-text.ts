// Published visible texts for API enums, shared by the staff screens.
import type { CaseStatus, Counterparty, Role } from "../types";

export const CASE_STATUS_TEXT: Record<CaseStatus, string> = {
  awaiting_ownership: "Ownership pending",
  in_review: "In review",
  awaiting_answer: "Waiting for answer",
  accepted: "Accepted",
  rejected: "Rejected",
  no_response: "No response",
  cleared: "Ready to release",
  released: "Released",
  returned: "Returned",
};

export const OUTCOME_TEXT: Record<string, string> = {
  match: "Match",
  partial: "Partial",
  no_match: "No match",
  accepted: "Accepted",
  rejected: "Rejected",
  late: "Late",
};

export const DUE_DILIGENCE_OPTIONS: { value: Counterparty["dueDiligence"]; label: string }[] = [
  { value: "trusted", label: "Trusted" },
  { value: "pending", label: "Pending" },
  { value: "restricted", label: "Restricted" },
  { value: "blocked", label: "Blocked" },
];

export const NETWORK_TEXT: Record<Counterparty["network"], string> = {
  on_network: "On the network",
  off_network: "Off the network",
};

export const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "compliance_officer", label: "Compliance officer" },
  { value: "compliance_analyst", label: "Compliance analyst" },
  { value: "operations_lead", label: "Operations lead" },
  { value: "finance_lead", label: "Finance lead" },
  { value: "support_agent", label: "Support agent" },
];

/** `1,500` for counts shown beside published limits. */
export function wholeNumber(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
