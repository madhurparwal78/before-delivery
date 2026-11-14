import type { AnswerValue, Evaluation, EvalQuestion, StructureQuestion } from '../../../shared/types.ts';
import { calculatedField } from './calculated.ts';
import { checkboxField } from './checkbox.ts';
import { choiceField } from './choice.ts';
import { dateField } from './date.ts';
import { dropdownField } from './dropdown.ts';
import type { Field, FieldEnv } from './field.ts';
import { fileField } from './file.ts';
import { gridField } from './grid.ts';
import { rankingField } from './ranking.ts';
import { scaleField } from './scale.ts';
import { textField } from './text.ts';

export type { Field, FieldEnv } from './field.ts';

/** The question block for one lit question, by its type. */
export function createField(item: EvalQuestion, spec: StructureQuestion, answer: AnswerValue | undefined, evaluation: Evaluation, env: FieldEnv): Field {
  switch (spec.type) {
    case 'short_text':
    case 'long_text':
    case 'number': return textField(item, spec, answer, env);
    case 'choice': return choiceField(item, spec, answer, env);
    case 'checkbox': return checkboxField(item, spec, answer, env);
    case 'dropdown': return dropdownField(item, spec, answer, env);
    case 'grid': return gridField(item, spec, answer, env);
    case 'ranking': return rankingField(item, spec, answer, env);
    case 'scale': return scaleField(item, spec, answer, env);
    case 'date': return dateField(item, spec, answer, env);
    case 'file': return fileField(item, spec, answer, env);
    case 'calculated': return calculatedField(item, evaluation);
  }
}
