import type { FormCheck, FormDefinition, Question, QuestionType } from '../../shared/types.ts';
import { M37, M82 } from '../../shared/messages.ts';
import { validRealDate } from './dates.ts';
import { isExactDecimal, parseDecimal } from './decimal.ts';

interface StructureIssue {
  code: 'CHANGE_INVALID' | 'DUPLICATE_KEY' | 'VALIDATION_FAILED';
  message: string;
  key?: string;
}

type Json = Record<string, unknown>;

const KEY_FORMAT = /^[a-z][a-z0-9_]*$/;
/** Calculated fields show at most this many decimals. */
const MAX_PLACES = 100;

const COMMON_FIELDS = ['key', 'type', 'label', 'help', 'required', 'show_rule', 'note'];
const TYPE_FIELDS: Record<QuestionType, readonly string[]> = {
  short_text: ['min_length', 'max_length', 'pattern'],
  long_text: ['min_length', 'max_length', 'pattern'],
  number: ['min', 'max', 'decimals'],
  choice: ['options', 'shuffle'],
  checkbox: ['options', 'shuffle', 'min_selected', 'max_selected'],
  dropdown: ['options', 'shuffle'],
  grid: ['rows', 'columns'],
  ranking: ['options'],
  scale: ['min', 'max', 'min_label', 'max_label'],
  date: ['min', 'max'],
  file: ['max_bytes', 'accept'],
  calculated: ['formula', 'places', 'prefix', 'suffix', 'hidden'],
};
/** Fields a question must have beyond key, type and label; `lenient` drops the ones the Add question dialog may omit. */
const REQUIRED_FIELDS: Partial<Record<QuestionType, { always: readonly string[]; unlessLenient: readonly string[] }>> = {
  choice: { always: ['options'], unlessLenient: [] },
  checkbox: { always: ['options'], unlessLenient: [] },
  dropdown: { always: ['options'], unlessLenient: [] },
  ranking: { always: ['options'], unlessLenient: [] },
  grid: { always: [], unlessLenient: ['rows', 'columns'] },
  scale: { always: [], unlessLenient: ['min', 'max'] },
  calculated: { always: [], unlessLenient: ['formula'] },
};

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isNonNegativeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

function hasExactly(record: Json, fields: readonly string[]): boolean {
  const names = Object.keys(record);
  return names.length === fields.length && fields.every((field) => names.includes(field) && isString(record[field]));
}

const isShowRule = (value: unknown): boolean => isRecord(value) && hasExactly(value, ['name', 'when']);

const isFormCheck = (value: unknown): value is FormCheck =>
  isRecord(value) && hasExactly(value, ['name', 'page', 'target', 'fail_when', 'message']);

function isOptionList(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const values = value.map((option: unknown) => (isRecord(option) ? option.value : undefined));
  return value.every((option: unknown) => isRecord(option) && hasExactly(option, ['value', 'label']))
    && new Set(values).size === values.length;
}

/** The type decides what `min` and `max` mean. */
function isBound(value: unknown, type: QuestionType): boolean {
  if (type === 'date') return isString(value) && validRealDate(value);
  if (type === 'scale') return isString(value) ? /^-?[0-9]+$/.test(value) : Number.isInteger(value);
  return typeof value === 'number' ? Number.isFinite(value) && parseDecimal(String(value)) !== null
    : isString(value) && isExactDecimal(value);
}

const FIELD_VALID: Record<string, (value: unknown, type: QuestionType) => boolean> = {
  key: isString,
  type: isString,
  label: isString,
  help: isString,
  note: isString,
  min_label: isString,
  max_label: isString,
  formula: isString,
  prefix: isString,
  suffix: isString,
  required: isBoolean,
  shuffle: isBoolean,
  hidden: isBoolean,
  show_rule: isShowRule,
  options: isOptionList,
  rows: isOptionList,
  columns: isOptionList,
  min_length: isNonNegativeInteger,
  max_length: isNonNegativeInteger,
  decimals: isNonNegativeInteger,
  min_selected: isNonNegativeInteger,
  max_selected: isNonNegativeInteger,
  places: (value) => isNonNegativeInteger(value) && value <= MAX_PLACES,
  max_bytes: (value) => isNonNegativeInteger(value) && value > 0,
  pattern: (value) => value === 'email' || value === 'phone' || value === 'digits' || value === 'letters',
  accept: (value) => Array.isArray(value) && new Set(value).size === value.length
    && value.every((kind: unknown) => kind === 'pdf' || kind === 'png' || kind === 'jpeg'),
  min: isBound,
  max: isBound,
};

const invalid = (message: string, key?: string): StructureIssue => ({ code: 'CHANGE_INVALID', message, key });

function isQuestionType(value: unknown): value is QuestionType {
  return isString(value) && Object.hasOwn(TYPE_FIELDS, value);
}

/** The first unknown or missing field of a record, as an issue. */
function shapeIssue(
  record: Json, allowed: readonly string[], required: readonly string[], subject: string, key?: string,
): StructureIssue | null {
  const unknown = Object.keys(record).find((field) => !allowed.includes(field));
  if (unknown !== undefined) return invalid(`${subject} has an unknown field "${unknown}".`, key);
  const missing = required.find((field) => record[field] === undefined);
  return missing === undefined ? null : invalid(`${subject} is missing "${missing}".`, key);
}

