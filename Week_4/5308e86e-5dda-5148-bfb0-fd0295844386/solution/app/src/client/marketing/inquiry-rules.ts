/** Inquiry rules as the server applies them: trimmed, NFC-normalised, counted in code points. */

import { EMAIL_MAX, INQUIRY_MESSAGE_MAX, INQUIRY_NAME_MAX } from "../../shared/rules.js";
import { MESSAGE_TOO_LONG, NAME_TOO_LONG } from "../../shared/messages.js";

export type InquiryField = "email" | "first_name" | "last_name" | "company" | "message";

export const INQUIRY_FIELDS: InquiryField[] = ["email", "first_name", "last_name", "company", "message"];


const REQUIRED_COPY: Record<InquiryField, string> = {
  email: "Enter a valid email",
  first_name: "Enter your first name",
  last_name: "Enter your last name",
  company: "Enter your company",
  message: "Enter a message",
};


export const RATE_LIMITED_COPY = "You've sent several inquiries recently. Please try again in a few minutes.";
export const BODY_TOO_LARGE_COPY = "Your message is too long to send.";
export const UNREACHABLE_COPY = "Tallwind can't be reached right now. Try again in a moment.";
export const SERVER_ERROR_COPY = "Something went wrong. Try again.";
export const THANKS_COPY = "Thanks for reaching out, our team will get back to you shortly.";

function cleanText(value: string): string {
  return value.trim().normalize("NFC");
}

export function codePointCount(value: string): number {
  return [...cleanText(value)].length;
}

function looksLikeEmail(value: string): boolean {
  const text = cleanText(value);
  const at = text.indexOf("@");
  if (at < 1 || at !== text.lastIndexOf("@") || codePointCount(text) > EMAIL_MAX) return false;
  const domain = text.slice(at + 1);
  return domain.includes(".") && !/\s/.test(text);
}

/** The message to show under a field for the value typed in it, or null when the value is acceptable. */
export function fieldProblem(field: InquiryField, value: string): string | null {
  if (field === "email") return looksLikeEmail(value) ? null : REQUIRED_COPY.email;
  const length = codePointCount(value);
  if (length === 0) return REQUIRED_COPY[field];
  if (field === "message") return length > INQUIRY_MESSAGE_MAX ? MESSAGE_TOO_LONG : null;
  return length > INQUIRY_NAME_MAX ? NAME_TOO_LONG : null;
}

/** The copy for a field the server refused: ours when we can explain it, otherwise the field's required copy. */
export function refusedCopy(field: InquiryField, value: string): string {
  return fieldProblem(field, value) ?? REQUIRED_COPY[field];
}
