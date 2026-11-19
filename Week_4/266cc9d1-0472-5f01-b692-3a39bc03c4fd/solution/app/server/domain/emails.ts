// The two emails Spanwise sends: the review link and the decision summary.
import type { Email } from "../mail.js";
import { counted, zonedMinute } from "../../shared/text.js";
import type { CorridorRecord } from "./corridor.js";

export function reviewLinkEmail(
  corridor: CorridorRecord,
  revision: number,
  url: string,
  expiresAt: Date,
  frozen: { finding_count: number; violation_count: number },
): Email {
  return {
    to: corridor.utility.foresterEmail,
    subject: `Spanwise review: ${corridor.name} revision ${revision}`,
    body: [
      `Hello ${corridor.utility.foresterName},`,
      "",
      `Revision ${revision} of the ${corridor.name} vegetation clearance findings is ready for your review.`,
      "",
      url,
      "",
      `Link expires ${zonedMinute(expiresAt, corridor.utility.timeZone)} (${corridor.utility.timeZone})`,
      `${counted(frozen.finding_count, "finding")}, ${counted(frozen.violation_count, "violation")}`,
      "",
      "Open the link in any browser to accept or dispute each finding. Nothing to install.",
    ].join("\n"),
  };
}

export function decisionSummaryEmail(
  corridor: CorridorRecord,
  revision: number,
  outcome: "accepted" | "disputed",
  analystEmail: string,
  lines: Array<{ label: string; decision: string; note: string }>,
): Email {
  return {
    to: analystEmail,
    subject: `Spanwise decision: ${corridor.name} revision ${revision} ${outcome}`,
    body: [
      `${corridor.utility.foresterName} sent the decisions for revision ${revision} of ${corridor.name}.`,
      "",
      ...lines.map((l) => (l.decision === "accept" ? `${l.label} accepted` : `${l.label} disputed: ${l.note}`)),
    ].join("\n"),
  };
}