/** The key of a question or page: a string in the published format that no earlier one used. */
function keyIssue(key: unknown, subject: string, used: Set<string>): StructureIssue | null {
  if (!isString(key)) return invalid(`${subject} is missing "key".`);
  if (!KEY_FORMAT.test(key)) return { code: 'VALIDATION_FAILED', message: M82, key };
  if (used.has(key)) return { code: 'DUPLICATE_KEY', message: M37, key };
  used.add(key);
  return null;
}

function questionIssue(raw: unknown, lenient: boolean, usedKeys: Set<string>): StructureIssue | null {
  if (!isRecord(raw)) return invalid('A question must be an object.');
  const { key, type } = raw;
  const duplicate = keyIssue(key, 'A question', usedKeys);
  if (duplicate !== null || !isString(key)) return duplicate;
  const subject = `Question "${key}"`;
  if (!isQuestionType(type)) return invalid(type === undefined ? `${subject} is missing "type".` : `${subject} has an unknown type.`, key);
  const extra = REQUIRED_FIELDS[type];
  const required = ['key', 'type', 'label', ...(extra?.always ?? []), ...(lenient ? [] : extra?.unlessLenient ?? [])];
  const shape = shapeIssue(raw, [...COMMON_FIELDS, ...TYPE_FIELDS[type]], required, subject, key);
  if (shape !== null) return shape;
  const badField = Object.keys(raw).find((field) => !FIELD_VALID[field]?.(raw[field], type));
  return badField === undefined ? null : invalid(`${subject} has an invalid "${badField}".`, key);
}

function pageIssue(raw: unknown, lenient: boolean, usedPageKeys: Set<string>, usedQuestionKeys: Set<string>): StructureIssue | null {
  if (!isRecord(raw)) return invalid('A page must be an object.');
  const duplicate = keyIssue(raw.key, 'A page', usedPageKeys);
  if (duplicate !== null || !isString(raw.key)) return duplicate;
  const subject = `Page "${raw.key}"`;
  const shape = shapeIssue(raw, ['key', 'title', 'questions', 'show_rule', 'jumps'], ['key', 'title', 'questions'], subject, raw.key);
  if (shape !== null) return shape;
  const { title, questions, show_rule: showRule, jumps } = raw;
  const jumpsValid = jumps === undefined
    || (Array.isArray(jumps) && jumps.every((jump: unknown) => isRecord(jump) && hasExactly(jump, ['name', 'when', 'to'])));
  if (!isString(title) || !Array.isArray(questions) || (showRule !== undefined && !isShowRule(showRule)) || !jumpsValid) {
    return invalid(`${subject} is not valid.`, raw.key);
  }
  for (const question of questions) {
    const issue = questionIssue(question, lenient, usedQuestionKeys);
    if (issue !== null) return issue;
  }
  return null;
}

/**
 * Structural validation of a whole definition: unknown type or field, duplicate key, missing required field,
 * malformed option list, bad key format, bad page or check reference. Formula refusals are not reported here.
 * `lenient` is the add_question path: a grid may lack rows and columns, a scale its limits, a calculated
 * question its formula.
 */
export function validateStructure(definition: unknown, lenient = false): StructureIssue | null {
  if (!isRecord(definition)) return invalid('The form definition must be an object.');
  const shape = shapeIssue(definition, ['title', 'intro', 'pages', 'checks'], ['title', 'intro', 'pages', 'checks'], 'The form');
  if (shape !== null) return shape;
  const { title, intro, pages, checks } = definition;
  if (!isString(title) || !isString(intro) || !Array.isArray(pages) || !Array.isArray(checks)) {
    return invalid('The form is not valid.');
  }
  const questionKeys = new Set<string>();
  const pageKeys = new Set<string>();
  for (const page of pages) {
    const issue = pageIssue(page, lenient, pageKeys, questionKeys);
    if (issue !== null) return issue;
  }
  for (const check of checks) {
    if (!isFormCheck(check)) return invalid('A check must have a name, page, target, fail_when and message.');
    if (!pageKeys.has(check.page)) return invalid(`Check "${check.name}" names a page that does not exist.`);
    if (!questionKeys.has(check.target)) return invalid(`Check "${check.name}" names a target question that does not exist.`);
  }
  return null;
}

/** The definition, once `validateStructure` has accepted it. */
export function asDefinition(definition: unknown): FormDefinition {
  return definition as FormDefinition;
}

/** The defaults the Add question dialog leaves to the server. */
export function normalizeQuestion(question: Question): Question {
  switch (question.type) {
    case 'grid':
      return {
        ...question,
        rows: question.rows ?? [{ value: 'row_1', label: 'Row 1' }],
        columns: question.columns ?? [{ value: 'col_1', label: 'Column 1' }],
      };
    case 'scale':
      return { ...question, min: question.min ?? 1, max: question.max ?? 5 };
    case 'calculated':
      return { ...question, formula: question.formula ?? '' };
    default:
      return question;
  }
}
