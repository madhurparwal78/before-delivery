import { ApiError } from '../errors';
import {
  isCityId,
  isPayBandId,
  isRoleFamilyId,
  isStage,
  isWorkPatternId,
  REJECTION_REASONS,
} from '../../shared/reference';

export const COPY = {
  display_name: 'Use 2 to 40 characters.',
  email: 'Enter an email address.',
  password: 'Use at least 10 characters.',
  company_id: 'Choose a company.',
  rating: 'Choose a rating from 1 to 5.',
  review_title: 'Add a title of 5 to 120 characters.',
  long_text: 'Write 20 to 3,000 characters.',
  role_family: 'Choose a role.',
  city: 'Choose a city.',
  pay: 'Enter yearly pay between ₹1,00,000 and ₹50,00,000.',
  pay_high: 'The top of the range must be at least the bottom.',
  years_experience: 'Enter 0 to 40 years.',
  outcome: 'Choose what happened.',
  reason: 'Choose a reason.',
  details: 'Add 5 to 200 characters.',
  reply_body: 'Write 20 to 2,000 characters.',
  job_title: 'Use 3 to 120 characters.',
  remote: 'Choose a work pattern.',
  description: 'Write 40 to 5,000 characters.',
  candidate_name: 'Use 2 to 100 characters.',
  phone: 'Enter a phone number or leave it empty.',
  cover_note: 'Use at most 2,000 characters.',
  resume: 'Choose a PDF resume.',
  channel_body: 'Write 1 to 2,000 characters.',
  idempotency_key: 'Reload the form and try again.',
  stage: 'Choose a stage.',
  size: 'Choose a size.',
  slug: 'Use a slug of 2 to 80 lower-case letters, numbers and dashes.',
  name: 'Use 2 to 120 characters.',
  role: 'Choose a role.',
  email_domain: 'Use a domain such as example.test.',
  user_id: 'Choose a member.',
  decision: 'Choose approve or reject.',
  q: 'Use at most 200 characters.',
} as const;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export class FieldErrors {
  private readonly fields: Record<string, string> = {};

  add(field: string, copy: string): void {
    if (!(field in this.fields)) this.fields[field] = copy;
  }

  get empty(): boolean {
    return Object.keys(this.fields).length === 0;
  }

  throwIfAny(): void {
    if (!this.empty) throw new ApiError('validation_failed', { fields: { ...this.fields } });
  }
}

function asText(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

export function textBetween(value: unknown, min: number, max: number): string | null {
  const text = asText(value);
  if (text === null) return null;
  const length = [...text].length;
  return length >= min && length <= max ? text : null;
}

export function emailValue(value: unknown): string | null {
  const text = asText(value);
  if (!text || text.length > 254 || !EMAIL_SHAPE.test(text)) return null;
  return text;
}

export function integerBetween(value: unknown, min: number, max: number): number | null {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

export function phoneValue(value: unknown): string | null {
  const text = asText(value) ?? '';
  if (text === '') return '';
  if (text.length < 7 || text.length > 20) return null;
  return /^\+?[0-9 -]+$/.test(text) ? text : null;
}

export function rejectionReason(value: unknown): string | null {
  const text = asText(value);
  return text !== null && REJECTION_REASONS.includes(text) ? text : null;
}

export const refs = { isCityId, isRoleFamilyId, isWorkPatternId, isPayBandId, isStage };
