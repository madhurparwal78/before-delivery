import { belongsToService } from "./prices";
import type { EnquiryAnswers, FieldErrors, PriceItem, Service } from "./types";

const NAME_MAX = 80;
const BUSINESS_NAME_MAX = 120;
const DESCRIPTION_MIN = 30;
export const DESCRIPTION_MAX = 1200;
export const BODY_MAX_BYTES = 16384;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const BUDGETS: { id: string; label: string }[] = [
  { id: "under-50k", label: "Under ₹50,000" },
  { id: "50k-150k", label: "₹50,000 to ₹1,50,000" },
  { id: "150k-500k", label: "₹1,50,000 to ₹5,00,000" },
  { id: "above-500k", label: "Above ₹5,00,000" },
  { id: "not-sure", label: "Not sure yet" },
];

export const ENQUIRY_STEPS = [
  { id: "details", name: "About you", edit: "Edit about you", fields: ["name", "email", "business_name"] },
  { id: "project", name: "Your project", edit: "Edit your project", fields: ["service", "description"] },
  { id: "budget", name: "Budget", edit: "Edit budget", fields: ["budget"] },
] as const;

export type AnswerField = keyof EnquiryAnswers;

/** Lengths count Unicode code points; each line break counts as one. */
export function characterCount(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

function isSubmissionId(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export interface EnquiryCatalog {
  services: Service[];
  prices: PriceItem[];
}

/** The first failing rule of a field gives its message; an empty result means the field is valid. */
export function fieldError(field: AnswerField, answers: Record<AnswerField, unknown>, catalog: EnquiryCatalog): string | undefined {
  const value = text(answers[field]);
  switch (field) {
    case "name":
      if (value.trim() === "") return "Enter your name.";
      if (characterCount(value) > NAME_MAX) return `Keep your name to ${NAME_MAX} characters or fewer.`;
      return undefined;
    case "email":
      if (value.trim() === "") return "Enter your email address.";
      if (!EMAIL_PATTERN.test(value)) return "Enter an email address like name@example.com.";
      return undefined;
    case "business_name":
      if (value.trim() === "") return "Enter your business name.";
      if (characterCount(value) > BUSINESS_NAME_MAX) return `Keep your business name to ${BUSINESS_NAME_MAX} characters or fewer.`;
      return undefined;
    case "service":
      return catalog.services.some((service) => service.id === answers.service) ? undefined : "Choose a service.";
    case "description":
      if (characterCount(value.trim()) < DESCRIPTION_MIN) return `Describe your project in at least ${DESCRIPTION_MIN} characters.`;
      if (characterCount(value) > DESCRIPTION_MAX) return `Keep your description to ${DESCRIPTION_MAX.toLocaleString("en-US")} characters or fewer.`;
      return undefined;
    case "budget":
      return BUDGETS.some((budget) => budget.id === answers.budget) ? undefined : "Choose an approximate budget.";
    case "item": {
      if (answers.item === null) return undefined;
      const item = catalog.prices.find((price) => price.id === answers.item);
      return item && belongsToService(item, answers.service) ? undefined : "Choose an item from the chosen service.";
    }
  }
}

export function validateFields(fields: readonly AnswerField[], answers: Record<AnswerField, unknown>, catalog: EnquiryCatalog): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of fields) {
    const message = fieldError(field, answers, catalog);
    if (message) errors[field] = message;
  }
  return errors;
}

const ALL_FIELDS: readonly AnswerField[] = ["name", "email", "business_name", "service", "description", "budget", "item"];

/** Every field of a posted enquiry, in one pass; `item` is only checked against a service that exists. */
export function validateEnquiry(body: Record<string, unknown>, catalog: EnquiryCatalog): FieldErrors {
  const answers = { ...body, item: body.item === undefined ? null : body.item } as Record<AnswerField, unknown>;
  const errors = validateFields(ALL_FIELDS, answers, catalog);
  if (!isSubmissionId(body.submission_id)) errors.submission_id = "Missing submission id.";
  return errors;
}

export function limitMessage(limit: number, windowSeconds: number, retryAfterSeconds: number): string {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  const wait = minutes === 1 ? "1 minute" : `${minutes} minutes`;
  return `You have sent ${limit} enquiries from this email address in the last ${windowSeconds / 60} minutes. Try again in ${wait}.`;
}
