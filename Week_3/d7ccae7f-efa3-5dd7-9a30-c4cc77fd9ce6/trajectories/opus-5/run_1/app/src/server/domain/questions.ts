import type { QuestionType } from '../../shared/protocol.js';
import { validationFailed } from '../errors.js';
import {
  FieldErrors,
  readInteger,
  readNumber,
  readString,
  readStringArray,
  type Json,
} from '../parse.js';

export interface MultipleChoiceSpec {
  options: string[];
  correctIndex: number;
}

export interface EstimateSpec {
  min: number;
  max: number;
  step: number;
  answer: number;
  tolerance: number;
  unit: string;
}

export interface SequenceSpec {
  items: string[];
}

export type QuestionSpec =
  | ({ type: 'multiple_choice' } & MultipleChoiceSpec)
  | ({ type: 'estimate' } & EstimateSpec)
  | ({ type: 'sequence' } & SequenceSpec);

export interface QuestionDraft {
  type: QuestionType;
  prompt: string;
  timeLimitSeconds: number;
  spec: QuestionSpec;
}

const TYPES: QuestionType[] = ['multiple_choice', 'estimate', 'sequence'];

export function validateDeckTitle(raw: string | null, errors: FieldErrors, field = 'title'): string {
  const title = (raw ?? '').trim();
  if (title.length < 1 || title.length > 80) {
    errors.add(field, 'Use a title of 1 to 80 characters.');
  }
  return title;
}

export function parseQuestionDraft(body: Json): QuestionDraft {
  const errors = new FieldErrors();
  const rawType = readString(body, 'type');
  const type = TYPES.find((candidate) => candidate === rawType);
  if (!type) {
    throw validationFailed({ type: 'Pick multiple choice, estimate or sequence.' });
  }

  const prompt = (readString(body, 'prompt') ?? '').trim();
  if (prompt.length < 1 || prompt.length > 200) {
    errors.add('prompt', 'Write a prompt of 1 to 200 characters.');
  }

  const timeLimitSeconds = readInteger(body, 'timeLimitSeconds');
  if (timeLimitSeconds === null || timeLimitSeconds < 5 || timeLimitSeconds > 120) {
    errors.add('timeLimitSeconds', 'Use a whole number of seconds from 5 to 120.');
  }

  const spec = parseSpec(type, body, errors);
  errors.throwIfAny();
  return { type, prompt, timeLimitSeconds: timeLimitSeconds ?? 0, spec };
}

function parseSpec(type: QuestionType, body: Json, errors: FieldErrors): QuestionSpec {
  if (type === 'multiple_choice') return parseMultipleChoice(body, errors);
  if (type === 'estimate') return parseEstimate(body, errors);
  return parseSequence(body, errors);
}

function parseMultipleChoice(body: Json, errors: FieldErrors): QuestionSpec {
  const raw = readStringArray(body, 'options');
  const options = (raw ?? []).map((option) => option.trim());
  if (raw === null || options.length < 2 || options.length > 4) {
    errors.add('options', 'Add 2 to 4 options.');
  }
  options.forEach((option, index) => {
    if (option.length < 1 || option.length > 80) {
      errors.add(`options.${index}`, 'Use 1 to 80 characters.');
    }
  });
  const correctIndex = readInteger(body, 'correctIndex');
  if (correctIndex === null || correctIndex < 0 || correctIndex >= options.length) {
    errors.add('correctIndex', 'Mark one of the options as correct.');
  }
  return { type: 'multiple_choice', options, correctIndex: correctIndex ?? 0 };
}

function parseEstimate(body: Json, errors: FieldErrors): QuestionSpec {
  const min = readNumber(body, 'min');
  const max = readNumber(body, 'max');
  const step = readNumber(body, 'step');
  const answer = readNumber(body, 'answer');
  const tolerance = readNumber(body, 'tolerance');
  const unit = readString(body, 'unit') ?? '';

  if (min === null) errors.add('min', 'Enter a minimum.');
  if (max === null) errors.add('max', 'Enter a maximum.');
  if (min !== null && max !== null && min >= max) {
    errors.add('max', 'Maximum must be greater than the minimum.');
  }
  if (step === null || step <= 0) errors.add('step', 'Step must be greater than 0.');
  if (answer === null) {
    errors.add('answer', 'Enter the correct value.');
  } else if (min !== null && max !== null && (answer < min || answer > max)) {
    errors.add('answer', 'Correct value must sit between the minimum and maximum.');
  }
  if (tolerance === null || tolerance < 0) {
    errors.add('tolerance', 'Tolerance must be 0 or more.');
  } else if (min !== null && max !== null && tolerance > max - min) {
    errors.add('tolerance', 'Tolerance cannot be wider than the range.');
  }
  if (unit.length > 20) errors.add('unit', 'Use 20 characters or fewer.');

  return {
    type: 'estimate',
    min: min ?? 0,
    max: max ?? 0,
    step: step ?? 1,
    answer: answer ?? 0,
    tolerance: tolerance ?? 0,
    unit,
  };
}

function parseSequence(body: Json, errors: FieldErrors): QuestionSpec {
  const raw = readStringArray(body, 'items');
  const items = (raw ?? []).map((item) => item.trim());
  if (raw === null || items.length < 3 || items.length > 6) {
    errors.add('items', 'Add 3 to 6 items in the correct order.');
  }
  items.forEach((item, index) => {
    if (item.length < 1 || item.length > 80) {
      errors.add(`items.${index}`, 'Use 1 to 80 characters.');
    }
  });
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const key = item.toLowerCase();
    if (seen.has(key)) errors.add(`items.${index}`, 'Items must all be different.');
    seen.add(key);
  });
  return { type: 'sequence', items };
}

export function parseStoredSpec(type: QuestionType, stored: unknown): QuestionSpec {
  const body = stored as Json;
  if (type === 'multiple_choice') {
    return {
      type,
      options: readStringArray(body, 'options') ?? [],
      correctIndex: readInteger(body, 'correctIndex') ?? 0,
    };
  }
  if (type === 'estimate') {
    return {
      type,
      min: readNumber(body, 'min') ?? 0,
      max: readNumber(body, 'max') ?? 0,
      step: readNumber(body, 'step') ?? 1,
      answer: readNumber(body, 'answer') ?? 0,
      tolerance: readNumber(body, 'tolerance') ?? 0,
      unit: readString(body, 'unit') ?? '',
    };
  }
  return { type: 'sequence', items: readStringArray(body, 'items') ?? [] };
}
