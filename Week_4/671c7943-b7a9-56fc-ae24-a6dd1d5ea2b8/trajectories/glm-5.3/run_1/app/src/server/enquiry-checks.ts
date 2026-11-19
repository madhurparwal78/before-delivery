import { isBudgetId, isProjectTypeId } from "../domain/model.js";

export interface EnquiryInput {
  submission_id: unknown;
  name: unknown;
  email: unknown;
  project_type: unknown;
  budget: unknown;
  description: unknown;
}

export type EnquiryFieldErrors = Partial<{
  submission_id: string;
  name: string;
  email: string;
  project_type: string;
  budget: string;
  description: string;
}>;

export const ENQUIRY_MESSAGES = {
  submissionId: "Reload the page and try again.",
  nameEmpty: "Enter your name.",
  nameLength: "Name must be 2 to 80 characters.",
  emailEmpty: "Enter your email address.",
  emailForm: "Enter an email address like name@company.com.",
  projectType: "Choose a project type.",
  budget: "Choose a budget range.",
  descriptionEmpty: "Describe your project.",
  descriptionLength: "Description must be 40 to 2,000 characters.",
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isValidSubmissionId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

export function checkEnquiry(input: EnquiryInput): { errors: EnquiryFieldErrors; name: string; email: string; project_type: string; budget: string; description: string } {
  const errors: EnquiryFieldErrors = {};
  const name = text(input.name);
  const email = text(input.email);
  const description = text(input.description);
  const projectType = typeof input.project_type === "string" && isProjectTypeId(input.project_type) ? input.project_type : "";
  const budget = typeof input.budget === "string" && isBudgetId(input.budget) ? input.budget : "";

  if (name.length < 2 || name.length > 80) {
    errors.name = name.length === 0 ? ENQUIRY_MESSAGES.nameEmpty : ENQUIRY_MESSAGES.nameLength;
  }
  if (email.length === 0) {
    errors.email = ENQUIRY_MESSAGES.emailEmpty;
  } else if (email.length > 254 || !EMAIL_RE.test(email)) {
    errors.email = ENQUIRY_MESSAGES.emailForm;
  }
  if (!projectType) errors.project_type = ENQUIRY_MESSAGES.projectType;
  if (!budget) errors.budget = ENQUIRY_MESSAGES.budget;
  if (description.length < 40 || description.length > 2000) {
    errors.description = description.length === 0 ? ENQUIRY_MESSAGES.descriptionEmpty : ENQUIRY_MESSAGES.descriptionLength;
  }
  return { errors, name, email, project_type: projectType, budget, description };
}
