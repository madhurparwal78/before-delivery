import { BUDGETS, DESCRIPTION_LIMIT, PROJECT_TYPES, formatFigure } from './copy.js';
import type { BudgetId, ProjectTypeId } from './types.js';

export type EnquiryField = 'name' | 'email' | 'project_type' | 'budget' | 'description';

export interface FieldError {
  field: EnquiryField | 'submission_id';
  message: string;
}

export interface EnquiryValues {
  name: string;
  email: string;
  projectType: ProjectTypeId;
  budget: BudgetId;
  description: string;
}

export const MESSAGES = {
  nameEmpty: 'Enter your name.',
  nameLength: 'Name must be 2 to 80 characters.',
  emailEmpty: 'Enter your email address.',
  emailForm: 'Enter an email address like name@company.com.',
  projectType: 'Choose a project type.',
  budget: 'Choose a budget range.',
  descriptionEmpty: 'Describe your project.',
  descriptionLength: `Description must be 40 to ${formatFigure(DESCRIPTION_LIMIT)} characters.`,
  submissionId: 'Reload the page and try again.',
} as const;

const NAME_MIN = 2;
const NAME_MAX = 80;
const EMAIL_MAX = 254;
const DESCRIPTION_MIN = 40;
const EMAIL_FORM = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const trimmed = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const characters = (value: string): number => [...value].length;

export const isSubmissionId = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

const chosen = <Id extends string>(
  value: unknown,
  options: readonly { id: Id }[],
): Id | null => {
  if (typeof value !== 'string') return null;
  const option = options.find((candidate) => candidate.id === value);
  return option ? option.id : null;
};

const chosenProjectType = (value: unknown): ProjectTypeId | null =>
  chosen(value, PROJECT_TYPES);

const chosenBudget = (value: unknown): BudgetId | null => chosen(value, BUDGETS);

export interface EnquiryCheck {
  errors: FieldError[];
  values: EnquiryValues | null;
}

export function checkEnquiry(input: {
  name: unknown;
  email: unknown;
  projectType: unknown;
  budget: unknown;
  description: unknown;
}): EnquiryCheck {
  const errors: FieldError[] = [];
  const name = trimmed(input.name);
  const email = trimmed(input.email);
  const description = trimmed(input.description);
  const projectType = chosenProjectType(input.projectType);
  const budget = chosenBudget(input.budget);

  if (name === '') errors.push({ field: 'name', message: MESSAGES.nameEmpty });
  else if (characters(name) < NAME_MIN || characters(name) > NAME_MAX) {
    errors.push({ field: 'name', message: MESSAGES.nameLength });
  }

  if (email === '') errors.push({ field: 'email', message: MESSAGES.emailEmpty });
  else if (characters(email) > EMAIL_MAX || !EMAIL_FORM.test(email)) {
    errors.push({ field: 'email', message: MESSAGES.emailForm });
  }

  if (projectType === null) errors.push({ field: 'project_type', message: MESSAGES.projectType });

  if (budget === null) errors.push({ field: 'budget', message: MESSAGES.budget });

  if (description === '') {
    errors.push({ field: 'description', message: MESSAGES.descriptionEmpty });
  } else if (
    characters(description) < DESCRIPTION_MIN ||
    characters(description) > DESCRIPTION_LIMIT
  ) {
    errors.push({ field: 'description', message: MESSAGES.descriptionLength });
  }

  if (errors.length > 0 || projectType === null || budget === null) {
    return { errors, values: null };
  }
  return { errors, values: { name, email, projectType, budget, description } };
}
