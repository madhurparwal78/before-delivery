import type { DocumentStatus, LinkState, RecipientStatus } from "../../shared/types.js";

export function linkState(
  document: { status: DocumentStatus },
  recipient: { status: RecipientStatus },
  replaced: boolean,
): LinkState {
  if (document.status === "voided") return "voided";
  if (document.status === "declined") return "declined";
  if (document.status === "completed") return "completed";
  if (document.status === "sealing") return "sealing";
  if (recipient.status === "signed") return "signed_waiting";
  if (replaced || recipient.status === "expired") return "expired";
  return "your_turn";
}
