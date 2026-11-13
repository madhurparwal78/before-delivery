import type { DocumentStatus, RecipientStatus, Delivery } from "./types.js";

export const STATUS_WORDS: Record<DocumentStatus, string> = {
  draft: "Draft",
  in_progress: "In progress",
  sealing: "Sealing",
  completed: "Completed",
  declined: "Declined",
  voided: "Voided",
};

export function rowWord(status: RecipientStatus, delivery: Delivery | null): string {
  switch (status) {
    case "waiting":
      return "Waiting";
    case "invited":
      return delivery === "held" ? "Not delivered yet" : "Invited";
    case "viewed":
      return "Viewed";
    case "signed":
      return "Signed";
    case "declined":
      return "Declined";
    case "expired":
      return "Link expired";
  }
}

export const VALIDATION_COPY = {
  title: "Enter a title of 1 to 120 characters.",
  timeZone: "Choose a valid time zone.",
  file: "Choose a PDF to upload.",
  name: "Enter a name.",
  emailInvalid: "Enter a valid email address.",
  emailTaken: "This email is already a signer on this document.",
  recipients: "A document can have at most 10 signers.",
  kind: "Choose signature, initials, date or text.",
  label: "Enter a label of 1 to 40 characters.",
  geometry: "Fields must lie inside the page and be at least 0.02 by 0.02.",
  value: "Text can be at most 200 characters.",
  typed: "Enter 1 to 100 characters.",
  strokes: "Draw at least one stroke of at most 5,000 points.",
  reasonDecline: "Enter a reason for declining.",
  reasonVoid: "Enter a reason for voiding.",
  reasonTooLong: "Reason can be at most 500 characters.",
  signers: "Enter a name and a valid email address for every signer.",
  role: "Choose owner, member or viewer.",
  direction: "Choose up or down.",
} as const;

export const SERVICE_NOTICE = {
  mail: "Email is unavailable. Invitations are held and sent when email recovers.",
  storage: "File storage is unavailable. New uploads are paused and completed PDFs are sealed when it recovers.",
} as const;

export const PAGES_UNAVAILABLE = {
  heading: "Pages can't be shown right now",
  body: "File storage is unavailable. Your document and its fields are safe.",
} as const;

export const NOT_FOUND = {
  heading: "Document not found",
  body: "Check the link, or ask your team owner.",
} as const;

export const GENERIC_FAILURE = "Something went wrong. Try again.";

export function positionCopy(label: string, page: number, box: { x: number; y: number; w: number; h: number }): string {
  return `${label}: page ${page}, x ${box.x.toFixed(3)}, y ${box.y.toFixed(3)}, width ${box.w.toFixed(3)}, height ${box.h.toFixed(3)}`;
}
