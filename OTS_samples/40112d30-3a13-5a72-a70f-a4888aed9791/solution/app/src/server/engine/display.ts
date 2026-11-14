import type { AnswerValue, ChoiceOption, Question } from '../../shared/types.ts';
import { listOf, textOf } from './answers.ts';
import { shortDate } from './dates.ts';
import { numberText } from './formats.ts';


/** The column value chosen for a grid row, or undefined when the row is unanswered. */
export function gridCell(answer: AnswerValue, row: string): string | undefined {
  if (typeof answer !== 'object' || Array.isArray(answer) || !Object.hasOwn(answer, row)) return undefined;
  return (answer as Record<string, string>)[row];
}

function labelOf(options: readonly ChoiceOption[] | undefined, value: string): string {
  return (options ?? []).find((option) => option.value === value)?.label ?? value;
}

/** The label of the column chosen for a grid row, or null when the row is unanswered. */
export function gridRowText(question: Question, answer: AnswerValue, row: string): string | null {
  const column = gridCell(answer, row);
  return column === undefined ? null : labelOf(question.columns, column);
}

/** Answer text: what a stored answer reads as in insertions, emails and the owner's response view. */
export function answerText(question: Question, answer: AnswerValue): string {
  switch (question.type) {
    case 'short_text':
    case 'long_text':
      return textOf(answer);
    case 'number':
    case 'scale':
      return numberText(textOf(answer));
    case 'choice':
    case 'dropdown':
      return labelOf(question.options, textOf(answer));
    case 'checkbox': {
      const ticked = listOf(answer);
      return (question.options ?? []).filter((option) => ticked.includes(option.value)).map((option) => option.label).join(', ');
    }
    case 'date':
      return shortDate(textOf(answer).trim());
    case 'grid':
      return (question.rows ?? [])
        .flatMap((row) => {
          const column = gridRowText(question, answer, row.value);
          return column === null ? [] : [`${row.label}: ${column}`];
        })
        .join('; ');
    case 'ranking':
      return listOf(answer).map((value) => labelOf(question.options, value)).join(' > ');
    case 'file':
      return typeof answer === 'object' && !Array.isArray(answer) ? answer.name ?? '' : '';
    case 'calculated':
      return '';
  }
}
