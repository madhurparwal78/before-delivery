import type { Question, QuestionType } from '../../shared/types.ts';

// The twelve question types with the names the Add question dialog shows, and what each type can hold.

export const QUESTION_KINDS: { type: QuestionType; name: string }[] = [
  { type: 'short_text', name: 'Short text' },
  { type: 'long_text', name: 'Long text' },
  { type: 'number', name: 'Number' },
  { type: 'choice', name: 'Choice' },
  { type: 'checkbox', name: 'Checkbox' },
  { type: 'dropdown', name: 'Dropdown' },
  { type: 'grid', name: 'Grid' },
  { type: 'ranking', name: 'Ranking' },
  { type: 'scale', name: 'Scale' },
  { type: 'date', name: 'Date' },
  { type: 'file', name: 'File upload' },
  { type: 'calculated', name: 'Calculated' },
];

/** The type named by a type list's value. */
export const questionType = (value: string): QuestionType => QUESTION_KINDS.find((kind) => kind.type === value)?.type ?? 'short_text';

export const kindName = (type: QuestionType): string => QUESTION_KINDS.find((kind) => kind.type === type)?.name ?? type;

export const hasOptions = (type: QuestionType): boolean =>
  type === 'choice' || type === 'checkbox' || type === 'dropdown' || type === 'ranking';

export const isTextual = (type: QuestionType): boolean => type === 'short_text' || type === 'long_text';

/** Ranking and file questions have no trial control and count as blank; calculated ones are worked out. */
export const isAnswerable = (question: Question): boolean =>
  question.type !== 'calculated' && question.type !== 'ranking' && question.type !== 'file';
