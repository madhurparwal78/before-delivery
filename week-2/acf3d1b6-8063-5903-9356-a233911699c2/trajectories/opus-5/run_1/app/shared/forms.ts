export const COMPANY_SIZES = ['1-200', '201-1,000', '1,001-5,000', '5,001-10,000', '10,001+'];

export const INDUSTRIES = [
  'Architecture & Real Estate',
  'Automotive',
  'Creative Agency',
  'Financial Services',
  'Gaming',
  'Healthcare',
  'Media & Entertainment',
  'Professional Services',
  'Consumer Goods & Retail',
  'Software & Telecom',
  'Travel & Hospitality',
  'Other'
];

export const PRODUCTS: { id: string; label: string; tip?: string }[] = [
  { id: 'creative-platform', label: 'Creative Platform' },
  { id: 'api', label: 'API' },
  {
    id: 'model-weights-licensing',
    label: 'Model Weights Licensing',
    tip: "License Kinora's underlying AI model weights for your bespoke requirements. Custom pricing."
  },
  { id: 'kinora-ads', label: 'Kinora Ads' }
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FieldErrors = Record<string, string>;

export function checkText(value: unknown, min: number, max: number, message: string): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length >= min && text.length <= max ? null : message;
}

export function checkEmail(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return EMAIL_PATTERN.test(text) && text.length <= 254 ? null : 'Enter a valid email address.';
}

export function checkPassword(value: unknown): string | null {
  return typeof value === 'string' && value.length >= 10 ? null : 'Use at least 10 characters.';
}

export function checkChoice(value: unknown, options: string[], message: string): string | null {
  return typeof value === 'string' && options.includes(value) ? null : message;
}

export function checkProducts(value: unknown): string | null {
  const ids = PRODUCTS.map((product) => product.id);
  const chosen = Array.isArray(value) ? value : [];
  return chosen.length > 0 && chosen.every((item) => typeof item === 'string' && ids.includes(item))
    ? null
    : 'Choose at least one product.';
}

export interface EnquiryInput {
  source?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  full_name?: unknown;
  email?: unknown;
  company?: unknown;
  company_size?: unknown;
  industry?: unknown;
  products?: unknown;
  message?: unknown;
}

/** The one place an enquiry's fields are checked, used by the form and the API. */
export function validateEnquiry(input: EnquiryInput): FieldErrors {
  const errors: FieldErrors = {};
  const licensing = input.source === 'licensing';
  if (input.source !== 'contact' && input.source !== 'licensing') {
    errors.source = 'Choose a valid enquiry source.';
  }
  if (licensing) {
    const fullName = checkText(input.full_name, 1, 120, 'Enter a full name of 1 to 120 characters.');
    if (fullName) errors.full_name = fullName;
  } else {
    const firstName = checkText(input.first_name, 1, 80, 'Enter a first name of 1 to 80 characters.');
    if (firstName) errors.first_name = firstName;
    const lastName = checkText(input.last_name, 1, 80, 'Enter a last name of 1 to 80 characters.');
    if (lastName) errors.last_name = lastName;
    const products = checkProducts(input.products);
    if (products) errors.products = products;
  }
  const email = checkEmail(input.email);
  if (email) errors.email = email;
  const company = checkText(input.company, 1, 120, 'Enter a company name of 1 to 120 characters.');
  if (company) errors.company = company;
  const companySize = checkChoice(input.company_size, COMPANY_SIZES, 'Select an option.');
  if (companySize) errors.company_size = companySize;
  const industry = checkChoice(input.industry, INDUSTRIES, 'Select an option.');
  if (industry) errors.industry = industry;
  const message = checkText(input.message, 10, 2000, 'Write a message of 10 to 2,000 characters.');
  if (message) errors.message = message;
  return errors;
}

export function validateAccount(input: { name?: unknown; password?: unknown }): FieldErrors {
  const errors: FieldErrors = {};
  const name = checkText(input.name, 1, 80, 'Enter a name of 1 to 80 characters.');
  if (name) errors.name = name;
  const password = checkPassword(input.password);
  if (password) errors.password = password;
  return errors;
}
