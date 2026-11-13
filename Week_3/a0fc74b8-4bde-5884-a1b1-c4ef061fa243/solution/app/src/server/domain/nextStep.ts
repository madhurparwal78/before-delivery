import type { DocumentStatus, RecipientStatus, Delivery } from "../../shared/types.js";

interface NextStepRecipient {
  name: string;
  signing_order: number;
  status: RecipientStatus;
  delivery: Delivery | null;
}

export function nextStep(
  document: { status: DocumentStatus; current_order: number | null },
  recipients: NextStepRecipient[],
): string {
  switch (document.status) {
    case "draft":
      return "Add signers and fields";
    case "sealing":
      return "Sealing the completed PDF";
    case "completed":
    case "declined":
    case "voided":
      return "None";
    case "in_progress": {
      const current = recipients.find((r) => r.signing_order === document.current_order);
      if (!current) return "None";
      if (current.status === "expired") return `Link expired for ${current.name}`;
      if (current.delivery === "held") return `Invitation not delivered yet to ${current.name}`;
      return `Waiting for ${current.name} (${current.signing_order} of ${recipients.length})`;
    }
  }
}
