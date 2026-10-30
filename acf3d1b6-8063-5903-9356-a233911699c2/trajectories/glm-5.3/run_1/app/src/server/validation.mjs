// Field checks for every form: one rule per field, shared by the API and the pages.
import { COMPANY_SIZES, INDUSTRIES, ENQUIRY_PRODUCTS, modelById } from '../content.mjs';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function checkName(value, label = 'Name') {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 80) {
    return `${label} must be between 1 and 80 characters.`;
  }
  return null;
}

export function checkEmail(value) {
  if (typeof value !== 'string' || !EMAIL_RE.test(value.trim())) {
    return 'Enter a valid email address.';
  }
  return null;
}

export function checkPassword(value) {
  if (typeof value !== 'string' || value.length < 10) {
    return 'Password must be at least 10 characters.';
  }
  return null;
}

export function checkProjectName(value) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 80) {
    return 'Project name must be between 1 and 80 characters.';
  }
  return null;
}

export function checkPrompt(value) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 1000) {
    return 'Write a prompt first.';
  }
  return null;
}

export function checkCompany(value) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 120) {
    return 'Company must be between 1 and 120 characters.';
  }
  return null;
}

export function checkCompanySize(value) {
  if (typeof value !== 'string' || !COMPANY_SIZES.includes(value)) {
    return 'Select a company size.';
  }
  return null;
}

export function checkIndustry(value) {
  if (typeof value !== 'string' || !INDUSTRIES.includes(value)) {
    return 'Select an industry.';
  }
  return null;
}

export function checkMessage(value) {
  if (typeof value !== 'string' || value.trim().length < 10 || value.trim().length > 2000) {
    return 'Message must be between 10 and 2,000 characters.';
  }
  return null;
}

export function checkProducts(value) {
  const valid = ENQUIRY_PRODUCTS.map(p => p.id);
  if (!Array.isArray(value) || value.length < 1 || !value.every(v => valid.includes(v))) {
    return 'Choose at least one product.';
  }
  return null;
}

/** Validate a generation start's model, duration, image count and aspect. */
export function checkGenerationFields({ model, duration, image_count, aspect }) {
  const errors = {};
  const m = typeof model === 'string' ? modelById(model) : null;
  if (!m) errors.model = 'Choose a model.';
  else if (m.kind === 'video') {
    if (duration !== 5 && duration !== 10) errors.duration = 'Choose a length.';
    if (image_count != null) errors.image_count = 'Images do not apply to video models.';
  } else {
    if (!Number.isInteger(image_count) || image_count < 1 || image_count > 4) errors.image_count = 'Images must be between 1 and 4.';
    if (duration != null) errors.duration = 'Length does not apply to image models.';
  }
  if (aspect !== '16:9' && aspect !== '9:16' && aspect !== '1:1') errors.aspect = 'Choose an aspect.';
  return errors;
}
