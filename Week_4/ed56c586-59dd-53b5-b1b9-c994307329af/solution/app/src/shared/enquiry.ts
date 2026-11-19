import { SERVICES } from "./catalog.js";

/** The enquiry field rules. The browser checks them when `Send message` is pressed and the server checks them again. */

export type EnquiryField = "name" | "email" | "projectType" | "budget" | "message";

export const ENQUIRY_FIELDS: readonly EnquiryField[] = ["name", "email", "projectType", "budget", "message"];

export type Enquiry = Readonly<Record<EnquiryField, string>>;

export type EnquiryFieldMessages = Partial<Record<EnquiryField, string>>;

interface ProjectType {
  readonly value: string;
  readonly label: string;
}

export const PROJECT_TYPES: readonly ProjectType[] = [
  ...SERVICES.map((service) => ({ value: service.value, label: service.name })),
  { value: "other", label: "Something else" },
];

interface BudgetBand {
  readonly value: string;
  readonly label: string;
}

export const BUDGET_BANDS: readonly BudgetBand[] = [
  { value: "under-5k", label: "Under $5,000" },
  { value: "5k-15k", label: "$5,000 to $15,000" },
  { value: "15k-40k", label: "$15,000 to $40,000" },
  { value: "over-40k", label: "Over $40,000" },
];

const NAME_LENGTH = { min: 2, max: 80 } as const;
const MESSAGE_LENGTH = { min: 20, max: 2000 } as const;
export const ENQUIRY_BODY_LIMIT_BYTES = 16_384;
export const SEND_TIMEOUT_MS = 30_000;

const ENQUIRY_MESSAGES = {
  nameEmpty: "Enter your name.",
  nameLength: "Your name must be 2 to 80 characters.",
  emailEmpty: "Enter your email address.",
  emailShape: "Enter an email address like name@example.com.",
  projectType: "Choose a project type.",
  budget: "Choose a budget range.",
  messageEmpty: "Tell me about your project.",
  messageLength: "Your message must be 20 to 2,000 characters.",
} as const;

export const SENDING_STATUS = "Sending your message…";
export const SENDING_LABEL = "Sending…";
export const NOT_SENT_STATUS =
  "Your message was not sent because the mail server is unavailable. Your details are still here, so you can try again.";

export function invalidStatus(count: number): string {
  return `Check the ${count} highlighted ${count === 1 ? "field" : "fields"}.`;
}

export function sentParagraph(name: string): string {
  return `Thanks, ${name.split(" ")[0]}. Your message is in my inbox, and I usually reply within two working days.`;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Values are trimmed first; the name also has every run of spaces, tabs and line breaks turned into one space. */
export function normaliseEnquiry(raw: Readonly<Partial<Record<EnquiryField, unknown>>>): Enquiry {
  return {
    name: textOf(raw.name).replace(/\s+/g, " ").trim(),
    email: textOf(raw.email).trim(),
    projectType: textOf(raw.projectType).trim(),
    budget: textOf(raw.budget).trim(),
    message: textOf(raw.message).trim(),
  };
}

function lengthOf(text: string): number {
  return [...text].length;
}

function emailShapeIsValid(email: string): boolean {
  if (/[\s\p{Cc}]/u.test(email)) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  const dotAt = domain.indexOf(".", 1);
  return local.length > 0 && dotAt !== -1 && dotAt < domain.length - 1;
}

export function projectTypeLabel(value: string): string | undefined {
  return PROJECT_TYPES.find((type) => type.value === value)?.label;
}

export function budgetLabel(value: string): string | undefined {
  return BUDGET_BANDS.find((band) => band.value === value)?.label;
}

/** The failing fields of a normalised enquiry, each with its message, in field order. */
export function checkEnquiry(enquiry: Enquiry): EnquiryFieldMessages {
  const messages: EnquiryFieldMessages = {};
  const nameLength = lengthOf(enquiry.name);
  if (nameLength === 0) messages.name = ENQUIRY_MESSAGES.nameEmpty;
  else if (nameLength < NAME_LENGTH.min || nameLength > NAME_LENGTH.max) messages.name = ENQUIRY_MESSAGES.nameLength;
  if (enquiry.email === "") messages.email = ENQUIRY_MESSAGES.emailEmpty;
  else if (!emailShapeIsValid(enquiry.email)) messages.email = ENQUIRY_MESSAGES.emailShape;
  if (projectTypeLabel(enquiry.projectType) === undefined) messages.projectType = ENQUIRY_MESSAGES.projectType;
  if (budgetLabel(enquiry.budget) === undefined) messages.budget = ENQUIRY_MESSAGES.budget;
  const messageLength = lengthOf(enquiry.message);
  if (messageLength === 0) messages.message = ENQUIRY_MESSAGES.messageEmpty;
  else if (messageLength < MESSAGE_LENGTH.min || messageLength > MESSAGE_LENGTH.max) messages.message = ENQUIRY_MESSAGES.messageLength;
  return messages;
}

export type EnquiryState = "editing" | "invalid" | "sending" | "sent" | "failed";

type EnquiryEvent =
  | "press-invalid"
  | "press-valid"
  | "fields-corrected"
  | "fields-broken"
  | "created"
  | "rejected"
  | "refused"
  | "send-another";

export function isSending(state: EnquiryState): boolean {
  return state === "sending";
}

/** Whether the visitor is still correcting fields: field messages and the count in `Form status` follow the input. */
export function isCorrecting(state: EnquiryState): boolean {
  return state === "editing" || state === "invalid";
}

/** The enquiry state machine. An event that does not apply to a state leaves it unchanged. */
export function nextEnquiryState(state: EnquiryState, event: EnquiryEvent): EnquiryState {
  switch (event) {
    case "press-invalid":
      return state === "editing" || state === "failed" ? "invalid" : state;
    case "press-valid":
      return state === "editing" || state === "failed" || state === "invalid" ? "sending" : state;
    case "fields-corrected":
      return state === "invalid" ? "editing" : state;
    case "fields-broken":
      return state === "editing" ? "invalid" : state;
    case "created":
      return state === "sending" ? "sent" : state;
    case "rejected":
      return state === "sending" ? "invalid" : state;
    case "refused":
      return state === "sending" ? "failed" : state;
    case "send-another":
      return state === "sent" ? "editing" : state;
  }
}
