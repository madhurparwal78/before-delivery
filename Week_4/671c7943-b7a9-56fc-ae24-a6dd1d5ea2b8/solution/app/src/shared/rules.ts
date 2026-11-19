import { BUDGETS, CATEGORY_IDS, PROJECT_TYPES } from "./copy.js";
import type { CategoryId, EnquiryErrors, EnquiryValues } from "./types.js";

const LIMITS = {
  nameMin: 2,
  nameMax: 80,
  emailMax: 254,
  descriptionMin: 40,
  descriptionMax: 2000,
} as const;

export const MESSAGES = {
  nameEmpty: "Enter your name.",
  nameLength: "Name must be 2 to 80 characters.",
  emailEmpty: "Enter your email address.",
  emailShape: "Enter an email address like name@company.com.",
  projectType: "Choose a project type.",
  budget: "Choose a budget range.",
  descriptionEmpty: "Describe your project.",
  descriptionLength: "Description must be 40 to 2,000 characters.",
  submissionId: "Reload the page and try again.",
} as const;

const EMAIL_SHAPE = /^\S+@\S+\.\S+$/u;

export function formatNumber(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function characterCount(value: string): number {
  return Array.from(value).length;
}

export function firstName(name: string): string {
  const space = name.indexOf(" ");
  return space === -1 ? name : name.slice(0, space);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function trimmedValues(raw: Record<string, unknown>): EnquiryValues {
  return {
    name: text(raw["name"]),
    email: text(raw["email"]),
    project_type: text(raw["project_type"]),
    budget: text(raw["budget"]),
    description: text(raw["description"]),
  };
}

/** The one place that decides which enquiry fields fail and with which published message. */
export function checkEnquiry(values: EnquiryValues): EnquiryErrors {
  const errors: EnquiryErrors = {};
  const nameLength = characterCount(values.name);
  if (nameLength === 0) errors.name = MESSAGES.nameEmpty;
  else if (nameLength < LIMITS.nameMin || nameLength > LIMITS.nameMax) errors.name = MESSAGES.nameLength;
  if (values.email === "") errors.email = MESSAGES.emailEmpty;
  else if (characterCount(values.email) > LIMITS.emailMax || !EMAIL_SHAPE.test(values.email)) errors.email = MESSAGES.emailShape;
  if (!PROJECT_TYPES.some((type) => type.id === values.project_type)) errors.project_type = MESSAGES.projectType;
  if (!BUDGETS.some((budget) => budget.id === values.budget)) errors.budget = MESSAGES.budget;
  const descriptionLength = characterCount(values.description);
  if (descriptionLength === 0) errors.description = MESSAGES.descriptionEmpty;
  else if (descriptionLength < LIMITS.descriptionMin || descriptionLength > LIMITS.descriptionMax) {
    errors.description = MESSAGES.descriptionLength;
  }
  return errors;
}

export function isCategory(value: unknown): value is CategoryId {
  return CATEGORY_IDS.some((id) => id === value);
}

/** The sequence of a case study: every project, or only the chosen category, in published order. */
export function sequenceOf<T extends { category: CategoryId }>(projects: readonly T[], category: CategoryId | null): T[] {
  return category === null ? [...projects] : projects.filter((project) => project.category === category);
}

/** Wraps each digit in a fixed-width span: Instrument Serif has no tabular figures. Takes escaped text. */
export function digitSpans(escaped: string): string {
  return escaped.replace(/\d/g, (digit) => `<span class="fig">${digit}</span>`);
}
