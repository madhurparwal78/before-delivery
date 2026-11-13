import { errors, type FieldErrors } from './errors.ts';

export interface QuestionInput {
  type?: unknown;
  prompt?: unknown;
  timeLimitSeconds?: unknown;
  options?: unknown;
  correctIndex?: unknown;
  min?: unknown;
  max?: unknown;
  step?: unknown;
  answer?: unknown;
  tolerance?: unknown;
  unit?: unknown;
  items?: unknown;
}

export type ValidatedContent =
  | { type: 'multiple_choice'; options: string[]; correctIndex: number }
  | { type: 'estimate'; min: number; max: number; step: number; answer: number; tolerance: number; unit: string }
  | { type: 'sequence'; items: string[] };

export interface ValidatedQuestion {
  prompt: string;
  timeLimitSeconds: number;
  content: ValidatedContent;
}

function trimmedString(value: unknown, min: number, max: number, field: string, errs: FieldErrors): string | null {
  if (typeof value !== 'string') {
    errs[field] = 'This field is required';
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    errs[field] = `Must be between ${min} and ${max} characters`;
    return null;
  }
  return trimmed;
}

function wholeNumber(value: unknown, min: number, max: number, field: string, errs: FieldErrors): number | null {
  if (typeof value === 'string' && /^-?\d+$/.test(value)) value = Number(value);
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    errs[field] = `Must be a whole number from ${min} to ${max}`;
    return null;
  }
  return value;
}

function decimal(value: unknown, field: string, errs: FieldErrors): number | null {
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) value = Number(value);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errs[field] = 'Must be a number';
    return null;
  }
  return value;
}

export function validateQuestion(input: QuestionInput): ValidatedQuestion {
  const errs: FieldErrors = {};
  const prompt = trimmedString(input.prompt, 1, 200, 'prompt', errs);
  const timeLimitSeconds = wholeNumber(input.timeLimitSeconds, 5, 120, 'timeLimitSeconds', errs);
  let content: ValidatedContent | null = null;
  if (input.type === 'multiple_choice') {
    const optionsRaw = Array.isArray(input.options) ? input.options : [];
    const options: string[] = [];
    let optionsOk = true;
    if (optionsRaw.length < 2 || optionsRaw.length > 4) {
      errs.options = 'A multiple-choice question needs 2 to 4 options';
      optionsOk = false;
    }
    for (const option of optionsRaw) {
      if (typeof option !== 'string' || option.trim().length < 1 || option.trim().length > 80) {
        errs.options = 'Each option must be 1 to 80 characters';
        optionsOk = false;
        break;
      }
      options.push(option.trim());
    }
    if (optionsOk) {
      const correctIndex = wholeNumber(input.correctIndex, 0, options.length - 1, 'correctIndex', errs);
      if (correctIndex !== null) {
        content = { type: 'multiple_choice', options, correctIndex };
      }
    }
  } else if (input.type === 'estimate') {
    const min = decimal(input.min, 'min', errs);
    const max = decimal(input.max, 'max', errs);
    const step = decimal(input.step, 'step', errs);
    const answer = decimal(input.answer, 'answer', errs);
    const tolerance = decimal(input.tolerance, 'tolerance', errs);
    const unit = typeof input.unit === 'string' ? input.unit.trim() : '';
    if (unit.length > 20) errs.unit = 'The unit must be 20 characters or fewer';
    if (min !== null && max !== null && step !== null && answer !== null && tolerance !== null && unit.length <= 20) {
      if (min >= max) errs.min = 'The minimum must be below the maximum';
      if (step <= 0) errs.step = 'The step must be above zero';
      if (answer < min || answer > max) errs.answer = 'The answer must lie within the range';
      if (tolerance < 0 || tolerance > max - min) errs.tolerance = 'The tolerance must be between 0 and the range';
      if (!errs.min && !errs.max && !errs.step && !errs.answer && !errs.tolerance) {
        content = { type: 'estimate', min, max, step, answer, tolerance, unit };
      }
    }
  } else if (input.type === 'sequence') {
    const itemsRaw = Array.isArray(input.items) ? input.items : [];
    const items: string[] = [];
    let itemsOk = true;
    if (itemsRaw.length < 3 || itemsRaw.length > 6) {
      errs.items = 'A sequence question needs 3 to 6 items';
      itemsOk = false;
    }
    for (const item of itemsRaw) {
      if (typeof item !== 'string' || item.trim().length < 1 || item.trim().length > 80) {
        errs.items = 'Each item must be 1 to 80 characters';
        itemsOk = false;
        break;
      }
      items.push(item.trim());
    }
    if (itemsOk && items.length >= 3) {
      const lower = items.map((item) => item.toLowerCase());
      if (new Set(lower).size !== lower.length) {
        errs.items = 'Items must be unique ignoring case';
        itemsOk = false;
      }
    }
    if (itemsOk) content = { type: 'sequence', items };
  } else {
    errs.type = 'Pick a question type';
  }
  if (prompt === null || timeLimitSeconds === null || content === null || Object.keys(errs).length > 0) {
    throw errors.validationFailed(errs);
  }
  return { prompt, timeLimitSeconds, content };
}

export function validateDeckTitle(title: unknown): string {
  const errs: FieldErrors = {};
  const trimmed = trimmedString(title, 1, 80, 'title', errs);
  if (trimmed === null) throw errors.validationFailed(errs);
  return trimmed;
}
