/**
 * The enquiry field rules and state machine, applied in the browser when
 * `Send message` is pressed and again on the server.
 */

import { SERVICES } from './seed.js';

export const ENQUIRY_FIELDS = ['name', 'email', 'projectType', 'budget', 'message'] as const;

export type EnquiryField = (typeof ENQUIRY_FIELDS)[number];

export type EnquiryFieldMessages = Partial<Record<EnquiryField, string>>;

export interface EnquiryInput {
  readonly name: string;
  readonly email: string;
  readonly projectType: string;
  readonly budget: string;
  readonly message: string;
}

interface ProjectTypeOption {
  readonly value: string;
  readonly label: string;
}

/** The five service names in service order, then `Something else`. */
export const PROJECT_TYPE_OPTIONS: readonly ProjectTypeOption[] = [
  ...SERVICES.map((service) => ({ value: service.id, label: service.name })),
  { value: 'other', label: 'Something else' },
];

export const PROJECT_TYPE_PLACEHOLDER = 'Choose a project type';

interface BudgetOption {
  readonly value: string;
  readonly label: string;
}

export const BUDGET_OPTIONS: readonly BudgetOption[] = [
  { value: 'under-5k', label: 'Under $5,000' },
  { value: '5k-15k', label: '$5,000 to $15,000' },
  { value: '15k-40k', label: '$15,000 to $40,000' },
  { value: 'over-40k', label: 'Over $40,000' },
];

export const projectTypeLabel = (value: string): string | undefined =>
  PROJECT_TYPE_OPTIONS.find((option) => option.value === value)?.label;

const budgetLabel = (value: string): string | undefined =>
  BUDGET_OPTIONS.find((option) => option.value === value)?.label;

const NAME_MIN = 2;
const NAME_MAX = 80;
const MESSAGE_MIN = 20;
const MESSAGE_MAX = 2000;

const FIELD_MESSAGES = {
  nameEmpty: 'Enter your name.',
  nameLength: 'Your name must be 2 to 80 characters.',
  emailEmpty: 'Enter your email address.',
  emailShape: 'Enter an email address like name@example.com.',
  projectTypeEmpty: 'Choose a project type.',
  budgetEmpty: 'Choose a budget range.',
  messageEmpty: 'Tell me about your project.',
  messageLength: 'Your message must be 20 to 2,000 characters.',
} as const;

/** Trimmed, with every run of spaces, tabs and line breaks turned into one space. */
const normaliseName = (raw: string): string => raw.trim().replace(/\s+/g, ' ');

export const normaliseEnquiry = (input: EnquiryInput): EnquiryInput => ({
  name: normaliseName(input.name),
  email: input.email.trim(),
  projectType: input.projectType.trim(),
  budget: input.budget.trim(),
  message: input.message.trim(),
});

const isValidEmail = (email: string): boolean => {
  if (/\s/.test(email)) return false;
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (local === undefined || domain === undefined) return false;
  if (local.length === 0) return false;
  const dot = domain.indexOf('.');
  return dot > 0 && dot < domain.length - 1;
};

const checkName = (value: string): string | undefined => {
  const name = normaliseName(value);
  if (name.length === 0) return FIELD_MESSAGES.nameEmpty;
  if (name.length < NAME_MIN || name.length > NAME_MAX) return FIELD_MESSAGES.nameLength;
  return undefined;
};

const checkEmail = (value: string): string | undefined => {
  const email = value.trim();
  if (email.length === 0) return FIELD_MESSAGES.emailEmpty;
  if (!isValidEmail(email)) return FIELD_MESSAGES.emailShape;
  return undefined;
};

const checkProjectType = (value: string): string | undefined =>
  projectTypeLabel(value.trim()) === undefined ? FIELD_MESSAGES.projectTypeEmpty : undefined;

const checkBudget = (value: string): string | undefined =>
  budgetLabel(value.trim()) === undefined ? FIELD_MESSAGES.budgetEmpty : undefined;

const checkMessage = (value: string): string | undefined => {
  const message = value.trim();
  if (message.length === 0) return FIELD_MESSAGES.messageEmpty;
  if (message.length < MESSAGE_MIN || message.length > MESSAGE_MAX) {
    return FIELD_MESSAGES.messageLength;
  }
  return undefined;
};

/** Checks every field in field order and names each failing one. */
export const checkEnquiry = (input: EnquiryInput): EnquiryFieldMessages => {
  const messages: EnquiryFieldMessages = {};
  const name = checkName(input.name);
  if (name !== undefined) messages.name = name;
  const email = checkEmail(input.email);
  if (email !== undefined) messages.email = email;
  const projectType = checkProjectType(input.projectType);
  if (projectType !== undefined) messages.projectType = projectType;
  const budget = checkBudget(input.budget);
  if (budget !== undefined) messages.budget = budget;
  const message = checkMessage(input.message);
  if (message !== undefined) messages.message = message;
  return messages;
};

export const failingFields = (messages: EnquiryFieldMessages): EnquiryField[] =>
  ENQUIRY_FIELDS.filter((field) => messages[field] !== undefined);

export const formStatusInvalidText = (count: number): string =>
  count === 1 ? 'Check the 1 highlighted field.' : `Check the ${count} highlighted fields.`;

export const FORM_STATUS_SENDING = 'Sending your message\u2026';

export const FORM_STATUS_NOT_SENT =
  'Your message was not sent because the mail server is unavailable. Your details are still here, so you can try again.';

export const sentParagraph = (name: string): string => {
  const firstWord = normaliseName(name).split(' ')[0] ?? '';
  return `Thanks, ${firstWord}. Your message is in my inbox, and I usually reply within two working days.`;
};

/** The enquiry state machine. */
export type EnquiryState = 'editing' | 'invalid' | 'sending' | 'sent' | 'failed';

export type EnquiryEvent =
  | { readonly type: 'press'; readonly valid: boolean }
  | { readonly type: 'correct' }
  | { readonly type: 'accepted' }
  | { readonly type: 'rejected' }
  | { readonly type: 'reset' };

export const nextEnquiryState = (state: EnquiryState, event: EnquiryEvent): EnquiryState => {
  switch (event.type) {
    case 'press':
      return state === 'editing' || state === 'invalid' || state === 'failed'
        ? event.valid
          ? 'sending'
          : 'invalid'
        : state;
    case 'correct':
      return state === 'invalid' ? 'editing' : state;
    case 'accepted':
      return state === 'sending' ? 'sent' : state;
    case 'rejected':
      return state === 'sending' ? 'failed' : state;
    case 'reset':
      return state === 'sent' ? 'editing' : state;
  }
};

export const ENQUIRY_RECIPIENT = 'hello@ottolinerask.example';

export const enquirySubject = (projectTypeName: string, name: string): string =>
  `New enquiry: ${projectTypeName} from ${name}`;

export const enquiryBody = (input: EnquiryInput): string => {
  const typeName = projectTypeLabel(input.projectType) ?? input.projectType;
  const budget = budgetLabel(input.budget) ?? input.budget;
  return [
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `Project type: ${typeName}`,
    `Budget: ${budget}`,
    '',
    input.message,
  ].join('\n');
};
