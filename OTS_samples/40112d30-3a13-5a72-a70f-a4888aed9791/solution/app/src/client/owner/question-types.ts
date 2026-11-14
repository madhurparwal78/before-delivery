import type { QuestionType } from '../../shared/types.ts';

// The published names of the question types (brief: Public screens and controls, Add question).

export const TYPE_NAMES: Record<QuestionType, string> = {
  short_text: 'Short text',
  long_text: 'Long text',
  number: 'Number',
  choice: 'Choice',
  checkbox: 'Checkbox',
  dropdown: 'Dropdown',
  grid: 'Grid',
  ranking: 'Ranking',
  scale: 'Scale',
  date: 'Date',
  file: 'File upload',
  calculated: 'Calculated',
};
